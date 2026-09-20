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

**Devops owns CI wiring.** Run this separately, collect the JSON even when a gate
fails, and allow time to finish the current replay after five minutes. PM/devops
decide whether shared-runner timing is required or advisory. WP9a changes no
workflow files.

Sources: [design §13.4](vertical-slice-design.md#134-performance-harness),
[CDP heap usage](https://chromedevtools.github.io/devtools-protocol/tot/Runtime/#method-getHeapUsage),
[CDP explicit GC](https://chromedevtools.github.io/devtools-protocol/tot/HeapProfiler/#method-collectGarbage).
