# Physics-step input scripts (v1)

`ScriptController` from `src/input/script.ts` is the shared recorder/player for automated driving and the performance harness. It processes the actual `InputMapper.sampleForStep()` result; there is no timer or second input implementation.

## Format

A document has these fields:

| Field           | Meaning                                                                               |
| --------------- | ------------------------------------------------------------------------------------- |
| `version`       | Exactly `1`                                                                           |
| `name`          | Non-empty human-readable name                                                         |
| `seed`          | Unsigned 32-bit scenario seed; passed to reset, not used to invent vehicle randomness |
| `spawn`         | `position: {x,y,z}` in metres and unit quaternion `rotation: {x,y,z,w}`; Y up         |
| `tuning`        | **Every current schema key and its exact value**, including presentation settings     |
| `durationSteps` | Positive integer count of physics steps                                               |
| `frames`        | Strictly increasing `{step,input}` entries, beginning at step `0`                     |

Each `input` contains **all** of `throttle` (0–1), `brake` (0–1), `steer` (-1–1, positive left), `handbrake` (boolean), `boost` (boolean), and `source` (`keyboard` or `gamepad`). The source is recorded because vehicle filtering differs by device. Input holds until the next frame. The last frame holds through step `durationSteps - 1`; EOF is reported only after that step's `postStep` completes.

`parseInputScript(rawDocumentOrJSONString)` validates and freezes a copied document. Missing tuning, unknown keys, non-finite numbers, out-of-range values, invalid discrete choices, partial inputs, duplicate steps and unsupported versions fail explicitly. Values are never filled from current defaults or silently clamped. Adding a schema key therefore requires updating old script headers deliberately. `exportInputScript(script)` returns indented JSON for editing or download.

## Fresh respawn only

V1 recordings start only after an **actual explicit fresh respawn**, before any subsequent physics step. A matching pose or zero speed is insufficient. Boot certifies that reset with `scripts.noteRespawn(spawn, seed)`; every completed live step consumes this eligibility, even while recording is off. `startRecording(name)` refuses a mid-drive start.

This restriction is intentional. Faithful mid-drive restoration needs control ramps, tire/slip/compression histories, drift state, boost state, and Jolt's contact warm-start data. The native warm-start cache is not exposed by the adapter. Capturing only accessible state would appear complete while silently diverging. A future v2 can add resume once a real full-state snapshot API exists.

Tuning changes during either recording or playback fail explicitly. An external respawn during recording also invalidates it. Cancel and start from a new reset. Tuning edits after completed EOF are allowed; the captured result remains independent.

## Boot integration

Main owns the live store, vehicle and single mass-rebuild debounce. The controller accepts those seams without importing boot:

```ts
const scripts = new ScriptController({
  store: tuning,
  mapper,
  reset(spawn, seed) {
    // Release any automation setInput override before sampling replay input.
    clearInjectedInput();
    massRebuild.cancel();
    vehicle.rebuildMassProperties(); // synchronous, current captured tuning
    vehicle.respawn(spawn.position, spawn.rotation);
    // Reset scenario seed/state here if the scenario owns any.
  },
  readTelemetry: () => vehicle.telemetry,
  onComplete: () => loop.setPaused(true),
  onError: () => loop.setPaused(true),
});
```

The names inside `reset` are illustrative boot-owned operations. No UI timer participates. Reset must finish applying current mass, clear pending rebuild work and reset transient vehicle state before returning. Do not call `scripts.noteRespawn` inside this callback: `load` certifies its own reset. Call `noteRespawn` after an ordinary live respawn, and only after `cancel` if a replay was armed.

Preserve these loop hooks:

1. Sample with `mapper.sampleForStep()` immediately before vehicle preStep.
2. Run vehicle preStep, physics step, then `vehicle.postStep(dt)`.
3. Call `scripts.afterStep()` **on every completed physics step**, even outside recording/playback.

Read the preallocated `Vehicle.telemetry` directly after postStep. `window.__game.getTelemetry()` is an allocating automation snapshot and is unsuitable for the collector. Input state, recording buffers, progress, telemetry metrics and lap state are reused in the hot path. JSON compression/export and result snapshots happen only at explicit boundaries. Recording capacity defaults to 72,000 steps (five minutes at 240 Hz); exhaustion fails instead of silently truncating.

## Playback and exact completion

```ts
scripts.load(rawDocument, { tuning: 'apply' }); // apply the full header, then reset
// OR: { tuning: 'verify' } refuses any mismatch before reset.
loop.stepMany(scripts.progress().totalSteps);
const result = scripts.result();
assertReplay(result, { elapsedSteps: scripts.progress().totalSteps });
```

The tuning choice is mandatory. `progress()` returns a stable readonly `{completedSteps,totalSteps,done}` view; copy it if retaining historical progress. `onComplete` runs synchronously after final telemetry/lap collection. In RAF mode it must pause/gate the remaining batch immediately, rather than waiting for a polling client. `canStep()` is false at EOF. Sampling after EOF throws before another physics step, including an oversized `stepMany` request. `cancel()` releases replay ownership; it does not respawn or restore old tuning. `dispose()` also detaches the mapper and store subscriptions.

During replay all live command counts are suppressed, including respawn, tuning A/B, pause, slow motion and F9. Start telemetry capture externally before playback. During live recording F9's existing action can toggle CSV capture alongside `startRecording`/`stopRecording`; record from the same fresh reset and use completed physics-step indices to align the exports. Starting CSV mid-drive does not make mid-drive input recording valid.

The perf harness consumes `load/progress/cancel` directly. It must clear its temporary step driver before loading and retain the real mapper and vehicle hooks. For a wall-time soak, the duration is a minimum: finish the current replay, or explicitly load another identical complete replay. Report complete replay counts, total steps, tuning/input fingerprints and actual heap checkpoint times.

## Assertions and ring laps

`assertReplay(result, expectations)` always rejects non-finite telemetry (including an increased Vehicle recovery counter, even when its published pose has already been repaired) and can assert elapsed steps, final position/rotation tolerance (metres/radians), peak speed (m/s) and peak absolute slide angle (radians). Quaternion signs are treated equivalently. `result()` snapshots the collected final pose and peaks; later runs cannot mutate it.

`RingLapTimer` places eight ordered forward-crossing gates on the 130 m centre line, starting at `(130, *, 0)` facing -Z. A known fresh spawn on that line starts a standing-start lap at step zero. `lapProgress()` reports completed laps, next checkpoint, last lap steps/seconds and invalidation. Leaving the 110–150 m annulus or teleporting invalidates the attempt; re-enter through the start gate. Reverse crossings cannot advance a checkpoint. Timing uses completed physics steps only. `assertCompletedLap(progress, maximumSteps?)` requires a complete ordered lap and optionally enforces a step budget.
