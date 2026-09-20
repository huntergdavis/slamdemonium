"""Publish static artifacts without executing PR code in a privileged workflow."""

import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import sys
import zipfile


STATE_FILE = ".pages-state.json"
COMMENT_MARKER = "<!-- slamdemonium-pr-preview -->"
SITE_URL = "https://hunterdavis.com/slamdemonium"
MAX_BYTES = 250 * 1024 * 1024


def api(repo, path, *, method="GET", data=None, raw=False):
    command = ["gh", "api", "--method", method, f"repos/{repo}/{path}"]
    if data is not None:
        command += ["--input", "-"]
    result = subprocess.run(
        command, input=json.dumps(data).encode() if data is not None else None,
        stdout=subprocess.PIPE, check=True,
    ).stdout
    return result if raw else json.loads(result or b"null")


def paginated(repo, path):
    separator = "&" if "?" in path else "?"
    page = 1
    while True:
        items = api(repo, f"{path}{separator}per_page=100&page={page}")
        yield from items
        if len(items) < 100:
            return
        page += 1


def preview_pr(run, pulls):
    """Derive the destination from GitHub metadata, never from artifact contents."""
    matches = [pr for pr in pulls if (
        pr["state"] == "open" and pr["base"]["ref"] == "main"
        and pr["head"]["sha"] == run["head_sha"]
        and pr["head"]["ref"] == run["head_branch"]
        and (pr["head"]["repo"] or {}).get("id") == run["head_repository"]["id"]
    )]
    if len(matches) > 1:
        raise ValueError("Ambiguous PR for preview build")
    return matches[0] if matches else None


def archive_files(archive, *, production=False):
    """Reject traversal, links, repository metadata, and oversized ZIP payloads."""
    files = {}
    total = 0
    entries = archive.infolist()
    if len(entries) > 10000:
        raise ValueError("Too many artifact files")
    for item in entries:
        name = item.filename
        parts = name.rstrip("/").split("/")
        if (not name or "\\" in name or PurePosixPath(name).is_absolute()
                or any(part in ("", ".", "..") or part.lower().startswith(".git") for part in parts)):
            raise ValueError(f"Unsafe artifact path: {name!r}")
        mode = stat.S_IFMT(item.external_attr >> 16)
        if mode not in (0, stat.S_IFREG, stat.S_IFDIR):
            raise ValueError(f"Artifact links/special files are forbidden: {name!r}")
        if production and parts[0] in ("pr", STATE_FILE):
            raise ValueError(f"Reserved production path: {name!r}")
        if item.is_dir():
            continue
        if name in files:
            raise ValueError(f"Duplicate artifact path: {name!r}")
        total += item.file_size
        if total > MAX_BYTES:
            raise ValueError("Artifact exceeds 250 MiB unpacked")
        files[name] = item
    if "index.html" not in files:
        raise ValueError("Artifact has no index.html")
    return files


def install_artifact(snapshot, data, number=None):
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        files = archive_files(archive, production=number is None)
        if number is None:
            for child in snapshot.iterdir():
                if child.name not in (".git", "pr", STATE_FILE):
                    if child.is_dir():
                        shutil.rmtree(child)
                    else:
                        child.unlink()
            target = snapshot
        else:
            target = snapshot / "pr" / str(number)
            if target.exists():
                shutil.rmtree(target)
        for name, item in files.items():
            destination = target / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(archive.read(item))


def remove_preview(snapshot, number):
    path = snapshot / "pr" / str(number)
    if path.exists():
        shutil.rmtree(path)


def label_preview(snapshot, number):
    index = snapshot / "pr" / str(number) / "index.html"
    html = index.read_text()
    banner = (
        '<aside id="pr-preview-notice" aria-label="Pull request preview" '
        'style="position:fixed;top:8px;right:8px;z-index:2147483647;'
        'padding:8px 12px;border:2px solid #111;border-radius:6px;'
        'background:#ffe66d;color:#111;font:600 14px/1.4 system-ui,sans-serif">'
        f'PR #{number} PREVIEW · <a style="color:#111;text-decoration:underline" '
        f'href="{SITE_URL}/">Open live game</a></aside>'
    )
    html = re.sub(r"(?i)(<title\b[^>]*>)", rf"\1[PR #{number} preview] ", html, count=1)
    position = html.lower().rfind("</body>")
    html = html[:position] + banner + html[position:] if position >= 0 else html + banner
    index.write_text(html)


def assemble_site(snapshot, production, site):
    """Production comes only from the trusted main build, never the storage branch."""
    site.mkdir()
    install_artifact(site, production)
    previews = snapshot / "pr"
    if previews.exists():
        for child in previews.iterdir():
            if not child.is_dir() or not re.fullmatch(r"[1-9][0-9]*", child.name):
                raise ValueError("Unexpected path in stored preview namespace")
        shutil.copytree(previews, site / "pr")


def git(snapshot, *args, check=True):
    return subprocess.run(
        ["git", "-C", str(snapshot), *args], check=check,
        stdout=subprocess.PIPE, text=True,
    )


def load_snapshot(repo, snapshot):
    subprocess.run(["git", "init", "--quiet", "--initial-branch=gh-pages", str(snapshot)], check=True)
    git(snapshot, "remote", "add", "origin", f"https://github.com/{repo}.git")
    # The helper reads GH_TOKEN from the environment; no token is stored in Git config.
    git(snapshot, "config", "credential.helper", "!gh auth git-credential")
    git(snapshot, "config", "user.name", "github-actions[bot]")
    git(snapshot, "config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com")
    result = git(snapshot, "ls-remote", "--exit-code", "origin", "refs/heads/gh-pages", check=False)
    if result.returncode == 0:
        git(snapshot, "fetch", "--quiet", "--depth=1", "origin", "gh-pages")
        git(snapshot, "checkout", "--quiet", "-B", "gh-pages", "FETCH_HEAD")
    elif result.returncode != 2:
        raise RuntimeError("Cannot read gh-pages snapshot branch")
    for root, directories, files in os.walk(snapshot, followlinks=False):
        if Path(root) == snapshot:
            directories[:] = [name for name in directories if name != ".git"]
        for name in directories + files:
            if (Path(root) / name).is_symlink():
                raise ValueError("Snapshot must not contain symbolic links")
    state_path = snapshot / STATE_FILE
    return json.loads(state_path.read_text()) if state_path.exists() else {"previews": {}}


def artifact(repo, run_id, name):
    artifacts = api(repo, f"actions/runs/{run_id}/artifacts?per_page=100")["artifacts"]
    matches = [item for item in artifacts if item["name"] == name and not item["expired"]]
    if len(matches) != 1:
        raise ValueError(f"Expected one unexpired artifact named {name}")
    if matches[0]["size_in_bytes"] > MAX_BYTES:
        raise ValueError("Artifact exceeds 250 MiB compressed")
    return api(repo, f"actions/artifacts/{matches[0]['id']}/zip", raw=True)


def output(name, value):
    with open(os.environ["GITHUB_OUTPUT"], "a") as stream:
        stream.write(f"{name}={value}\n")


def prepare(repo, temporary):
    output("publish", "false")
    event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text())
    event_name = os.environ["GITHUB_EVENT_NAME"]
    number = None
    sha = None
    production_sha = os.environ["PRODUCTION_SHA"]
    if not re.fullmatch(r"[0-9a-f]{40}", production_sha):
        raise ValueError("Invalid trusted production SHA")
    if event_name == "push":
        if event["ref"] != "refs/heads/main":
            raise ValueError("Production builds must originate from main")
        mode = "production"
        sha = production_sha
    elif event_name == "workflow_run":
        mode = "preview"
        run_id = int(event["workflow_run"]["id"])
        run = api(repo, f"actions/runs/{run_id}")
        if (run["event"] != "pull_request" or run["conclusion"] != "success"
                or run["path"] != ".github/workflows/pr-preview.yml"
                or run["repository"]["full_name"] != repo):
            raise ValueError("Unexpected preview build provenance")
        pr = preview_pr(run, paginated(repo, "pulls?state=open"))
        if pr is None:
            print("Skipping closed, superseded, or unrelated preview build")
            return
        number, sha = pr["number"], pr["head"]["sha"]
        artifact_name = f"preview-{number}"
    elif event_name == "pull_request_target" and event["action"] == "closed":
        mode = "remove"
        number = int(event["number"])
        pr = api(repo, f"pulls/{number}")
        if pr["state"] != "closed" or pr["base"]["ref"] != "main":
            print("Skipping cleanup: PR was reopened or has another base")
            return
    else:
        raise ValueError("Unsupported publication event")
    if number is not None and (not isinstance(number, int) or number <= 0):
        raise ValueError("Invalid PR number")
    if sha is not None and not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise ValueError("Invalid source SHA")

    snapshot = temporary / "pages-snapshot"
    state = load_snapshot(repo, snapshot)
    production = artifact(repo, int(os.environ["GITHUB_RUN_ID"]), "pages-production")
    if mode == "remove":
        remove_preview(snapshot, number)
        state["previews"].pop(str(number), None)
    elif mode == "preview":
        install_artifact(snapshot, artifact(repo, run_id, artifact_name), number)
        state["previews"][str(number)] = sha
        label_preview(snapshot, number)

    # Validate and assemble the complete site before writing any durable state.
    assemble_site(snapshot, production, temporary / "pages-site")
    state["production_sha"] = production_sha

    (snapshot / STATE_FILE).write_text(json.dumps(state, indent=2) + "\n")
    git(snapshot, "add", "--all")
    changed = git(snapshot, "diff", "--cached", "--quiet", check=False)
    if changed.returncode == 1:
        git(snapshot, "commit", "--quiet", "-m", f"Pages {mode}: {number or sha}")
        git(snapshot, "push", "--quiet", "origin", "HEAD:refs/heads/gh-pages")
    elif changed.returncode != 0:
        raise RuntimeError("Cannot compare Pages snapshot changes")
    # Even an unchanged snapshot is uploaded: reruns must recover failed deployments.
    (temporary / "pages-context.json").write_text(json.dumps({"mode": mode, "number": number, "sha": sha}))
    output("publish", "true")


def comment_body(number, sha, removed=False):
    if removed:
        return f"{COMMENT_MARKER}\nPreview removed because this pull request is closed."
    return (f"{COMMENT_MARKER}\n**[Play PR #{number} preview]({SITE_URL}/pr/{number}/)**\n\n"
            f"Built from commit `{sha}`. Updates automatically when a new preview deploys.\n\n"
            "Preview publication is independent of CI status; check this PR's checks "
            "for the commit above before trusting the build.")


def comment(repo, temporary):
    context = json.loads((temporary / "pages-context.json").read_text())
    number = context["number"]
    if number is None:
        return
    pr = api(repo, f"pulls/{number}")
    removed = context["mode"] == "remove"
    if (removed and pr["state"] != "closed") or (not removed and (
            pr["state"] != "open" or pr["head"]["sha"] != context["sha"])):
        return
    comments = [item for item in paginated(repo, f"issues/{number}/comments")
                if item["user"]["login"] == "github-actions[bot]" and COMMENT_MARKER in item["body"]]
    body = {"body": comment_body(number, context["sha"], removed)}
    if comments:
        api(repo, f"issues/comments/{comments[0]['id']}", method="PATCH", data=body)
    elif not removed:
        api(repo, f"issues/{number}/comments", method="POST", data=body)


if __name__ == "__main__":
    repository = os.environ["GITHUB_REPOSITORY"]
    temporary_path = Path(os.environ["RUNNER_TEMP"])
    {"prepare": prepare, "comment": comment}[sys.argv[1]](repository, temporary_path)
