"""Measure shipped bytes and enforce a reviewed, never automatically moved budget."""

import argparse
from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import html
import io
import json
import math
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import time
import zipfile
import zlib


ROOT = Path(__file__).resolve().parents[2]
BASELINE = ROOT / '.github/bundle-baseline.json'
MANIFEST = '.vite/manifest.json'
ARTIFACT = 'bundle-size-results'
METRICS = ('rawBytes', 'gzipBytes')
METHOD = {'basePath': '/slamdemonium/', 'compression': 'gzip', 'level': 6,
          'mtime': 0, 'aggregation': 'sum of independently compressed files',
          'excludedInstrumentation': [MANIFEST]}


def read_json(value):
    def unique(pairs):
        result = {}
        for key, item in pairs:
            if key in result:
                raise ValueError(f'Duplicate JSON key: {key}')
            result[key] = item
        return result
    return json.loads(value, object_pairs_hook=unique)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def relative_path(value):
    if (not isinstance(value, str) or not value or '\\' in value
            or any(ord(char) < 32 for char in value)
            or PurePosixPath(value).is_absolute()
            or any(part in ('', '.', '..') for part in value.split('/'))):
        raise ValueError(f'Invalid asset path: {value!r}')
    return value


def unhash(value):
    # Only apply this to generated paths identified by Vite, never public filenames.
    return re.sub(r'-[A-Za-z0-9_-]{8}(?=\.[^/]+$)', '', value)


def identities(manifest, files):
    candidates = {}
    for key, entry in manifest.items():
        file = relative_path(entry['file'])
        if file not in files:
            raise ValueError(f'Manifest references missing asset: {file}')
        generated = key.startswith('_') and not entry.get('isDynamicEntry') and not entry.get('isEntry')
        identity = ('generated:' + unhash(file) if generated else
                    'source:' + entry.get('src', key))
        candidates.setdefault(file, set()).add(identity)
        for css in entry.get('css', []):
            css = relative_path(css)
            if css not in files:
                raise ValueError(f'Manifest references missing CSS: {css}')
            candidates.setdefault(css, set()).add('generated:' + unhash(css))
        for asset in entry.get('assets', []):
            if relative_path(asset) not in files:
                raise ValueError(f'Manifest references missing asset: {asset}')
    # Content-deduplicated aliases choose one canonical source identity.
    result = {file: sorted(names)[0] for file, names in candidates.items()}
    for file in files:
        if file not in result:
            if file.endswith('.map') and file[:-4] in result:
                result[file] = 'sourcemap:' + result[file[:-4]]
            else:
                result[file] = 'file:' + file
    if len(set(result.values())) != len(result):
        raise ValueError('Asset identity collision: generated filenames must have distinct stable names')
    return result


def measure_file(path):
    compressor = zlib.compressobj(METHOD['level'], zlib.DEFLATED, 31)
    raw = compressed = 0
    sha = hashlib.sha256()
    with path.open('rb') as stream:
        while chunk := stream.read(1024 * 1024):
            raw += len(chunk)
            sha.update(chunk)
            compressed += len(compressor.compress(chunk))
    compressed += len(compressor.flush())
    return {'rawBytes': raw, 'gzipBytes': compressed, 'sha256': sha.hexdigest()}


def measure(directory, revision, toolchain):
    directory = Path(directory)
    if directory.is_symlink():
        raise ValueError('Symlink used as production output directory')
    files = []
    for path in sorted(directory.rglob('*')):
        if path.is_symlink():
            raise ValueError(f'Symlink in production output: {path}')
        if path.is_file():
            name = relative_path(path.relative_to(directory).as_posix())
            if name != MANIFEST:
                files.append(name)
    if 'index.html' not in files or not (directory / 'index.html').stat().st_size:
        raise ValueError('Missing or empty production dist/index.html')
    manifest = read_json((directory / MANIFEST).read_text())
    if not isinstance(manifest, dict) or not manifest:
        raise ValueError('Missing Vite manifest entries')
    names = identities(manifest, files)
    assets = {names[file]: {'file': file, **measure_file(directory / file)} for file in files}
    return {'revision': revision, 'method': METHOD, 'toolchain': toolchain,
            'assets': assets,
            'total': {metric: sum(asset[metric] for asset in assets.values()) for metric in METRICS}}


def integer(value):
    if type(value) is not int or value < 0:
        raise ValueError('Size measurements and byte allowances must be nonnegative integers')
    return value


def validate_measurement(measurement):
    if measurement['method'] != METHOD:
        raise ValueError('Measurement method changed; review the baseline and compression/base-path policy')
    if not re.fullmatch(r'[a-f0-9]{40}', measurement['revision']):
        raise ValueError('Missing measured Git revision')
    assets = measurement['assets']
    if not isinstance(assets, dict) or not assets:
        raise ValueError('Missing asset measurements')
    files = set()
    for identity, asset in assets.items():
        if not isinstance(identity, str) or not identity:
            raise ValueError('Missing stable asset identity')
        file = relative_path(asset['file'])
        if file == MANIFEST or file in files:
            raise ValueError('Duplicate file or instrumentation counted as shipped payload')
        files.add(file)
        for metric in METRICS:
            integer(asset[metric])
        if not re.fullmatch(r'[a-f0-9]{64}', asset['sha256']):
            raise ValueError('Missing asset content fingerprint')
    if 'index.html' not in files:
        raise ValueError('Measurement lacks production HTML')
    for metric in METRICS:
        total = integer(measurement['total'][metric])
        if total == 0 or total != sum(asset[metric] for asset in assets.values()):
            raise ValueError(f'Asset sum disagrees with {metric} total')


def validate_baseline(baseline):
    if (type(baseline['schemaVersion']) is not int or baseline['schemaVersion'] != 1
            or not isinstance(baseline['reason'], str) or not baseline['reason'].strip()):
        raise ValueError('Baseline requires schemaVersion 1 and a written reason')
    validate_measurement(baseline['measurement'])
    policy = baseline['allowance']
    for key in ('totalPercent', 'assetPercent'):
        value = policy[key]
        if type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= 1000:
            raise ValueError('Invalid growth percentage')
    for key in ('assetMinimumBytes', 'newAssetBytes'):
        for metric in METRICS:
            integer(policy[key][metric])


def growth(value, percent):
    return int(Decimal(value) * Decimal(str(percent)) / 100)


def asset_limit(identity, metric, baseline):
    old = baseline['measurement']['assets'].get(identity)
    policy = baseline['allowance']
    if old is None:
        return policy['newAssetBytes'][metric]
    return old[metric] + max(growth(old[metric], policy['assetPercent']), policy['assetMinimumBytes'][metric])


def evaluate(measurement, baseline):
    validate_measurement(measurement)
    validate_baseline(baseline)
    failures = []
    for identity, asset in sorted(measurement['assets'].items()):
        old = baseline['measurement']['assets'].get(identity, {})
        for metric in METRICS:
            limit = asset_limit(identity, metric, baseline)
            if asset[metric] > limit:
                failures.append({'file': asset['file'], 'identity': identity, 'metric': metric,
                                 'baseline': old.get(metric, 0), 'actual': asset[metric], 'limit': limit,
                                 'delta': asset[metric] - old.get(metric, 0), 'excess': asset[metric] - limit})
    for metric in METRICS:
        old = baseline['measurement']['total'][metric]
        limit = old + growth(old, baseline['allowance']['totalPercent'])
        actual = measurement['total'][metric]
        if actual > limit:
            failures.append({'file': 'TOTAL', 'identity': 'TOTAL', 'metric': metric,
                             'baseline': old, 'actual': actual, 'limit': limit,
                             'delta': actual - old, 'excess': actual - limit})
    return failures


def validate_report(report):
    if (type(report['schemaVersion']) is not int or report['schemaVersion'] != 1
            or report['baselineFingerprint'] != digest(report['baseline'])):
        raise ValueError('Invalid report or baseline fingerprint')
    failures = evaluate(report['measurement'], report['baseline'])
    if report['failures'] != failures or type(report['passed']) is not bool or report['passed'] != (not failures):
        raise ValueError('Report verdict disagrees with its measurements')
    return report


def read_archive(data):
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        entries = [entry for entry in archive.infolist() if entry.filename == 'bundle-size.json']
        if len(entries) != 1 or entries[0].file_size > 2 * 1024 * 1024:
            raise ValueError('Missing, duplicate, or oversized history report')
        return validate_report(read_json(archive.read(entries[0])))


def gh(path, binary=False):
    value = subprocess.check_output(['gh', 'api', path], timeout=10, stderr=subprocess.PIPE)
    return value if binary else read_json(value)


def history(repo, run_id):
    if not os.environ.get('GH_TOKEN') or not repo:
        return [], ['Main history was not fetched: no GitHub read token/repository available.']
    prior, warnings = [], []
    started = time.monotonic()
    try:
        runs = gh(f'repos/{repo}/actions/workflows/bundle-size.yml/runs?branch=main&event=push&status=completed&per_page=20')['workflow_runs']
        for run in runs:
            if len(prior) == 5 or time.monotonic() - started > 40:
                break
            if (str(run['id']) == str(run_id) or run['head_branch'] != 'main'
                    or run['event'] != 'push' or run['conclusion'] not in ('success', 'failure')):
                continue
            try:
                artifacts = gh(f"repos/{repo}/actions/runs/{run['id']}/artifacts")['artifacts']
                artifact = next((a for a in artifacts if a['name'] == ARTIFACT and not a['expired']), None)
                if artifact is None:
                    continue
                if artifact['size_in_bytes'] > 20 * 1024 * 1024:
                    raise ValueError('Oversized history artifact')
                report = read_archive(gh(f"repos/{repo}/actions/artifacts/{artifact['id']}/zip", binary=True))
                if report['measurement']['revision'] != run['head_sha']:
                    raise ValueError('History artifact revision does not match its main run')
                prior.append({'runId': run['id'], 'url': f"https://github.com/{repo}/actions/runs/{run['id']}",
                              'report': report})
            except (ValueError, KeyError, TypeError, OSError, subprocess.SubprocessError, zipfile.BadZipFile) as error:
                warnings.append(f"Skipped main run {run['id']}: {type(error).__name__}")
    except (ValueError, KeyError, TypeError, OSError, subprocess.SubprocessError) as error:
        warnings.append(f'Main history unavailable: {type(error).__name__}; current size gate still applies.')
    return prior, warnings


def safe(value):
    return html.escape(str(value)).replace('|', '&#124;').replace('\n', ' ')


def delta(value, old):
    return f'{value - old:+,} B' + (f' ({(value - old) / old * 100:+.2f}%)' if old else ' (new)')


def failure_message(failure):
    return (f"{failure['file']} {failure['metric']}: {failure['actual']:,} B, "
            f"grew {failure['delta']:+,} B from {failure['baseline']:,} B; "
            f"limit {failure['limit']:,} B, exceeded by {failure['excess']:,} B.")


def contributors(failure, measurement, baseline):
    if failure['file'] != 'TOTAL':
        return []
    metric = failure['metric']
    old = baseline['measurement']['assets']
    increases = sorted(((asset[metric] - old.get(identity, {}).get(metric, 0), asset['file'])
                        for identity, asset in measurement['assets'].items()), reverse=True)
    return [f'Contributor: {file} grew +{amount:,} B {metric}.'
            for amount, file in increases[:3] if amount > 0]


def render(report, prior, warnings):
    measurement, baseline = report['measurement'], report['baseline']
    old = baseline['measurement']
    status = 'PASS' if report['passed'] else 'FAIL'
    lines = [f'## Bundle size: {status}', '',
             f"Measured commit: `{measurement['revision']}`. Baseline: `{old['revision']}` "
             f"(budget `{report['baselineFingerprint'][:12]}`).", '',
             'All shipped files are counted, including lazy assets and public files. Gzip is a normalized '
             'per-file level-6 estimate, not a measured cold-load transfer; the server may use another encoding. '
             'Only the CI instrumentation manifest is excluded.', '',
             '| Total | Current | Baseline | Change | Limit |', '|---|---:|---:|---:|---:|']
    for metric in METRICS:
        value, previous = measurement['total'][metric], old['total'][metric]
        limit = previous + growth(previous, baseline['allowance']['totalPercent'])
        lines.append(f'| {metric} | {value:,} B | {previous:,} B | {delta(value, previous)} | {limit:,} B |')
    lines += ['', f"Baseline reason: {safe(baseline['reason'])}", '',
              'Budgets do not move automatically. Intentional larger models/audio/maps need a reviewed '
              'baseline update with a written reason in the feature PR. A first car model may exceed the '
              'total allowance; that is the intended review point.', '',
              '### Asset sizes and changes', '',
              '| Actual file | Raw | Raw change | Raw limit | Gzip | Gzip change | Gzip limit |',
              '|---|---:|---:|---:|---:|---:|---:|']
    for identity, asset in sorted(measurement['assets'].items(), key=lambda item: -item[1]['gzipBytes']):
        previous = old['assets'].get(identity, {})
        cells = [safe(asset['file'])]
        for metric in METRICS:
            cells += [f'{asset[metric]:,} B', delta(asset[metric], previous.get(metric, 0)),
                      f'{asset_limit(identity, metric, baseline):,} B']
        lines.append('| ' + ' | '.join(cells) + ' |')
    removed = [asset['file'] for identity, asset in old['assets'].items() if identity not in measurement['assets']]
    if removed:
        lines += ['', 'Removed since baseline: ' + ', '.join(safe(file) for file in removed) + '.']
    if report['failures']:
        lines += ['', '### Budget failures', '']
        for failure in report['failures']:
            lines.append('- ' + safe(failure_message(failure)))
            lines += ['  - ' + safe(message) for message in contributors(failure, measurement, baseline)]
    new_assets = sorted(
        ((identity, asset['file'], asset) for identity, asset in measurement['assets'].items()
         if identity not in old['assets']),
        key=lambda item: (-item[2]['gzipBytes'], item[1]),
    )
    if new_assets:
        lines += ['', '### New assets in this measurement', '',
                  'Every new file has its own limit; review this complete list when a feature adds a batch of content.',
                  '', '| New file | Raw | Raw limit | Gzip | Gzip limit |',
                  '|---|---:|---:|---:|---:|']
        for identity, file, asset in new_assets:
            lines.append('| ' + ' | '.join((safe(file), f"{asset['rawBytes']:,} B",
                                             f"{asset_limit(identity, 'rawBytes', baseline):,} B",
                                             f"{asset['gzipBytes']:,} B",
                                             f"{asset_limit(identity, 'gzipBytes', baseline):,} B")) + ' |')
    lines += ['', '### Recent main trend', '',
              'Size columns remain useful across budget updates; verdicts use each run’s recorded budget.', '',
              '| Run / revision | Raw total | Gzip total | Budget | Result |',
              '|---|---:|---:|---|---|']
    for entry in prior:
        data = entry['report']
        totals = data['measurement']['total']
        lines.append(f"| [{entry['runId']}]({entry['url']}) / `{data['measurement']['revision'][:7]}` "
                     f"| {totals['rawBytes']:,} B | {totals['gzipBytes']:,} B "
                     f"| `{data['baselineFingerprint'][:12]}` | {'PASS' if data['passed'] else 'FAIL'} |")
    if not prior:
        lines += ['', 'No earlier main measurements were available.']
    lines += ['', *[safe(warning) for warning in warnings], '',
              '<details><summary>Measurement method and toolchain</summary>', '', '```json',
              json.dumps({'method': measurement['method'], 'toolchain': measurement['toolchain']}, indent=2),
              '```', '</details>', '']
    return '\n'.join(lines)


def write_outputs(report, summary, output):
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + '\n')
    output.with_suffix('.md').write_text(summary)
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as stream:
            stream.write(summary)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dist', default='dist')
    parser.add_argument('--baseline', default=str(BASELINE))
    parser.add_argument('--output', default='test-results/bundle-size.json')
    parser.add_argument('--record-baseline', metavar='WRITTEN_REASON')
    parser.add_argument('--no-history', action='store_true')
    args = parser.parse_args()
    try:
        baseline = read_json(Path(args.baseline).read_text())
        validate_baseline(baseline)
        revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
        node = subprocess.check_output(['node', '-p', 'JSON.stringify({node:process.version,vite:require("vite/package.json").version})'], text=True)
        tools = {**read_json(node), 'python': sys.version.split()[0], 'zlib': zlib.ZLIB_RUNTIME_VERSION}
        measurement = measure(args.dist, revision, tools)
        if args.record_baseline is not None:
            if os.environ.get('GITHUB_ACTIONS') == 'true' or not args.record_baseline.strip():
                raise ValueError('Baseline updates require an explicit local written reason; CI never updates budgets')
            baseline = {**baseline, 'reason': args.record_baseline, 'measurement': measurement}
            validate_baseline(baseline)
            Path(args.baseline).write_text(json.dumps(baseline, indent=2) + '\n')
        failures = evaluate(measurement, baseline)
        report = {'schemaVersion': 1, 'recordedAt': datetime.now(timezone.utc).isoformat(),
                  'measurement': measurement, 'baseline': baseline, 'baselineFingerprint': digest(baseline),
                  'failures': failures, 'passed': not failures}
        prior, warnings = ([], []) if args.no_history else history(os.environ.get('GITHUB_REPOSITORY'), os.environ.get('GITHUB_RUN_ID'))
        write_outputs(report, render(report, prior, warnings), args.output)
        print(f"Bundle size {'FAIL' if failures else 'PASS'}: {measurement['total']['rawBytes']:,} B raw / "
              f"{measurement['total']['gzipBytes']:,} B gzip across {len(measurement['assets'])} files.")
        for failure in failures:
            print(failure_message(failure))
            for message in contributors(failure, measurement, baseline):
                print(message)
        return int(bool(failures))
    except (ValueError, KeyError, TypeError, OSError, subprocess.SubprocessError) as error:
        message = f'Bundle size measurement failed: {error}'
        write_outputs({'schemaVersion': 1, 'measurementError': message}, '## Bundle size: ERROR\n\n' + safe(message) + '\n', args.output)
        print(message, file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
