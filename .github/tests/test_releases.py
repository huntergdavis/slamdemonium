import copy
import hashlib
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
from threading import Thread
import unittest
from unittest.mock import patch
import zipfile

sys.path.insert(0, str(Path(__file__).parents[1] / 'scripts'))
import pages
import releases

SHA = 'a' * 40
TAG = 'v0.1.0'


def build(base='/slamdemonium/', **changes):
    info = {'version': '0.1.0', 'commit': SHA, 'shortCommit': SHA[:7], 'tag': TAG,
            'channel': 'release', 'dirty': False, 'label': f'RELEASE {TAG} · {SHA[:7]}'}
    info.update(changes)
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w') as archive:
        archive.writestr('index.html', f'<title>Game</title><body><script type="module" src="{base}assets/game.js"></script></body>')
        archive.writestr('assets/game.js', 'window.ready = true')
        archive.writestr('build-info.json', json.dumps(info))
    return output.getvalue()


class IdentityTests(unittest.TestCase):
    def test_stable_versions_only_and_no_leading_zeroes(self):
        self.assertEqual(releases.version_tuple('v10.2.30'), (10, 2, 30))
        for value in ('v01.0.0', '0.1.0', 'v0.1.0-beta', 'v0.1', 'v0.1.0+dirty'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                releases.version_tuple(value)

    def test_artifact_must_match_exact_version_commit_and_channel(self):
        self.assertEqual(releases.identity(build(), TAG, SHA)['commit'], SHA)
        for change in ({'commit': 'b' * 40}, {'tag': 'v0.2.0'}, {'dirty': True},
                       {'channel': 'unreleased'}, {'version': '0.0.0'}, {'label': 'wrong'}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                releases.identity(build(**change), TAG, SHA)

    def test_staging_has_its_own_real_asset_base(self):
        candidate = build('/slamdemonium/release-candidate/')
        with self.assertRaisesRegex(ValueError, 'resolve its assets'):
            releases.identity(candidate, TAG, SHA)
        releases.identity(candidate, TAG, SHA, '/slamdemonium/release-candidate/')
        with self.assertRaises(ValueError):
            releases.check_base('<script src="/slamdemonium/missing.js"></script>', '/slamdemonium/', {'index.html'})

    def test_canonical_zip_is_stable_and_retains_exact_file_bytes(self):
        data = build()
        canonical = releases.canonical_zip(data)
        self.assertEqual(releases.canonical_zip(canonical), canonical)
        with zipfile.ZipFile(io.BytesIO(data)) as old, zipfile.ZipFile(io.BytesIO(canonical)) as new:
            for name in old.namelist():
                self.assertEqual(old.read(name), new.read(name))

    def test_http_verifier_rejects_stale_bytes_and_missing_assets(self):
        class Handler(SimpleHTTPRequestHandler):
            def log_message(self, *args):
                pass

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            expected = root / 'expected'
            served = root / 'served'
            expected.mkdir()
            pages.install_artifact(expected, build())
            shutil.copytree(expected, served)
            server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=str(served)))
            thread = Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                url = f'http://127.0.0.1:{server.server_port}/'
                releases.verify_directory(expected, url, timeout=0)
                (served / 'assets/game.js').write_text('stale')
                with self.assertRaisesRegex(RuntimeError, 'Served bytes differ'):
                    releases.verify_directory(expected, url, timeout=0)
                (served / 'assets/game.js').unlink()
                with self.assertRaisesRegex(RuntimeError, '404'):
                    releases.verify_directory(expected, url, timeout=0)
            finally:
                server.shutdown()
                server.server_close()
                thread.join()

    def test_cached_clients_keep_prior_hashed_assets_without_reusing_old_entry_points(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'assets').mkdir()
            (root / 'assets/old-AbCd1234.js').write_bytes(b'old hashed asset')
            (root / 'assets/unversioned.js').write_bytes(b'not retained')
            (root / 'index.html').write_text('old entry point')
            data = releases.canonical_zip(build(), root)
            releases.identity(data, TAG, SHA)
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                self.assertEqual(archive.read('assets/old-AbCd1234.js'), b'old hashed asset')
                self.assertNotIn('assets/unversioned.js', archive.namelist())
                self.assertNotEqual(archive.read('index.html'), b'old entry point')
            (root / 'assets/old-AbCd1234.js').write_bytes(b'collision')
            with self.assertRaisesRegex(ValueError, 'collision'):
                releases.canonical_zip(data, root)


class SafetyTests(unittest.TestCase):
    def test_cut_requires_all_existing_checks_and_preserves_bootstrap_selection(self):
        documents = {
            'package.json': {'version': '0.1.0'},
            'package-lock.json': {'version': '0.1.0', 'packages': {'': {'version': '0.1.0'}}},
            '.github/release-bootstrap.json': {'revision': 'c' * 40},
        }
        checks = [{'name': name, 'app': {'id': 15368}, 'status': 'completed', 'conclusion': 'success'}
                  for name in releases.REQUIRED_CHECKS]

        def fake_api(repo, path, **kwargs):
            if path == 'releases/latest':
                return None
            if path.startswith('commits/'):
                return {'check_runs': checks}
            raise AssertionError(path)

        with patch.dict(os.environ, {'GITHUB_REF': 'refs/heads/main', 'CUT_RELEASE': 'true'}), \
                patch.object(releases.Path, 'read_text', lambda path: json.dumps(documents[str(path)])), \
                patch.object(releases.subprocess, 'check_output', return_value=SHA + '\n'), \
                patch.object(releases, 'api', side_effect=fake_api), \
                patch.object(releases, 'tag_commit', return_value=None), \
                patch.object(releases, 'output') as output:
            releases.select('owner/repo', Path('/unused'))
            values = dict(call.args for call in output.call_args_list)
            self.assertEqual(values['production_sha'], 'c' * 40)
            self.assertEqual(values['production_tag'], '')
            checks[0]['conclusion'] = 'failure'
            with self.assertRaisesRegex(ValueError, 'successful checks'):
                releases.select('owner/repo', Path('/unused'))
            checks[0]['conclusion'] = 'success'
            checks[0]['app']['id'] = 999
            with self.assertRaisesRegex(ValueError, 'successful checks'):
                releases.select('owner/repo', Path('/unused'))

    def test_cannot_release_from_a_non_main_ref(self):
        with patch.dict(os.environ, {'GITHUB_REF': 'refs/heads/feature'}), \
                patch.object(releases, 'api') as api:
            with self.assertRaisesRegex(ValueError, 'main'):
                releases.select('owner/repo', Path('/unused'))
            api.assert_not_called()

    def test_draft_and_retained_asset_are_created_before_production_promotion(self):
        data = releases.canonical_zip(build())
        digest = 'sha256:' + hashlib.sha256(data).hexdigest()
        draft = {'id': 99, 'draft': True, 'assets': []}
        published = copy.deepcopy(draft)
        published['assets'] = [{'name': releases.ASSET, 'digest': digest}]
        calls = []

        def fake_api(repo, path, **kwargs):
            calls.append((path, kwargs))
            if path == 'git/refs':
                self.assertEqual(kwargs['data'], {'ref': 'refs/tags/v0.1.0', 'sha': SHA})
                return {}
            if path == 'releases/tags/v0.1.0':
                return None
            if path == 'releases':
                self.assertTrue(kwargs['data']['draft'])
                self.assertTrue(kwargs['data']['generate_release_notes'])
                return draft
            if path == 'releases/99':
                return published
            raise AssertionError(path)

        with tempfile.TemporaryDirectory() as temporary, patch.dict(os.environ, {
            'CUT_TAG': TAG, 'MAIN_SHA': SHA, 'GITHUB_RUN_ID': '123',
        }), patch.object(releases, 'artifact', return_value=build()), \
                patch.object(releases, 'tag_commit', return_value=None), \
                patch.object(releases, 'api', side_effect=fake_api), \
                patch.object(releases.subprocess, 'run') as upload:
            root = Path(temporary)
            (root / 'pages-site').mkdir()
            pages.install_artifact(root / 'pages-site', build(label='previous'))
            releases.stage_release('owner/repo', root)
            self.assertNotIn('--clobber', upload.call_args.args[0])
            self.assertEqual((root / releases.ASSET).read_bytes(), data)
            self.assertEqual(json.loads((root / 'pages-site/build-info.json').read_text())['label'], 'previous')
            self.assertEqual(json.loads((root / 'pages-release/build-info.json').read_text())['label'], f'RELEASE {TAG} · {SHA[:7]}')
            self.assertFalse(any(options.get('method') == 'PATCH' for _, options in calls))

    def test_existing_tag_is_never_moved(self):
        with tempfile.TemporaryDirectory() as temporary, patch.dict(os.environ, {
            'CUT_TAG': TAG, 'MAIN_SHA': SHA, 'GITHUB_RUN_ID': '123',
        }), patch.object(releases, 'artifact', return_value=build()), \
                patch.object(releases, 'api', return_value={'object': {'type': 'commit', 'sha': 'b' * 40}}) as api:
            with self.assertRaisesRegex(ValueError, 'never moved'):
                releases.stage_release('owner/repo', Path(temporary))
            self.assertEqual(api.call_count, 1)
            self.assertNotIn('method', api.call_args.kwargs)

    def test_published_release_and_different_draft_asset_are_not_overwritten(self):
        for draft, assets in ((False, []), (True, [{'name': releases.ASSET, 'digest': 'sha256:wrong'}])):
            release = {'id': 1, 'draft': draft, 'assets': assets}
            with tempfile.TemporaryDirectory() as temporary, patch.dict(os.environ, {
                'CUT_TAG': TAG, 'MAIN_SHA': SHA, 'GITHUB_RUN_ID': '123',
            }), patch.object(releases, 'artifact', return_value=build()), \
                    patch.object(releases, 'tag_commit', return_value=SHA), \
                    patch.object(releases, 'api', return_value=release) as api:
                with self.assertRaises(ValueError):
                    releases.stage_release('owner/repo', Path(temporary))
                self.assertEqual(api.call_count, 1)

    def test_download_checks_published_tag_and_github_asset_digest(self):
        data = build()
        release = {'draft': False, 'prerelease': False, 'assets': [{
            'name': releases.ASSET, 'id': 1, 'size': len(data),
            'digest': 'sha256:' + hashlib.sha256(data).hexdigest(),
        }]}
        with patch.object(releases, 'api', return_value=release), \
                patch.object(releases, 'tag_commit', return_value=SHA), \
                patch.object(releases.subprocess, 'check_output', return_value=data):
            self.assertEqual(releases.download_release('owner/repo', TAG, SHA), data)
            release['assets'][0]['digest'] = 'sha256:wrong'
            with self.assertRaisesRegex(ValueError, 'checksum'):
                releases.download_release('owner/repo', TAG, SHA)
            release['draft'] = True
            with self.assertRaisesRegex(ValueError, 'provenance'):
                releases.download_release('owner/repo', TAG, SHA)

    def test_stage_promote_preserves_previews_and_previous_site_for_rollback(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            snapshot = root / 'snapshot'
            snapshot.mkdir()
            pages.install_artifact(snapshot, build('/slamdemonium/pr/7/'), 7)
            previous = build(label='previous')
            pages.assemble_site(snapshot, previous, root / 'stage',
                                build('/slamdemonium/main/'), build('/slamdemonium/release-candidate/'))
            with zipfile.ZipFile(io.BytesIO(previous)) as archive:
                for name in archive.namelist():
                    self.assertEqual((root / 'stage' / name).read_bytes(), archive.read(name))
            self.assertIn('UNRELEASED MAIN PREVIEW', (root / 'stage/main/index.html').read_text())
            self.assertIn('UNRELEASED RELEASE CANDIDATE', (root / 'stage/release-candidate/index.html').read_text())
            shutil.copytree(root / 'stage', root / 'promoted')
            pages.install_artifact(root / 'promoted', build())
            for namespace in ('pr', 'main', 'release-candidate'):
                for path in (root / 'stage' / namespace).rglob('*'):
                    if path.is_file():
                        self.assertEqual(path.read_bytes(), (root / 'promoted' / path.relative_to(root / 'stage')).read_bytes())
            self.assertEqual(json.loads((root / 'stage/build-info.json').read_text())['label'], 'previous')
            self.assertEqual(json.loads((root / 'promoted/build-info.json').read_text())['label'], f'RELEASE {TAG} · {SHA[:7]}')


if __name__ == '__main__':
    unittest.main()
