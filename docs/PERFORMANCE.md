# Performance harness (WP9a)

```sh
npm ci
npx playwright install chromium
npm run perf
```

The command builds production assets, launches headless Chromium against a private
localhost preview, reproduces the WP1 one-box spike, warms two complete replays,
and measures at least five minutes of browser execution. Allow about six minutes
plus build time on an otherwise quiet host; slow rendering can take longer.
Warm-ups use `stepMany` to warm physics; rendered measurement includes the
renderer’s natural workload. Pinned `tsx` also supports Node builds without
built-in TypeScript execution.

Current scene: the merged WP5 vehicle and test track. A temporary procedural input
source uses throttle, alternating steering and braking through the real
`sampleForStep` path. Each drive is exactly 960 steps, followed by a fresh respawn. This is **not
a vehicle lap** or a claim that the MacBook acceptance test passed.

## Two modes, one drive

1. **Physics-only baseline:** `stepMany` executes one complete selected replay
   without rendering between steps. It reports full-step and engine-only timing
   plus terminal telemetry. The separate historical WP1 probe reuses the original
   seeded one-box workload and compares its browser mean with the recorded
   **0.1118 ms Chromium / 0.0923 ms Node** means. The Node number is historical;
   no new Node measurement is implied. These references are hardware-dependent,
   not extra pass thresholds. [WP1 evidence](DECISIONS.md#2026-09-20--wp1--g0-go-with-the-separate-single-thread-jolt-wasm-build)
2. **Rendered soak:** the same armed input source advances through real
   `requestAnimationFrame` physics steps. A replay ends on **step count**, never
   elapsed time. After the minimum soak interval, capture stops at the next EOF;
   earlier EOFs explicitly start another identical complete replay. Counts and
   terminal telemetry are recorded. Faster hosts may complete more whole drives.

Physics outcomes can be reproduced for the same complete input, initial state,
tuning and engine environment. **Frame timings are not deterministic.** Frame
boundaries, steps per frame and scheduling vary; report distributions rather
than interpreting ordinary shared-runner variance as a regression. CPU timing
of deterministic physics also varies with host load.

## Measurements and failure rules

| Metric             | Meaning                                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Frame distribution | Consecutive RAF timestamps during playback, including rendering/scheduling delays; not CPU render duration or GPU time.                     |
| Physics step       | Every complete input/pre-step/engine/post-step operation, including every catch-up step.                                                    |
| Engine step        | Jolt integration alone, separate from vehicle force computation.                                                                            |
| JS heap            | CDP `Runtime.getHeapUsage().usedSize`; equivalent post-GC checkpoints near second 60, second 300, and final EOF. Actual times are recorded. |
| WASM memory        | Adapter capacity, allocator free bytes, and capacity minus free bytes, sampled throughout.                                                  |

Exit **1** if the manual `stepMany` full-step p99 exceeds **2 ms**, or retained JS, WASM non-free
bytes, or WASM capacity grow more than **10%** from the first checkpoint to final
EOF. Equality passes; shrinking is allowed. Exit **0** means configured checks
passed. Runtime errors, missing samples, recorder overflow, tuning changes and
incomplete EOF/sample coverage also fail. A timed-out replay is invalid, never
a shortened successful drive. Startup/runtime failures can occur before a JSON
report exists; threshold failures write the report before exiting.

The PM's gate ruling uses `manualBaseline.physicsStep` to isolate simulation
cost. All `timing.*` distributions come from RAF and are **advisory**, including
RAF physics p99. Manual timing still varies with CPU load; fixed-step physics
state is reproducible, CPU timing is not. Investigate large RAF/manual gaps for
allocation/GC rather than dismissing them as scheduling noise. See the
[measured outlier investigation](research/perf-outliers.md).

CPU timings are comparable **only within the same recorded runner class** and
with the same workload/tuning configuration. **Never compare a local CPU timing
with a GitHub-hosted measurement.** The same SHA/configuration produced very
different hosted and local CPU timings during [O4 validation](https://github.com/huntergdavis/slamdemonium/pull/33).
That does not establish a code regression.

[`.github/performance-baseline.json`](../.github/performance-baseline.json) is the
single record of the expected runner class, numerical limits, and measured
hosted baseline, including its SHA, configuration fingerprint, and source run.
The workflow reads its runner selection and limits from this file. The summary
computes threshold headroom from this record; the justification is headroom
within one runner class, not reproducible CPU timing.

Before measuring, the workflow records hosting type, OS/distribution/version,
architecture, image family/version, and CPU count. If the class differs from
the baseline, the full measurement still runs and is retained, but numerical
gates are **SKIPPED**. The summary names expected and found values. Missing or
malformed reports, incomplete EOF, recorder overflow, unexpected harness errors,
and abnormal process exits still fail. The raw report retains the original
harness measurements plus runner metadata, the baseline snapshot and exit code.
History includes only the current runner class, including skipped-gate runs;
different or unrecorded classes are excluded from comparison.

To adopt a changed class, review a real sustained measurement and its tuning
configuration, then update that one baseline file through a PR with the runner
fields, measured figure, SHA/fingerprint, timestamp and source-run link. Do not
update the baseline automatically. GitHub can refresh images and CPU hardware
within a class, so compare repeated runs and inspect image/CPU details and host
load before calling a moved percentile drift or noise.

Explicit GC pauses freeze simulation and capture together, preserving every
scripted step. Those pauses, their straddling frame intervals and between-replay
setup are excluded from frame timing; natural GC remains included. Frame time
has no gate in design §13.4. Excluded measurement-pause time and loop-dropped
simulation time are reported. Capture uses bounded typed arrays; history lives
in Node, not the browser heap being measured.

A flat 128 MiB WASM capacity does not prove leak freedom. Allocator growth can
hide within it. Non-free bytes include runtime overhead; this is a trend signal,
not a count of live game objects. JS backing storage, GPU memory and process RSS
are not covered by the default growth gate. Reuse [R1's ownership and allocator
findings](research/jolt-integration.md).

## Controls and output

```sh
npm run perf -- --help
npm run perf -- --physics-p99-ms 1.5 --heap-growth-percent 5
npm run perf -- --duration-seconds 20 --baseline-seconds 3 --warmup-replays 0 --demo-steps 120 --skip-spike --output test-results/perf-smoke.json
```

`--duration-seconds` defaults to 300 and is a **minimum wall interval**, not a
replay cutoff. `--baseline-seconds` defaults to 60; `--warmup-replays` to 2;
`--demo-steps` to 960; `--timeout-seconds` to 1800. The timeout includes browser
setup and invalidates unfinished work. `--port 0` selects an available local port.
`VITE_BASE_PATH=/slamdemonium/ npm run perf` also exercises a deployment subpath.
Shortened runs, fewer than two warm-ups, relaxed thresholds and `--skip-spike`
are labeled `smoke/custom` and do not replace the default sustained run. Keep other CPU-heavy jobs off the measurement host.

Default JSON path: **`test-results/perf.json`**. Stable fields for devops:

`physicsGate` records `source: "manualBaseline.physicsStep"`, `p99Ms` and
`limitMs`. Use this for the physics result; label all RAF fields advisory.

| Field                                                                          | Contents                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `timing.frame`, `timing.physicsStep`, `timing.engineStep`                      | Each has `count`, `meanMs`, `p50Ms`, `p95Ms`, `p99Ms`, `minMs`, `maxMs`, `standardDeviationMs` (population). Percentiles are nearest-rank.                                                                                                   |
| `memory.first`, `memory.minuteFive`, `memory.last`                             | Each checkpoint has `elapsedSeconds`, `jsUsedBytes`, `jsTotalBytes`, `backingStorageBytes`, `wasmHeapBytes`, `wasmFreeBytes`, `wasmUsedBytes`. `minuteFive` is null on short runs; `last` is final EOF, which may be later than minute five. |
| `memory.jsUsedPercent`, `memory.wasmUsedPercent`, `memory.wasmCapacityPercent` | First-to-final growth; `memory.samples` preserves the intermediate trend.                                                                                                                                                                    |
| `parameters`, `parameterFingerprint`, `configurationFingerprint`               | Full applied tuning map, its sorted-key JSON SHA-256, and combined identity including input and scenario fingerprints. `finalParameters` is checked against the starting map.                                                                |
| `inputIdentity`, `scenarioFingerprint`, `revision`, `worktreeDirty`            | Input-document identity (SHA-256 for WP11), scene-module SHA-256, code revision and dirty-state warning.                                                                                                                                     |
| `replay`, `manualBaseline`, `reference`                                        | Complete step/replay counts and terminal states, selected-drive stepMany measurements, historical WP1 comparison.                                                                                                                            |
| `host`, `browser`, `config`, `passed`, `failures`                              | CPU/Node/browser, logical CPUs and load averages, effective controls, result and reasons.                                                                                                                                                    |

Put the configuration fingerprint beside history measurements. Software WebGL
and shared-host load are not representative of a hardware-GPU player machine.

## WP5 / WP11 integration

Scene preparation is a trusted local `PerfScenario` module with `name`,
`description`, and `setup(page)`. Setup runs while simulation is paused before
each complete replay. Input is injected separately:

```sh
npm run perf -- --scenario ./scripts/perf/scenarios/vehicle.ts --input-script ./drive.json --script-tuning verify
```

The paths are future examples, not shipped vehicle fixtures. The harness consumes
WP11's **single** versioned JSON format via
`game.scripts.load(rawDoc, { tuning: 'apply' | 'verify' })`; the policy is mandatory.
It reads `progress()` as `{ completedSteps, totalSteps, done }` and uses that
exact EOF. Validation/player ownership stays in `src/input/script.ts`.
The frozen v1 carries version/name/seed, full tuning, explicit spawn pose,
`durationSteps`, and changed full-input frames indexed by physics step.
The adapter releases the procedural input override before loading a script.
WP11 owns fresh-spawn reset and rejection of tuning edits during playback.
Until that loader is wired, `--input-script` fails explicitly; there is no
fallback parser, alternate script schema or approximate timer-based replay.

When updating boot wiring, preserve `LoopHooks.measurement`, the engine-only
`recordEngineStep` call, exact EOF gating, `window.__game.perf`, and
`droppedSeconds` telemetry. The full-step timer encloses vehicle pre/post work. [Demo setup](../scripts/perf/scenarios/physics-demo.ts) ·
[input adapter](../scripts/perf/input.ts)

**Devops owns CI wiring.** The separate [Performance workflow](../.github/workflows/performance.yml)
runs automatically on main and manually for diagnostics; it is not a required PR
check. Active measurements finish while only the newest pending run is kept.
Run summaries expose the distribution, tuning, runner class and recent comparable
main measurements. Raw reports, exit status, console output and summaries remain
available as the `performance-results` artifact for 90 days, including failures.

Sources: [design §13.4](vertical-slice-design.md#134-performance-harness),
[CDP heap usage](https://chromedevtools.github.io/devtools-protocol/tot/Runtime/#method-getHeapUsage),
[CDP explicit GC](https://chromedevtools.github.io/devtools-protocol/tot/HeapProfiler/#method-collectGarbage).

## The browser gate (2026-10-01)

Headless probes are not a browser. For anything that changes what is on screen or how many bodies are awake, the number that counts is from `scripts/perf/browser-drive.mjs`: a real headed Chromium on the real GPU (under a virtual display on the measuring box), the game running its own frame loop, a fixed route on the circuit (spawn, north up the opening straight through the chicane, pure pursuit on the centreline at 35 m/s for 45 s) and the game's own recorder read for frames, full physics steps and Jolt steps.

```
xvfb-run -a -s "-screen 0 1920x1080x24" node scripts/perf/browser-drive.mjs https://hunterdavis.com/slamdemonium/pr/NNN/ 45 1280x720 out.json
```

The report names the GL renderer so a software fallback cannot pass as a GPU, and counts the traffic cars within 750 m and 180 m and, where the build exposes it, in frame at 4 px and 8 px or more. The numbers are a relative gate: main and the PR on the same box, same route, same resolution. They are not anyone else's frame rate; the URL and route are in the report so a reader can repeat the drive in their own browser. One GPU run at a time on a box; a second browser skews both.

Baseline on main e6ea7da, 1280x720 on an i5-8250U with an Intel UHD 620 through Vulkan: 12.2 fps (frame p50 83 ms, p99 150 ms), full step p50 1.3 / p99 5.7 ms, Jolt p50 0.6 / p99 3.5 ms. At 1920x1080 the same box gives 6.6 fps, and below about 10 fps the game slows down because the fixed-step loop stops catching up, which shows as less route covered in the 45 s.

## Reading a gate number honestly (2026-10-04)

The gate above answers "did this PR cost anything". It does not answer "how fast is the game", and three things will mislead a reader who treats its frame rate as the game's frame rate.

**The measuring box is relative only; the absolute gate is the CTO's laptop.** Target hardware is an 8 GB MacBook M1 with an Apple GPU. The measuring box is an i5-8250U with an Intel UHD 620 under a virtual display, roughly an order of magnitude slower on fill rate and thermally throttled besides. A number from it says main-versus-PR on one box with the renderer named. It is never the frame rate the game runs at, and it should never be quoted to anyone as though it were.

**Most of the gate's frame time is the virtual display, not the game.** With vsync on, presentation through the virtual framebuffer dominates the frame. Measured on main `7de18b0` at 1280x720: 8.8 fps with a 100.1 ms median frame, against a 16.0 ms median frame for the same build, same resolution and same route with vsync disabled. For the real cost of rendering and simulating, add the two flags:

```
--disable-gpu-vsync --disable-frame-rate-limit
```

The committed gate does not pass them, so quote its vsync-on figures for the relative comparison only, and take frame cost from a vsync-off run. Two further traps with vsync on: the frame quantises to multiples of the refresh interval, so a 33.3 ms reading means "just over one vsync", not a 30 fps cap, and an empty page under the same virtual display reaches 59.2 fps, so there is no 30 fps ceiling in the environment to blame.

**Splitting CPU from GPU.** Re-run at a small viewport with vsync off: whatever median frame survives is the resolution-independent CPU side, and the rest is GPU fill. On main `7de18b0` that was 9.6 ms CPU at 320x180 against 16.0 ms at 1280x720, so about 6.4 ms of fill, with the full physics step only 2.5 ms of the CPU side.

**Interleave, or do not compare at all.** This box drifts far more than a PR does. Main alone measured a 16.0 ms median frame at one point and 10.8 to 11.8 ms an hour later, unchanged commit, same quiet box, about 40%. So an A/B is main, PR, main, PR inside a single window, each build served on its own port so nothing is rebuilt midway:

```
npx vite preview --port 4187 --strictPort                              # one build in dist/
npx vite preview --port 4188 --strictPort --outDir scratch/dist-pr     # the other, stashed
```

Check the in-frame car counts match across the runs, or the scenes were not comparable. Report a delta only when it is larger than each build's own run-to-run spread; otherwise the finding is "no regression detectable", never a speedup. Do not compare against a baseline recorded earlier in the day: that was a different machine thermally.

**Renderer strings.** `ANGLE (Intel, Vulkan ..., Intel open-source Mesa driver)` is the real GPU. Plain OpenGL under the virtual display falls back to `llvmpipe`, a software rasteriser, and the gate's summary only tests for `SwiftShader`, so an `llvmpipe` run would still print `GPU`. Read the renderer string itself rather than that word.
