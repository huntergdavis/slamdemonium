"""Cut reviewed main builds without executing application code in the publisher."""

import hashlib
from html.parser import HTMLParser
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
from urllib.error import URLError
from urllib.parse import quote
from urllib.request import Request, urlopen
import zipfile

from pages import api, archive_files, artifact, install_artifact, output, SITE_URL, MAX_BYTES

STABLE_TAG = re.compile(r"v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$")
REQUIRED_CHECKS = {"CI", "Reachability", "Bundle size"}
ASSET = "production.zip"


def version_tuple(tag):
    match = STABLE_TAG.fullmatch(tag)
    if not match:
        raise ValueError(f"Expected stable semantic version tag, found {tag!r}")
    return tuple(map(int, match.groups()))


def tag_commit(repo, tag, optional=False):
    version_tuple(tag)
    ref = api(repo, f"git/ref/tags/{tag}", optional=optional)
    if ref is None:
        return None
    obj = ref["object"]
    for _ in range(4):
        if obj["type"] == "commit" and re.fullmatch(r"[a-f0-9]{40}", obj["sha"]):
            return obj["sha"]
        if obj["type"] != "tag":
            break
        obj = api(repo, f"git/tags/{obj['sha']}")["object"]
    raise ValueError("Release tag does not resolve to a commit")


def check_info(info, tag, sha, *, candidate=False):
    version_tuple(tag)
    prefix = "UNRELEASED CANDIDATE · " if candidate else "RELEASE "
    expected = {"version": tag[1:], "tag": tag, "commit": sha, "shortCommit": sha[:7],
                "channel": "candidate" if candidate else "release", "dirty": False,
                "label": f"{prefix}{tag} · {sha[:7]}"}
    if info != expected:
        raise ValueError("Release artifact identity disagrees with its tag/source")
    return info


def check_base(html, base, files):
    class Assets(HTMLParser):
        urls = []

        def handle_starttag(self, tag, attributes):
            attributes = dict(attributes)
            if tag == "script" and attributes.get("src"):
                self.urls.append(attributes["src"])
            if tag == "link" and attributes.get("rel") in ("stylesheet", "modulepreload"):
                self.urls.append(attributes.get("href", ""))

    parser = Assets()
    parser.feed(html)
    if not parser.urls or any(not url.startswith(base) or url[len(base):] not in files for url in parser.urls):
        raise ValueError(f"Release HTML does not resolve its assets within {base}")


def identity(data, tag, sha, base="/slamdemonium/", *, candidate=False):
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        files = archive_files(archive, production=True)
        if "build-info.json" not in files or files["build-info.json"].file_size > 4096:
            raise ValueError("Release artifact lacks bounded build identity")
        info = check_info(json.loads(archive.read(files["build-info.json"])), tag, sha, candidate=candidate)
        check_base(archive.read(files["index.html"]).decode(), base, files)
    return info


def canonical_zip(data, previous=None):
    """Retain hashed assets for cached clients; stable headers permit safe retries."""
    result = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(data)) as source:
        files = {name: source.read(entry) for name, entry in archive_files(source, production=True).items()}
    if previous is not None:
        for path in (previous / "assets").rglob("*"):
            if path.is_symlink():
                raise ValueError("Previous asset must not be a symbolic link")
            if not path.is_file() or not re.search(r"-[A-Za-z0-9_-]{8}\.[^/]+$", path.name):
                continue
            name = path.relative_to(previous).as_posix()
            content = path.read_bytes()
            if name in files and files[name] != content:
                raise ValueError(f"Content-hashed asset collision: {name}")
            files[name] = content
    if len(files) > 10000 or sum(map(len, files.values())) > MAX_BYTES:
        raise ValueError("Release plus retained compatibility assets exceeds archive bounds")
    with zipfile.ZipFile(result, "w") as target:
        for name, content in sorted(files.items()):
            header = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            header.compress_type = zipfile.ZIP_DEFLATED
            header.external_attr = 0o100644 << 16
            target.writestr(header, content)
    return result.getvalue()


def select(repo, temporary):
    if os.environ["GITHUB_REF"] != "refs/heads/main":
        raise ValueError("Cuts and Pages publication must run from main")
    sha = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
    pkg = json.loads(Path("package.json").read_text())
    lock = json.loads(Path("package-lock.json").read_text())
    tag = "v" + pkg["version"]
    version_tuple(tag)
    if lock["version"] != pkg["version"] or lock["packages"][""]["version"] != pkg["version"]:
        raise ValueError("package.json and package-lock.json versions disagree")
    latest = api(repo, "releases/latest", optional=True)
    if latest:
        if latest["draft"] or latest["prerelease"]:
            raise ValueError("Production release must be published and stable")
        production_tag = latest["tag_name"]
        production_sha = tag_commit(repo, production_tag)
    else:
        production_tag = ""
        production_sha = json.loads(Path(".github/release-bootstrap.json").read_text())["revision"]
        if not re.fullmatch(r"[a-f0-9]{40}", production_sha):
            raise ValueError("Invalid bootstrap source")
    if os.environ.get("CUT_RELEASE") == "true":
        if latest and version_tuple(tag) <= version_tuple(production_tag):
            raise ValueError("Bump package.json and lockfile in a reviewed PR before cutting the next release")
        checks = api(repo, f"commits/{sha}/check-runs?filter=latest&per_page=100")["check_runs"]
        green = {item["name"] for item in checks if item["app"]["id"] == 15368
                 and item["status"] == "completed" and item["conclusion"] == "success"}
        if REQUIRED_CHECKS - green:
            raise ValueError(f"Release source needs successful checks: {sorted(REQUIRED_CHECKS - green)}")
        existing = tag_commit(repo, tag, optional=True)
        if existing is not None and existing != sha:
            raise ValueError(f"{tag} already points elsewhere; existing tags are never moved")
    for name, value in (("sha", sha), ("tag", tag), ("production_sha", production_sha),
                        ("production_tag", production_tag)):
        output(name, value)


def download_release(repo, tag, sha):
    release = api(repo, f"releases/tags/{tag}")
    if release["draft"] or release["prerelease"] or tag_commit(repo, tag) != sha:
        raise ValueError("Production release/tag provenance changed")
    matches = [asset for asset in release["assets"] if asset["name"] == ASSET]
    if len(matches) != 1 or matches[0]["size"] > 250 * 1024 * 1024:
        raise ValueError("Expected one bounded retained production release asset")
    asset = matches[0]
    data = subprocess.check_output(["gh", "api", "-H", "Accept: application/octet-stream",
                                    f"repos/{repo}/releases/assets/{asset['id']}"])
    if asset.get("digest") != "sha256:" + hashlib.sha256(data).hexdigest():
        raise ValueError("Release asset checksum mismatch")
    identity(data, tag, sha)
    return data


def fetch(repo, temporary):
    data = download_release(repo, os.environ["PRODUCTION_TAG"], os.environ["PRODUCTION_SHA"])
    target = temporary / "pages-production"
    target.mkdir()
    install_artifact(target, data)


def verify_directory(directory, url, *, root=False, timeout=300):
    paths = [path for path in sorted(directory.rglob("*")) if path.is_file()
             and (not root or path.relative_to(directory).parts[0] not in ("main", "pr", "release-candidate"))]
    if not paths or not (directory / "index.html").is_file():
        raise ValueError("Verification requires a complete static site")
    deadline = time.monotonic() + timeout
    while True:
        try:
            for path in paths:
                relative = path.relative_to(directory).as_posix()
                request = Request(url.rstrip("/") + "/" + quote(relative),
                                  headers={"Accept-Encoding": "identity", "Cache-Control": "no-cache"})
                with urlopen(request, timeout=15) as response:
                    content = response.read(path.stat().st_size + 1)
                    if response.status != 200 or content != path.read_bytes():
                        raise ValueError(f"Served bytes differ: {relative}")
            print(f"Verified {len(paths)} files byte-for-byte at {url}")
            return
        except (OSError, URLError, ValueError) as error:
            if time.monotonic() >= deadline:
                raise RuntimeError(f"Live verification failed at {url}: {error}") from error
            print(f"Waiting for Pages propagation: {error}", flush=True)
            time.sleep(5)


def verify_stage(repo, temporary):
    candidate = temporary / "pages-site/release-candidate"
    check_info(json.loads((candidate / "build-info.json").read_text()), os.environ["CUT_TAG"], os.environ["MAIN_SHA"], candidate=True)
    check_base((candidate / "index.html").read_text(), "/slamdemonium/release-candidate/",
               {path.relative_to(candidate).as_posix() for path in candidate.rglob("*") if path.is_file()})
    verify_directory(candidate, SITE_URL + "/release-candidate/")
    # Staging must leave every production file unchanged.
    verify_directory(temporary / "pages-site", SITE_URL + "/", root=True)


def stage_release(repo, temporary):
    tag, sha = os.environ["CUT_TAG"], os.environ["MAIN_SHA"]
    data = canonical_zip(artifact(repo, int(os.environ["GITHUB_RUN_ID"]), "release-production"), temporary / "pages-site")
    identity(data, tag, sha)
    existing = tag_commit(repo, tag, optional=True)
    if existing is None:
        api(repo, "git/refs", method="POST", data={"ref": f"refs/tags/{tag}", "sha": sha})
    elif existing != sha:
        raise ValueError("Existing tag differs; tags are never moved")
    release = api(repo, f"releases/tags/{tag}", optional=True)
    if release is None:
        release = api(repo, "releases", method="POST", data={
            "tag_name": tag, "target_commitish": sha, "name": tag, "draft": True,
            "prerelease": False, "generate_release_notes": True,
            "body": f"Source: {sha}\n\nPlay: {SITE_URL}/\n\nProduction files are retained in {ASSET}.",
        })
    if not release["draft"]:
        raise ValueError("Published release is immutable to this workflow; cut a new version")
    assets = [item for item in release["assets"] if item["name"] == ASSET]
    fingerprint = "sha256:" + hashlib.sha256(data).hexdigest()
    if assets:
        if len(assets) != 1 or assets[0].get("digest") != fingerprint:
            raise ValueError("Existing draft asset differs; it will not be overwritten")
    else:
        archive = temporary / ASSET
        archive.write_bytes(data)
        subprocess.run(["gh", "release", "upload", tag, str(archive), "--repo", repo], check=True)
    release = api(repo, f"releases/{release['id']}")
    if not any(item["name"] == ASSET and item.get("digest") == fingerprint for item in release["assets"]):
        raise ValueError("Uploaded release asset was not verified")
    site = temporary / "pages-release"
    shutil.copytree(temporary / "pages-site", site)
    install_artifact(site, data)
    (temporary / "release-context.json").write_text(json.dumps({"id": release["id"], "tag": tag, "sha": sha}))


def verify_production(repo, temporary):
    verify_directory(temporary / "pages-release", SITE_URL + "/", root=True)


def publish(repo, temporary):
    context = json.loads((temporary / "release-context.json").read_text())
    if tag_commit(repo, context["tag"]) != context["sha"]:
        raise ValueError("Tag changed during deployment; refusing to publish")
    release = api(repo, f"releases/{context['id']}", method="PATCH", data={"draft": False, "make_latest": "true"})
    print(f"Released {context['tag']} / {context['sha']}: {release['html_url']}")
    with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as summary:
        summary.write(f"## Released {context['tag']}\n\nCommit: {context['sha']}\n\n"
                      f"[Play stable release]({SITE_URL}/) · [UNRELEASED main preview]({SITE_URL}/main/)\n\n"
                      "Staging and production files verified byte-for-byte. Production release ZIP retained permanently.\n")


if __name__ == "__main__":
    operations = {"select": select, "fetch": fetch, "verify-stage": verify_stage,
                  "stage-release": stage_release, "verify-production": verify_production, "publish": publish}
    operations[sys.argv[1]](os.environ["GITHUB_REPOSITORY"], Path(os.environ["RUNNER_TEMP"]))
