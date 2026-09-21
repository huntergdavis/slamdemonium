# Production payload budget

`Bundle size` is a required PR check. It also records each main push and supports manual diagnostics. Size is deterministic for a given build/toolchain, so there is no timing-based advisory mode. Existing CI and Reachability remain separate required checks.

The only budget source is [bundle-baseline.json](bundle-baseline.json): the reviewed production measurement, its source revision, a written reason, and all growth allowances. The check never moves that baseline automatically. Small changes accumulate against it rather than getting a fresh allowance on every commit.

The policy permits modest total growth and a separate allowance per asset, with a small byte floor for tiny files. New assets have explicit limits too, and still count toward the total. **A first car model can consume the entire total allowance by itself. A failure there is the intended review point, not a broken budget.** Larger intentional models, music, sound effects or maps belong in a feature PR with a reasoned baseline update. Do not raise limits or rebaseline automatically just to turn a check green.

The cumulative 5 percent total cap guards against unreviewed growth. It is not a lifetime ceiling on the game's content. Explicit, feature-only additions to the reviewed inventory are the normal path for planned sound banks, models and maps. They need a measured inventory and a player-benefit rationale in the feature PR. Raising the global percentage to absorb planned content would also grant unrelated growth more room; approving the specific inventory keeps that decision visible.

Preserve every earlier asset measurement when adding content, so unrelated code and asset growth keeps accumulating against its existing baseline. Only an explicitly approved change to an existing asset may refresh that entry. Per-asset and new-asset gates remain in force as the inventory grows; a larger total never exempts a file from its own check.

## Small-asset calibration

An existing asset's limit is its recorded size plus the larger of its percentage allowance and its byte floor, calculated separately for raw and gzip bytes. The raw floor is 4 KiB; the gzip floor remains 1 KiB. The percentage allowance remains 10 percent, so the raw floor affects existing assets recorded below 40 KiB. This is a general small-asset rule, including HTML and small JavaScript files; CSS keeps its own gate alongside the unchanged 5 percent total cap and explicit new-asset limits.

The approved WP18 and WP19 UI changes added 4,015 and 3,957 raw CSS bytes. Both exceeded the original 2 KiB floor while adding little to total downloads. A 4 KiB floor is the smallest whole-KiB allowance that accommodates either measured increment. With the WP18 baseline unchanged, WP19 would leave only 139 raw and 313 gzip CSS bytes of headroom. This is cumulative room from the reviewed baseline, not a fresh allowance per feature or PR: further changes can still require an explained baseline update. The allowance rationale lives beside its values in `bundle-baseline.json`; calibrating policy does not refresh recorded measurements.

## What the numbers mean

The job builds with the production `/slamdemonium/` base path, using `npm run build -- --manifest`. Every file under `dist/` counts, including WASM, lazy chunks, public audio/models/maps, hidden files and any source maps. Gzip sizes are measured independently per file at level 6 with a zero timestamp and then summed. They are a normalized transfer estimate, not a cold-load measurement: caching, lazy requests and the server's actual content encoding affect what a player downloads. Already compressed media may gain nothing from gzip; the raw gate remains meaningful.

Optional content also needs request-boundary evidence: verify that its backend and assets are not fetched before their intended activation point. A dynamic import can start a request during boot even when nobody awaits it, and preloading can fetch media before it is played. Shipped totals cannot establish startup behavior. The design's five-second broadband time-to-drive criterion remains unverified until a separate cold-load measurement supplies that evidence; an uncontended local load is insufficient.

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

1. Commit the intended source/assets so the source revision is identifiable. Build and check that exact revision with the commands above. Inspect compression, reuse and unused content before proposing growth. Lazy loading changes request timing, but all shipped bytes still count.
2. Present the specific inventory for review: stable asset identities, filenames, raw/gzip bytes and hashes from the report, their player benefit, and request-boundary evidence for optional content. Record the full source revision and the durable rationale in the baseline's `reason`, so the decision is understandable without opening the PR. A total-cap failure is a prompt to justify the inventory; it does not automatically justify adding every newly observed file.
3. After PM approval, update only the approved entries in `measurement.assets` and their exact contribution to `measurement.total`. Copy measurements from the exact report. Preserve every allowance, all other entries, the original measurement revision/method/toolchain, and the allowance rationale. The reason records the newer scoped measurement's provenance. Planned additions must not reset earlier accumulated growth; a policy adjustment requires a separately explained review.
4. Run the check again and review the baseline diff in the feature PR. Verify that aggregate totals equal the sum of recorded assets and that unrelated measurements and allowances are unchanged. The PM merges the scoped baseline update with the feature that caused it.

The existing `--record-baseline "WRITTEN_REASON"` option replaces **the entire measurement**, including every asset and the source revision. It is appropriate only for an explicitly reviewed full-baseline replacement, not routine content additions or a single-asset update. It preserves allowances but resets accumulated measured growth. CI refuses to run that update mode; neither a passing run nor a release automatically refreshes the baseline.

## Trend and retention

Every run publishes a summary with total/per-asset raw and gzip sizes, deltas and limits, and up to five previous completed main measurements. Reports and summaries are retained as `bundle-size-results` artifacts for 90 days, including budget failures. Each history row shows its budget fingerprint so a rebaseline cannot silently disguise growth. Missing/expired history or API failures are visible but do not bypass or fail the current size gate. History artifacts are bounded JSON data, never extracted or executed; their revisions must match their main runs.

Run the tooling tests with `python3 -m unittest discover -s .github/tests -v` and validate workflow changes with `actionlint`.
