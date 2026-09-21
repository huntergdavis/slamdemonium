import copy
import gzip
import importlib.util
import io
import json
import os
from pathlib import Path
import random
import tempfile
import unittest
from unittest.mock import patch
import zipfile


ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('bundle_size', ROOT / '.github/scripts/bundle_size.py')
bundle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bundle)
POLICY = json.loads((ROOT / '.github/bundle-baseline.json').read_text())['allowance']


class BundleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.dist = self.root / 'dist'
        (self.dist / 'assets').mkdir(parents=True)
        (self.dist / '.vite').mkdir()
        self.write('index.html', b'<main>Game</main>')
        self.write('assets/game-AbCd1234.js', random.Random(1).randbytes(100000))
        self.write('assets/engine-XyZ_1234.wasm', random.Random(2).randbytes(200000))
        self.manifest = {
            'index.html': {'file': 'assets/game-AbCd1234.js', 'src': 'index.html', 'isEntry': True},
            'src/engine.wasm': {'file': 'assets/engine-XyZ_1234.wasm', 'src': 'src/engine.wasm'},
        }
        self.write_manifest()
        self.measurement = self.measure()
        self.baseline = {'schemaVersion': 1, 'reason': 'Reviewed fixture',
                         'allowance': copy.deepcopy(POLICY), 'measurement': copy.deepcopy(self.measurement)}

    def write(self, file, data):
        path = self.dist / file
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def write_manifest(self):
        (self.dist / bundle.MANIFEST).write_text(json.dumps(self.manifest))

    def measure(self):
        return bundle.measure(self.dist, 'a' * 40, {'fixture': True})

    def totals(self, measurement):
        measurement['total'] = {metric: sum(a[metric] for a in measurement['assets'].values())
                                for metric in bundle.METRICS}
        return measurement

    def report(self, measurement=None):
        measurement = measurement or self.measurement
        failures = bundle.evaluate(measurement, self.baseline)
        return {'schemaVersion': 1, 'recordedAt': '2026-09-21T00:00:00+00:00',
                'measurement': measurement, 'baseline': self.baseline,
                'baselineFingerprint': bundle.digest(self.baseline),
                'passed': not failures, 'failures': failures}

    def test_counts_public_binary_lazy_assets_and_only_excludes_instrumentation(self):
        data = random.Random(3).randbytes(2048)
        self.write('radio/track-12345678.mp3', data)
        self.write('.well-known/example.txt', b'public')
        measured = self.measure()
        self.assertIn('file:radio/track-12345678.mp3', measured['assets'])
        self.assertIn('file:.well-known/example.txt', measured['assets'])
        self.assertEqual(len(measured['assets']), 5)
        for asset in measured['assets'].values():
            source = (self.dist / asset['file']).read_bytes()
            self.assertEqual(asset['rawBytes'], len(source))
            self.assertEqual(asset['gzipBytes'], len(gzip.compress(source, compresslevel=6, mtime=0)))
        self.assertEqual(measured, self.measure())
        bundle.validate_measurement(measured)

    def test_hash_rename_keeps_source_and_generated_css_identity(self):
        self.write('assets/game-AbCd1234.css', b'body{}')
        self.manifest['index.html']['css'] = ['assets/game-AbCd1234.css']
        self.write_manifest()
        baseline = {**self.baseline, 'measurement': self.measure()}
        for extension in ('js', 'css'):
            (self.dist / f'assets/game-AbCd1234.{extension}').rename(self.dist / f'assets/game-zyXw9876.{extension}')
        self.manifest['index.html']['file'] = 'assets/game-zyXw9876.js'
        self.manifest['index.html']['css'] = ['assets/game-zyXw9876.css']
        self.write_manifest()
        self.assertEqual(bundle.evaluate(self.measure(), baseline), [])

    def test_existing_asset_exact_limit_passes_and_one_byte_over_fails(self):
        for metric in bundle.METRICS:
            measured = copy.deepcopy(self.measurement)
            identity = 'source:index.html'
            limit = bundle.asset_limit(identity, metric, self.baseline)
            measured['assets'][identity][metric] = limit
            failures = bundle.evaluate(self.totals(measured), self.baseline)
            self.assertFalse(any(f['identity'] == identity and f['metric'] == metric for f in failures))
            measured['assets'][identity][metric] += 1
            failures = bundle.evaluate(self.totals(measured), self.baseline)
            failure = next(f for f in failures if f['identity'] == identity and f['metric'] == metric)
            self.assertEqual(failure['excess'], 1)
            self.assertEqual(failure['file'], 'assets/game-AbCd1234.js')

    def test_asset_growth_cannot_hide_behind_removed_asset_savings(self):
        measured = copy.deepcopy(self.measurement)
        del measured['assets']['source:src/engine.wasm']
        measured['assets']['source:index.html']['rawBytes'] += 15000
        failures = bundle.evaluate(self.totals(measured), self.baseline)
        self.assertTrue(any(f['file'] == 'assets/game-AbCd1234.js' for f in failures))
        self.assertFalse(any(f['file'] == 'TOTAL' for f in failures))

    def test_total_boundary_and_many_small_new_files(self):
        for metric in bundle.METRICS:
            measured = copy.deepcopy(self.measurement)
            allowed = bundle.growth(measured['total'][metric], POLICY['totalPercent'])
            measured['assets']['file:one.bin'] = {'file': 'one.bin', 'rawBytes': 0, 'gzipBytes': 20, 'sha256': '0' * 64}
            measured['assets']['file:one.bin'][metric] = allowed
            failures = bundle.evaluate(self.totals(measured), self.baseline)
            self.assertFalse(any(f['file'] == 'TOTAL' and f['metric'] == metric for f in failures))
            measured['assets']['file:two.bin'] = {'file': 'two.bin', 'rawBytes': 1, 'gzipBytes': 20, 'sha256': '1' * 64}
            failures = bundle.evaluate(self.totals(measured), self.baseline)
            self.assertTrue(any(f['file'] == 'TOTAL' and f['metric'] == metric for f in failures))
            self.assertFalse(any(f['file'] != 'TOTAL' for f in failures))

    def test_new_asset_has_explicit_raw_and_gzip_limits(self):
        measured = copy.deepcopy(self.measurement)
        measured['assets']['file:car.glb'] = {'file': 'car.glb', 'sha256': '1' * 64,
                                            **{metric: POLICY['newAssetBytes'][metric] + 1 for metric in bundle.METRICS}}
        failures = bundle.evaluate(self.totals(measured), self.baseline)
        asset_failures = [f for f in failures if f['file'] == 'car.glb']
        self.assertEqual(len(asset_failures), 2)
        self.assertTrue(all(f['excess'] == 1 for f in asset_failures))

    def test_minimum_headroom_applies_to_tiny_files(self):
        for metric in bundle.METRICS:
            actual = bundle.asset_limit('file:index.html', metric, self.baseline)
            expected = self.measurement['assets']['file:index.html'][metric] + POLICY['assetMinimumBytes'][metric]
            self.assertEqual(actual, expected)

    def test_rejects_missing_output_symlinks_and_bad_manifest_paths(self):
        with self.assertRaises(ValueError):
            bundle.measure(self.root / 'missing', 'a' * 40, {})
        (self.dist / 'link').symlink_to(self.root)
        with self.assertRaisesRegex(ValueError, 'Symlink'):
            self.measure()
        (self.dist / 'link').unlink()
        for path in ('../outside.js', '/outside.js', 'assets/missing.js'):
            self.manifest['index.html']['file'] = path
            self.write_manifest()
            with self.assertRaises(ValueError):
                self.measure()

    def test_rejects_identity_collisions_instead_of_merging_budgets(self):
        self.write('assets/shared-12345678.css', b'a{}')
        self.write('assets/shared-abcdefgh.css', b'b{}')
        self.manifest['index.html']['css'] = ['assets/shared-12345678.css', 'assets/shared-abcdefgh.css']
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, 'collision'):
            self.measure()

    def test_rejects_malformed_or_inconsistent_baselines(self):
        for mutate in (
            lambda b: b.update(reason=''),
            lambda b: b['allowance'].update(totalPercent=float('nan')),
            lambda b: b['measurement']['total'].update(rawBytes=0),
            lambda b: b['measurement']['method'].update(level=9),
            lambda b: b['allowance']['newAssetBytes'].update(rawBytes=True),
        ):
            baseline = copy.deepcopy(self.baseline)
            mutate(baseline)
            with self.assertRaises(ValueError):
                bundle.validate_baseline(baseline)
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            bundle.read_json('{"x":1,"x":2}')

    def test_summary_names_files_deltas_total_contributors_and_history(self):
        measured = copy.deepcopy(self.measurement)
        measured['assets']['source:index.html']['rawBytes'] += 20000
        report = self.report(self.totals(measured))
        prior = [{'runId': 10, 'url': 'https://github.com/example/repo/actions/runs/10', 'report': self.report()}]
        summary = bundle.render(report, prior, [])
        for text in ('assets/game-AbCd1234.js', '+20,000 B', 'exceeded by', 'Contributor:',
                     'Recent main trend', '[10]', 'do not move automatically', 'not a measured cold-load'):
            self.assertIn(text, summary)
        self.assertIn('&lt;script&gt;&#124;', bundle.safe('<script>|'))

    def archive(self, report, name='bundle-size.json'):
        value = io.BytesIO()
        with zipfile.ZipFile(value, 'w') as archive:
            archive.writestr(name, json.dumps(report))
        return value.getvalue()

    def test_history_archive_validation_never_extracts_paths(self):
        report = self.report()
        self.assertEqual(bundle.read_archive(self.archive(report)), report)
        with self.assertRaises(ValueError):
            bundle.read_archive(self.archive(report, '../bundle-size.json'))
        report['passed'] = False
        with self.assertRaises(ValueError):
            bundle.read_archive(self.archive(report))

    def test_history_filters_other_events_expired_artifacts_and_wrong_revisions(self):
        report = self.report()
        runs = [{'id': number, 'head_branch': 'main', 'event': 'push', 'conclusion': 'success',
                 'head_sha': ('b' if number == 2 else 'a') * 40} for number in range(1, 6)]
        runs[3]['event'] = 'pull_request'
        runs[4]['head_branch'] = 'feature'
        def api(path, binary=False):
            if '/workflows/' in path:
                return {'workflow_runs': runs}
            if path.endswith('/artifacts'):
                number = int(path.split('/')[-2])
                return {'artifacts': [{'id': number, 'name': bundle.ARTIFACT, 'expired': number == 3, 'size_in_bytes': 1000}]}
            return self.archive(report)
        with patch.dict(os.environ, {'GH_TOKEN': 'test-read-token'}), patch.object(bundle, 'gh', side_effect=api):
            prior, warnings = bundle.history('example/repo', 99)
        self.assertEqual([row['runId'] for row in prior], [1])
        self.assertEqual(len(warnings), 1)

    def test_history_outage_does_not_change_current_gate(self):
        with patch.dict(os.environ, {'GH_TOKEN': 'test-read-token'}), patch.object(bundle, 'gh', side_effect=OSError):
            prior, warnings = bundle.history('example/repo', 99)
        self.assertEqual(prior, [])
        self.assertTrue(warnings)
        self.assertEqual(bundle.evaluate(self.measurement, self.baseline), [])

    def cli(self, extra=(), actions='false'):
        baseline_path = self.root / 'baseline.json'
        if not baseline_path.exists():
            baseline_path.write_text(json.dumps(self.baseline))
        output = self.root / 'report.json'
        arguments = ['bundle_size.py', '--dist', str(self.dist), '--baseline', str(baseline_path),
                     '--output', str(output), '--no-history', *extra]
        def command(args, **kwargs):
            return 'a' * 40 if args[0] == 'git' else '{"node":"test","vite":"test"}'
        with patch('sys.argv', arguments), patch.object(bundle.subprocess, 'check_output', side_effect=command), \
                patch.dict(os.environ, {'GITHUB_ACTIONS': actions, 'GITHUB_STEP_SUMMARY': str(self.root / 'summary.md')}):
            code = bundle.main()
        return code, json.loads(output.read_text())

    def test_cli_exit_codes_and_reports_follow_real_file_growth(self):
        self.assertEqual(self.cli()[0], 0)
        self.write('car.glb', random.Random(9).randbytes(100000))
        code, report = self.cli()
        self.assertEqual(code, 1)
        self.assertTrue(any(f['file'] == 'car.glb' for f in report['failures']))
        self.assertIn('car.glb', (self.root / 'report.md').read_text())

    def test_baseline_update_is_explicit_preserves_policy_and_is_forbidden_in_ci(self):
        self.cli()
        path = self.root / 'baseline.json'
        before = path.read_bytes()
        self.write('car.glb', random.Random(9).randbytes(100000))
        self.assertEqual(self.cli(['--record-baseline', 'Approved model'], actions='true')[0], 1)
        self.assertEqual(path.read_bytes(), before)
        self.assertEqual(self.cli(['--record-baseline', ''])[0], 1)
        self.assertEqual(path.read_bytes(), before)
        self.assertEqual(self.cli(['--record-baseline', 'Approved model'])[0], 0)
        updated = json.loads(path.read_text())
        self.assertEqual(updated['reason'], 'Approved model')
        self.assertEqual(updated['allowance'], self.baseline['allowance'])
        self.assertIn('file:car.glb', updated['measurement']['assets'])


if __name__ == '__main__':
    unittest.main()
