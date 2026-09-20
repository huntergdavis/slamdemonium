# Example input scripts

These v1 JSON documents were recorded through the real gamepad mapper and validated against the production `Vehicle` and stock Jolt WASM on the ring's actual colliders. Each includes the complete tuning header, including the two D5 presentation settings, and a fresh spawn at `(130, 0.86, 0)` facing -Z. The first 60 steps are neutral settling input; they are part of the recording and elapsed time.

| Script | Physics steps | Time at captured 120 Hz | Observed result |
| --- | ---: | ---: | --- |
| [standing-start.json](standing-start.json) | 240 | 2 s | 19.496 m/s peak speed |
| [handbrake-turn.json](handbrake-turn.json) | 420 | 3.5 s | 22.648 m/s peak; 0.675 rad peak absolute slide angle |
| [ring-lap.json](ring-lap.json) | 5,169 | 43.075 s | One complete ordered lap; 19.505 m/s peak |

The standing start has two input frames; the handbrake turn has four. The lap uses 413 held input frames with controls rounded to hundredths. Its authoring driver adjusted controls every 12 physics steps while recording. Playback consumes only the saved JSON; it uses no feedback driver or timer. This is a conservative reproducible lap, not a fastest-lap claim.

Load with `scripts.load(document, {tuning: 'apply'})` or explicitly choose `verify`; step exactly `scripts.progress().totalSteps`. See [the format and integration contract](../SCRIPTS.md) for EOF gating in RAF mode and fresh-respawn recording.

`tests/script-examples.test.ts` checks complete step counts, finite state, final pose and peak tolerances against `tests/fixtures/input-script-results.json`, actual lap completion, and repeated replay agreement. The committed expectations describe the same engine build; they are regression references rather than a promise of bit-identical results across engine versions or platforms.

To deliberately re-author all examples after a reviewed schema or vehicle change:

```sh
WRITE_INPUT_EXAMPLES=1 npx vitest run tests/script-examples.test.ts
```

This updates both the JSON drives and their reference outcomes using `tests/generateScriptExamples.ts`. Review the resulting changes together. Ordinary tests never rewrite the inputs or expectations. A missing new tuning key is an error; do not silently fill it at playback time.
