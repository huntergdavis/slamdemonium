# Production payload budget

`Bundle size` is a required PR check. It also records each main push and supports manual diagnostics. Size is deterministic for a given build/toolchain, so there is no timing-based advisory mode. Existing CI and Reachability remain separate required checks.

The only budget source is [bundle-baseline.json](bundle-baseline.json): the reviewed production measurement, its source revision, a written reason, and all growth allowances. The check never moves that baseline automatically. Small changes accumulate against it rather than getting a fresh allowance on every commit.

The policy permits modest total growth and a separate allowance per asset, with a small byte floor for tiny files. New assets have explicit limits too, and still count toward the total. **A first car model can consume the entire total allowance by itself. A failure there is the intended review point, not a broken budget.** Larger intentional models, music, sound effects or maps belong in a feature PR with a reasoned baseline update. Do not raise limits or rebaseline automatically just to turn a check green.

## Small-asset calibration

An existing asset's limit is its recorded size plus the larger of its percentage allowance and its byte floor, calculated separately for raw and gzip bytes. The raw floor is 4 KiB; the gzip floor remains 1 KiB. The percentage allowance remains 10 percent, so the raw floor affects existing assets recorded below 40 KiB. This is a general small-asset rule, including HTML and small JavaScript files; CSS keeps its own gate alongside the unchanged 5 percent total cap and explicit new-asset limits.

The approved WP18 and WP19 UI changes added 4,015 and 3,957 raw CSS bytes. Both exceeded the original 2 KiB floor while adding little to total downloads. A 4 KiB floor is the smallest whole-KiB allowance that accommodates either measured increment. With the WP18 baseline unchanged, WP19 would leave only 139 raw and 313 gzip CSS bytes of headroom. This is cumulative room from the reviewed baseline, not a fresh allowance per feature or PR: further changes can still require an explained baseline update. The allowance rationale lives beside its values in `bundle-baseline.json`; calibrating policy does not refresh recorded measurements.

## What the numbers mean

The job builds with the production `/slamdemonium/` base path, using `npm run build -- --manifest`. Every file under `dist/` counts, including WASM, lazy chunks, public audio/models/maps, hidden files and any source maps. Gzip sizes are measured independently per file at level 6 with a zero timestamp and then summed. They are a normalized transfer estimate, not a cold-load measurement: caching, lazy requests and the server's actual content encoding affect what a player downloads. Already compressed media may gain nothing from gzip; the raw gate remains meaningful.

Only `.vite/manifest.json`, generated specifically for measurement, is excluded. Vite's manifest identifies source assets across content-hash filename changes. Generated chunk/CSS hashes are normalized only for paths identified by Vite; public filenames are preserved. Ambiguous identities, missing files, symlinks, malformed baselines and inconsistent reports fail closed. Changing the naming convention may require an explicit analyzer update.

The initial normal and instrumented builds were verified to produce byte-identical application files. This workflow does not deploy anything or modify Pages. The manifest behavior is described in [Vite's build options](https://vite.dev/config/build-options#build-manifest) and [manifest format](https://vite.dev/guide/backend-integration).

The baseline records the design section 16 WASM payload risk. Physics is already loaded through a dynamic import in `src/main.ts`, after the initial renderer is created and rendered. WASM is outside the initial static module graph; boot still waits for physics before the game becomes drivable. Further deferral remains an option if measured loading performance warrants it. These byte measurements do not establish a first-paint time or broadband readiness time.

## Reproduce a check

```sh
npm ci
VITE_BASE_PATH=/slamdemonium/ npm run build -- --manifest
python3 .github/scripts/bundle_size.py --no-history
```

The exit code is 0 for an accepted budget and 1 for growth or a broken measurement. `test-results/bundle-size.json` preserves every asset's actual filename, stable identity, SHA-256 and exact raw/gzip bytes, plus the baseline snapshot, method and toolchain. `test-results/bundle-size.md` is the human-readable report. Failures name the file, baseline size, growth, limit and bytes over budget; total-only failures also name the largest contributors.

## Intentional growth

1. Build and check the feature with the commands above. Inspect the added bytes and decide whether compression, reuse, lazy loading or removing unused content is appropriate. Lazy loading changes loading behavior, but does not exempt shipped bytes from this budget.
2. Commit the intended source/assets so the measured revision is identifiable, rebuild, then explicitly record the new baseline:

   ```sh
   python3 .github/scripts/bundle_size.py --record-baseline "Explain the approved payload increase and its player benefit" --no-history
   ```

3. Review the baseline diff in the feature PR. The command updates measured sizes and the reason while preserving growth allowances. The PM reviews and merges it with the feature. CI refuses to run the baseline-update mode.

## Trend and retention

Every run publishes a summary with total/per-asset raw and gzip sizes, deltas and limits, and up to five previous completed main measurements. Reports and summaries are retained as `bundle-size-results` artifacts for 90 days, including budget failures. Each history row shows its budget fingerprint so a rebaseline cannot silently disguise growth. Missing/expired history or API failures are visible but do not bypass or fail the current size gate. History artifacts are bounded JSON data, never extracted or executed; their revisions must match their main runs.

Run the tooling tests with `python3 -m unittest discover -s .github/tests -v` and validate workflow changes with `actionlint`.
