import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import zipfile

spec = importlib.util.spec_from_file_location("pages", Path(__file__).parents[1] / "scripts/pages.py")
pages = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pages)


def archive(files):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as output:
        for name, content in files.items():
            output.writestr(name, content)
    return buffer.getvalue()


def build(version):
    return archive({"index.html": f"<title>Game</title><body>{version}</body>",
                    f"assets/{version}.js": f"console.log('{version}')"})


def pull(number=7):
    return {"number": number, "state": "open", "base": {"ref": "main"},
            "head": {"sha": "a" * 40, "ref": "feature", "repo": {"id": 42}}}


def run():
    return {"head_sha": "a" * 40, "head_branch": "feature", "head_repository": {"id": 42}}


class ArchiveTests(unittest.TestCase):
    def test_rejects_escape_and_git_control_files(self):
        for name in ("../escape", "/absolute", "a/../../escape", "a\\escape",
                     ".git/config", "assets/.GiT/config", ".gitattributes", ".github/workflows/a.yml"):
            with self.subTest(name=name), zipfile.ZipFile(io.BytesIO(archive({"index.html": "ok", name: "bad"}))) as data:
                with self.assertRaises(ValueError):
                    pages.archive_files(data)

    def test_rejects_symlinks(self):
        item = zipfile.ZipInfo("link")
        item.create_system = 3
        item.external_attr = (stat.S_IFLNK | 0o777) << 16
        with zipfile.ZipFile(io.BytesIO(archive({"index.html": "ok", item: "../../outside"}))) as data:
            with self.assertRaises(ValueError):
                pages.archive_files(data)

    def test_reserves_preview_namespace_and_state_for_publisher(self):
        for name in ("pr/7/index.html", pages.STATE_FILE):
            with zipfile.ZipFile(io.BytesIO(archive({"index.html": "ok", name: "bad"}))) as data:
                with self.assertRaises(ValueError):
                    pages.archive_files(data, production=True)

    def test_requires_index_and_bounds_unpacked_size(self):
        with zipfile.ZipFile(io.BytesIO(archive({"asset.js": "ok"}))) as data:
            with self.assertRaises(ValueError):
                pages.archive_files(data)
        with patch.object(pages, "MAX_BYTES", 3), zipfile.ZipFile(io.BytesIO(build("large"))) as data:
            with self.assertRaises(ValueError):
                pages.archive_files(data)


class LifecycleTests(unittest.TestCase):
    def test_real_git_open_update_close_keeps_live_root_identical(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bare = root / "remote.git"
            subprocess.run(["git", "init", "--bare", "--quiet", str(bare)], check=True)
            config = root / "gitconfig"
            config.write_text(f'[url "{bare.as_uri()}"]\n\tinsteadOf = https://github.com/owner/repo.git\n')
            current = {"pr": pull(), "preview": build("first")}
            production = build("live-main")

            def fake_api(repo, path, **kwargs):
                if "/artifacts?" in path:
                    return {"artifacts": [{"id": 1, "name": "pages-production", "expired": False, "size_in_bytes": len(production)},
                                          {"id": 2, "name": "preview-7", "expired": False, "size_in_bytes": len(current["preview"])}]}
                if path == "actions/artifacts/1/zip":
                    return production
                if path == "actions/artifacts/2/zip":
                    return current["preview"]
                if path == "actions/runs/200":
                    return run() | {"head_sha": current["pr"]["head"]["sha"], "event": "pull_request", "conclusion": "success",
                                    "path": ".github/workflows/pr-preview.yml", "repository": {"full_name": repo}}
                if path == "pulls/7":
                    return current["pr"]
                raise AssertionError(path)

            def publish(phase, event_name, event):
                temporary = root / phase
                temporary.mkdir()
                event_file = temporary / "event.json"
                event_file.write_text(json.dumps(event))
                environment = {"GIT_CONFIG_GLOBAL": str(config), "GITHUB_EVENT_PATH": str(event_file),
                               "GITHUB_EVENT_NAME": event_name, "GITHUB_RUN_ID": "100", "PRODUCTION_SHA": "c" * 40,
                               "GITHUB_OUTPUT": str(temporary / "output")}
                with patch.dict(os.environ, environment), patch.object(pages, "api", side_effect=fake_api), \
                        patch.object(pages, "paginated", return_value=[current["pr"]]):
                    pages.prepare("owner/repo", temporary)
                self.assertIn("publish=true", (temporary / "output").read_text())
                site = temporary / "pages-site"
                self.assertEqual((site / "index.html").read_bytes(), b"<title>Game</title><body>live-main</body>")
                self.assertFalse((site / ".git").exists())
                return site

            publish("initial", "push", {"ref": "refs/heads/main"})
            opened = publish("open", "workflow_run", {"workflow_run": {"id": 200}})
            self.assertIn("PR #7 PREVIEW", (opened / "pr/7/index.html").read_text())
            current["pr"]["head"]["sha"] = "b" * 40
            current["preview"] = build("updated")
            updated = publish("update", "workflow_run", {"workflow_run": {"id": 200}})
            self.assertTrue((updated / "pr/7/assets/updated.js").exists())
            self.assertFalse((updated / "pr/7/assets/first.js").exists())
            current["pr"]["state"] = "closed"
            closed = publish("close", "pull_request_target", {"action": "closed", "number": 7})
            self.assertFalse((closed / "pr/7").exists())

    def test_storage_branch_cannot_supply_or_replace_production(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            snapshot = root / "snapshot"
            snapshot.mkdir()
            (snapshot / "index.html").write_text("POISONED PRODUCTION")
            (snapshot / "unexpected.js").write_text("also not production")
            pages.install_artifact(snapshot, build("preview"), 7)
            pages.assemble_site(snapshot, build("trusted-main"), root / "site")
            self.assertIn("trusted-main", (root / "site/index.html").read_text())
            self.assertFalse((root / "site/unexpected.js").exists())
            self.assertTrue((root / "site/pr/7/index.html").exists())

    def test_open_update_close_preserves_production_and_other_previews(self):
        with tempfile.TemporaryDirectory() as directory:
            site = Path(directory)
            pages.install_artifact(site, build("production"))
            production = {p.relative_to(site): p.read_bytes() for p in site.rglob("*") if p.is_file()}
            pages.install_artifact(site, build("first"), 7)
            pages.label_preview(site, 7)
            pages.install_artifact(site, build("other"), 8)
            other = (site / "pr/8/index.html").read_bytes()
            pages.install_artifact(site, build("updated"), 7)
            pages.label_preview(site, 7)
            self.assertFalse((site / "pr/7/assets/first.js").exists())
            self.assertTrue((site / "pr/7/assets/updated.js").is_file())
            preview = (site / "pr/7/index.html").read_text()
            self.assertIn("[PR #7 preview] Game", preview)
            self.assertIn("PR #7 PREVIEW", preview)
            self.assertIn('href="https://hunterdavis.com/slamdemonium/"', preview)
            pages.remove_preview(site, 7)
            pages.remove_preview(site, 7)
            self.assertFalse((site / "pr/7").exists())
            self.assertEqual((site / "pr/8/index.html").read_bytes(), other)
            for path, content in production.items():
                self.assertEqual((site / path).read_bytes(), content)
            pages.install_artifact(site, build("next-production"))
            self.assertFalse((site / "assets/production.js").exists())
            self.assertEqual((site / "pr/8/index.html").read_bytes(), other)

    def test_artifact_code_is_only_copied(self):
        with tempfile.TemporaryDirectory() as directory:
            site = Path(directory)
            payload = archive({"index.html": "<body>preview</body>",
                               "execute.py": "raise RuntimeError('must never execute')"})
            pages.install_artifact(site, payload, 7)
            self.assertEqual((site / "pr/7/execute.py").read_text(), "raise RuntimeError('must never execute')")


class ProvenanceTests(unittest.TestCase):
    def test_production_event_must_originate_from_main(self):
        with tempfile.TemporaryDirectory() as directory:
            temporary = Path(directory)
            event = temporary / "event.json"
            event.write_text(json.dumps({"ref": "refs/heads/feature"}))
            environment = {"GITHUB_EVENT_PATH": str(event), "GITHUB_EVENT_NAME": "push",
                           "PRODUCTION_SHA": "a" * 40, "GITHUB_RUN_ID": "123"}
            with patch.dict(os.environ, environment), \
                    patch.object(pages, "api", return_value={"object": {"sha": "b" * 40}}), \
                    patch.object(pages, "load_snapshot", return_value={"previews": {}}), \
                    patch.object(pages, "output") as output, \
                    patch.object(pages, "artifact") as download, \
                    patch.object(pages, "git") as git:
                with self.assertRaisesRegex(ValueError, "originate from main"):
                    pages.prepare("owner/repo", temporary)
                download.assert_not_called()
                git.assert_not_called()
                output.assert_called_once_with("publish", "false")

    def test_reopened_pr_cannot_be_removed_by_an_old_close_event(self):
        with tempfile.TemporaryDirectory() as directory:
            temporary = Path(directory)
            event = temporary / "event.json"
            event.write_text(json.dumps({"action": "closed", "number": 7}))
            with patch.dict(os.environ, {"GITHUB_EVENT_PATH": str(event), "GITHUB_EVENT_NAME": "pull_request_target", "PRODUCTION_SHA": "a" * 40}), \
                    patch.object(pages, "api", return_value=pull()), \
                    patch.object(pages, "output"), patch.object(pages, "load_snapshot") as load:
                pages.prepare("owner/repo", temporary)
                load.assert_not_called()

    def test_matches_current_open_pr_and_skips_old_closed_or_unrelated_builds(self):
        self.assertEqual(pages.preview_pr(run(), [pull()])["number"], 7)
        for change in ("closed", "old_sha", "other_repo", "other_branch", "other_base"):
            pr = copy.deepcopy(pull())
            if change == "closed":
                pr["state"] = "closed"
            elif change == "old_sha":
                pr["head"]["sha"] = "b" * 40
            elif change == "other_repo":
                pr["head"]["repo"]["id"] = 99
            elif change == "other_branch":
                pr["head"]["ref"] = "different"
            else:
                pr["base"]["ref"] = "different"
            with self.subTest(change=change):
                self.assertIsNone(pages.preview_pr(run(), [pr]))

    def test_preview_cannot_deploy_without_a_successful_production_artifact(self):
        with tempfile.TemporaryDirectory() as directory:
            temporary = Path(directory)
            event = temporary / "event.json"
            event.write_text(json.dumps({"workflow_run": {"id": 123}}))
            metadata = run() | {"event": "pull_request", "conclusion": "success",
                                "path": ".github/workflows/pr-preview.yml", "repository": {"full_name": "owner/repo"}}
            environment = {"GITHUB_EVENT_PATH": str(event), "GITHUB_EVENT_NAME": "workflow_run",
                           "PRODUCTION_SHA": "a" * 40, "GITHUB_RUN_ID": "456"}
            with patch.dict(os.environ, environment), \
                    patch.object(pages, "api", return_value=metadata), \
                    patch.object(pages, "paginated", return_value=[pull()]), \
                    patch.object(pages, "load_snapshot", return_value={"previews": {}}), \
                    patch.object(pages, "output") as output, \
                    patch.object(pages, "artifact", side_effect=ValueError("Missing production artifact")), \
                    patch.object(pages, "git") as git:
                with self.assertRaisesRegex(ValueError, "Missing production"):
                    pages.prepare("owner/repo", temporary)
                git.assert_not_called()
                output.assert_called_once_with("publish", "false")


class CommentTests(unittest.TestCase):
    def test_one_bot_comment_is_created_then_updated_and_marked_removed(self):
        with tempfile.TemporaryDirectory() as directory:
            temporary = Path(directory)
            context = temporary / "pages-context.json"
            context.write_text(json.dumps({"mode": "preview", "number": 7, "sha": "a" * 40}))
            with patch.object(pages, "api", return_value=pull()) as api, \
                    patch.object(pages, "paginated", return_value=[]):
                pages.comment("owner/repo", temporary)
                self.assertEqual(api.call_args.args[1], "issues/7/comments")
                self.assertEqual(api.call_args.kwargs["method"], "POST")
            comment = {"id": 88, "user": {"login": "github-actions[bot]"}, "body": pages.COMMENT_MARKER}
            with patch.object(pages, "api", return_value=pull()) as api, \
                    patch.object(pages, "paginated", return_value=[comment]):
                pages.comment("owner/repo", temporary)
                self.assertEqual(api.call_args.args[1], "issues/comments/88")
                self.assertEqual(api.call_args.kwargs["method"], "PATCH")
            context.write_text(json.dumps({"mode": "remove", "number": 7, "sha": None}))
            with patch.object(pages, "api", return_value=pull() | {"state": "closed"}) as api, \
                    patch.object(pages, "paginated", return_value=[comment]):
                pages.comment("owner/repo", temporary)
                self.assertEqual(api.call_args.args[1], "issues/comments/88")
                self.assertIn("Preview removed", api.call_args.kwargs["data"]["body"])
                self.assertNotIn("https://", api.call_args.kwargs["data"]["body"])


if __name__ == "__main__":
    unittest.main()
