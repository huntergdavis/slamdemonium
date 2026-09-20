# Scripted input

Record a drive, replay it exactly, and assert on what happened. For contributors writing tests, perf runs or reproducible bug reports.

The authoritative contract is [`src/input/SCRIPTS.md`](../src/input/SCRIPTS.md); this page explains how to use it. Terms like slide angle and physics step are in the [Glossary](GLOSSARY.md).

> **Status.** The recorder, player, assertions and lap timer are merged and exercised by `tests/script-examples.test.ts`. Runtime exposure as `window.__game.scripts` is part of WP14 and not mounted yet; the two places below that depend on it are marked **pending WP14**.

## What it is for

A script is a list of driver inputs indexed by physics step, plus everything needed to reproduce the run: the spawn pose, a seed, and the complete tuning parameter set. Because the game steps physics at a fixed rate and samples input once per step, feeding the same script into the same build produces the same drive. That gives you:

- **Regression tests** that drive the real vehicle on the real track with no human at the keyboard, then assert on speed, slide angle, final position or lap time.
- **Reproducible bug reports.** "It spun at step 4,210 with these parameters" beats "it spun sometimes."
- **Performance runs** that exercise a realistic drive rather than a synthetic one.
- **Hand-written scenarios**: a standing start, a handbrake turn, a full lap, authored in a few lines of JSON.

## The file

A script is one JSON document, version 1.

| Field | What it holds |
|---|---|
| `version` | Exactly `1`. |
| `name` | A non-empty human-readable name. |
| `seed` | Unsigned 32-bit integer handed to the reset. Reserved for scenario randomness; the vehicle itself uses none. |
| `spawn` | `position` in metres and a unit quaternion `rotation`, Y up. |
| `tuning` | **Every** key currently in the tuning schema (`PARAM_DEFS`) with its exact value, presentation settings included; 71 keys at the time of writing. Nothing is filled in from defaults. |
| `durationSteps` | How many physics steps the script runs. A positive integer. |
| `frames` | Input changes as `{ "step", "input" }`. Steps are integers, strictly increasing, starting at 0 and all below `durationSteps`. |

Each `input` carries all six fields every time: `throttle` and `brake` from 0 to 1, `steer` from -1 to 1 with positive meaning left, `handbrake` and `boost` as booleans, and `source` as `"keyboard"` or `"gamepad"`. The source matters because the vehicle filters keyboard and controller input differently. An input holds until the next frame; the last frame holds through step `durationSteps - 1`.

A minimal example, the shipped handbrake turn, has four frames: settle for half a second, full throttle, then at step 270 ease to 30 percent throttle, steer left and pull the handbrake, then release the handbrake at step 330. The whole thing is 420 steps, 3.5 seconds at 120 Hz.

**Abbreviated excerpt.** The `tuning` block below is shortened for reading and this snippet will **not** load under the strict validator. The complete, loadable file is [`src/input/examples/handbrake-turn.json`](../src/input/examples/handbrake-turn.json).

```json
{
  "version": 1,
  "name": "handbrake-turn",
  "seed": 20903,
  "spawn": { "position": { "x": 130, "y": 0.86, "z": 0 },
             "rotation": { "x": 0, "y": 0, "z": 0, "w": 1 } },
  "tuning": { "gravity": 14.7, "timeScale": 1, "... every schema key ...": 0 },
  "durationSteps": 420,
  "frames": [
    { "step": 0,   "input": { "throttle": 0,   "brake": 0, "steer": 0,    "handbrake": false, "boost": false, "source": "gamepad" } },
    { "step": 60,  "input": { "throttle": 1,   "brake": 0, "steer": 0,    "handbrake": false, "boost": false, "source": "gamepad" } },
    { "step": 270, "input": { "throttle": 0.3, "brake": 0, "steer": 0.65, "handbrake": true,  "boost": false, "source": "gamepad" } },
    { "step": 330, "input": { "throttle": 0.3, "brake": 0, "steer": 0.65, "handbrake": false, "boost": false, "source": "gamepad" } }
  ]
}
```

The three shipped examples live in [`src/input/examples/`](../src/input/examples/README.md).

Loading is strict on purpose. `parseInputScript` rejects a missing or unknown tuning key, a non-finite or out-of-range value, a partial input, duplicate or unordered steps, and any version other than 1. It never clamps and never fills gaps. When a new tuning parameter is added to the schema, old scripts fail to load until someone adds the key deliberately. That is the point: a replay must never quietly run under different parameters than it claims.

## Recording a drive

Recording captures what the input mapper actually delivered to each physics step, from whichever device was live. Steps are numbered from the reset, and the full tuning set is captured into the header at the moment recording starts.

### Recordings must start from a fresh respawn

You cannot start recording mid-drive. The recorder only accepts a start immediately after an explicit respawn, before the next physics step runs. Being stationary, or sitting exactly on the spawn point, is not enough.

Here is why. A car mid-drive carries state that a script cannot capture: the filtered pedal and steering ramps, per-tire slip history and relaxation, suspension compression, drift latch and meter, boost envelope, and the physics engine's internal contact warm-start data, which the engine adapter does not expose at all. A recording that began mid-drive would look complete, load without complaint, and then diverge from the original run for reasons invisible in the file. Refusing is the honest behaviour. A later format version can add resume once a real full-state snapshot exists.

Two more things break a recording in progress: changing any tuning value, and an external respawn. Both fail explicitly. Cancel and start again from a new reset.

### Only one thing may own the input

A recording captures what the real input mapper delivered, so nothing else may be feeding input at the same time. `startRecording` refuses if an automation `setInput` override or a perf step driver currently owns the input. While a recording or a replay is active, `setInput` and attaching a perf driver are refused in turn. *(These guards are being implemented in WP14; the rule already holds for tests.)*

The contributor sequence, in order:

1. `window.__game.releaseInput()` to drop any injected input.
2. Clear the perf step driver if one is attached (`perf.setStepDriver(undefined)`).
3. Fresh respawn.
4. `startRecording(name)`, before any physics step runs.

Telemetry CSV recording (F9) is separate from all of this and may capture injected test driving; that is fine, it is a different file answering a different question.

### In a test

```ts
scripts.noteRespawn(spawn, seed);      // boot does this after a real respawn
scripts.startRecording('my-drive');    // refuses unless a respawn just happened
// ... drive: loop.stepMany(n) with inputs arriving through the real mapper ...
const script = scripts.stopRecording();   // a validated InputScript
writeFileSync('my-drive.json', exportInputScript(script));
```

Recording capacity defaults to 72,000 steps, five minutes at 240 Hz. Running past it fails rather than truncating.

### From live play

Recording is a programmatic contributor capability, by decision. There is no hotkey, button or download for input recording in the running game, and none is coming in this slice. **F9 records telemetry to CSV; it does not capture input JSON.** In the browser you record from the console or an automation script through `window.__game.scripts` (see below): press **R** for a fresh respawn, then call `startRecording(name)`, drive, then `stopRecording()` returns the script object to serialise with `JSON.stringify`. If you also want a telemetry CSV of the same drive, start it from the same reset and align the two exports by physics step index.

## Replaying a drive

```ts
scripts.load(document, { tuning: 'apply' });   // or { tuning: 'verify' }
loop.stepMany(scripts.progress().totalSteps);
const result = scripts.result();
```

`load` takes the raw JSON string or parsed object, validates it, then resets the vehicle to the script's spawn. **The tuning choice is mandatory.** There is no default, so you always decide which of these you meant:

- `apply`: overwrite the live tuning with the script's header, then run. Use this for tests and for reproducing a report exactly.
- `verify`: compare the live tuning with the header and refuse to run on any mismatch. Use this when the question is "does this drive still behave the same under the parameters I have right now."

While a replay is armed, the script owns the input. Live keyboard and controller input is ignored, and so are the live commands: respawn, A/B swap, pause, slow motion and F9 do nothing until the replay ends or is cancelled. Changing a tuning value during playback fails the replay.

The replay reports end of file only after the final step's `postStep` has completed, so the final telemetry is the real final state. Stepping past the end throws; `canStep()` is false there. `progress()` returns `{ completedSteps, totalSteps, done }` as a reused readonly view, so copy it if you keep history. `cancel()` releases the script's hold on input; it does not respawn and does not restore the tuning that `apply` overwrote.

In the browser the controller is exposed as `window.__game.scripts` with `load`, `progress`, `cancel`, `result`, `lapProgress`, `startRecording` and `stopRecording`. **Pending WP14:** the property is declared in `src/core/gameApi.ts` but the live boot does not assign it until that PR merges. Until then these calls are reachable only in tests, where you hold the `ScriptController` directly.

## Writing a scenario by hand

1. Copy `src/input/examples/standing-start.json`. Its header is a complete, valid tuning set at defaults with the ring spawn.
2. Change `name`, and `spawn` if you want to start elsewhere. The ring centre line is radius 130 m; the shipped spawn is `(130, 0.86, 0)` facing -Z, which is the standing-start position of the lap timer.
3. Write `frames`. Think in steps at the header's `physicsHz` (120 by default, so 60 steps is half a second). Start with a short neutral hold so the suspension settles. Every frame must carry all six input fields.
4. Set `durationSteps` to the last step you care about plus one.
5. Load it with `{ tuning: 'apply' }` and step `progress().totalSteps`. If it fails to parse, the error names the field.

Keep controls to sensible precision, hundredths is plenty. If you want a different tuning, change the header values directly; a preset is just a set of header overrides.

## What the assertions can check

`assertReplay(result, expectations)` throws on the first failure. It always checks one thing you did not ask for: **no non-finite value** appeared in telemetry at any step, and the vehicle's recovery counter did not increase. A NaN that the vehicle repaired before publishing still fails the replay.

| Expectation | Checks |
|---|---|
| `elapsedSteps` | `completedSteps` equals this number exactly. |
| `finalPose` | Final position within `positionTolerance` metres and final rotation within `rotationTolerance` radians of `pose`. Quaternion sign is ignored. |
| `peakSpeed` | Highest speed during the run, in m/s, inside `{ min, max }`. |
| `peakAbsSlideAngle` | Largest absolute slide angle, in radians, inside `{ min, max }`. |

A typical drift test asserts `peakAbsSlideAngle: { min: 0.1, max: Math.PI }` to prove the car actually slid. A regression test asserts `finalPose` against a stored result with tolerances around `1e-4` m and `1e-5` rad, which is what the shipped examples use.

`result()` is a snapshot. Take it after `progress().done` is true; later runs cannot change it.

## Lap timing on the ring

Every `load` and every `startRecording` creates a fresh lap timer from the header's `physicsHz` and spawn. You do not construct one yourself in normal use. Its geometry defaults to the shipped ring:

| Option | Default | Meaning |
|---|---|---|
| `physicsHz` | required | Converts lap steps to seconds. |
| `checkpointCount` | 8 | Ordered gates around the ring. |
| `centerLineRadius` | 130 m | Where the gates sit. |
| `innerRadius`, `outerRadius` | 110 m, 150 m | Leave this annulus and the attempt is invalidated. |

Gates run counter-clockwise from the start line on the positive X axis. A script that spawns on that line, anywhere between 110 and 150 m out with z near zero, begins a standing-start lap at step zero. A script that spawns anywhere else has to cross the start gate first before a lap begins.

`lapProgress()` returns:

| Field | Meaning |
|---|---|
| `completedLaps` | Full ordered laps so far. |
| `nextCheckpoint` | Index of the gate the car must cross next. |
| `lastLapSteps`, `lastLapSeconds` | The most recent complete lap, in physics steps and seconds at the header's `physicsHz`. `null` until a lap completes. |
| `invalidated` | True once the car leaves the 110 to 150 m ring annulus or teleports. Re-enter through the start gate to try again. |

Gates only count forward crossings; driving the ring backwards cannot advance. Timing uses completed physics steps only, never the wall clock.

`assertCompletedLap(progress, maximumSteps?)` requires at least one complete ordered lap with finite timing, and optionally that the last lap came in under a step budget.

The shipped `ring-lap.json` completes one lap in **5,169 steps, 43.075 seconds** at 120 Hz, with a peak of 19.5 m/s. It is a conservative reproducible lap, not a fast one; its purpose is to prove the gates and the timer, and to give perf runs a realistic 43 seconds of driving.

## Where things are

| Path | What |
|---|---|
| `src/input/SCRIPTS.md` | The contract: format, fresh-respawn rule, boot integration, EOF gating. |
| `src/input/script.ts` | `ScriptController` and re-exports of everything below. |
| `src/input/scriptFormat.ts` | `parseInputScript`, `exportInputScript`, the types. |
| `src/input/scriptAssertions.ts` | `assertReplay`, `ReplayResult`, `ReplayExpectations`. |
| `src/input/lapTimer.ts` | `RingLapTimer`, `LapProgress`, `assertCompletedLap`. |
| `src/input/examples/` | Three validated scripts and their README. |
| `tests/script-examples.test.ts` | Replays each example twice in one physics world and checks identical results. |
| `tests/scriptVehicleHarness.ts` | How to stand up vehicle, mapper, controller and loop in a test. |

To re-author the examples and their reference results after a reviewed vehicle or schema change:

```sh
WRITE_INPUT_EXAMPLES=1 npx vitest run tests/script-examples.test.ts
```

Review the regenerated JSON and results together. Ordinary test runs never rewrite them.
