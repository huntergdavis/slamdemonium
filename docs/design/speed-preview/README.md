# D5 speed cues

Run `npm run dev -- --port 4186`, then open `/docs/design/speed-preview/`. This synthetic circle drive uses the actual WP3 track, D4 car, shared tuning store and WP7 Options panel. The camera holds a fixed 70° FOV without shake or roll. Enable movement to inspect road flow, boost to inspect sub-threshold streaks, and use Options → Camera to edit the two strengths. The preview starts paused for repeatable inspection and does not restore/write browser tuning storage. Its other Options values do not imply a complete physics simulation.

## What already existed

WP3 already contains every required world cue in design 10.2: **137 posts in one InstancedMesh**, alternating cyan/white in both 12 m rows; 3 m dashes with 6 m gaps; radial ticks; curbs; 8 m tiled procedural asphalt with mipmaps/anisotropy; and matching sky/FogExp2 at density **0.0025 m⁻¹**. D5 reuses those objects without adding geometry or changing their defaults. Along the view-depth axis, remaining contrast is `exp(-(density*depth)^2)`: 93.94% at 100 m, 67.66% at 250 m. Near posts stay crisp while distant repetitions emerge from haze.

This reuses [D1](../visual-direction.md) and the [R3 speed-and-vibe guidance](../../research/speed-and-vibe.md) found during the required `deja` recall. The shader equation was checked against the installed Three.js `fog_fragment.glsl.js`. Zero fog density is checked both numerically and by comparing actual WebGL pixels against `scene.fog = null`; default fog must also visibly differ, preventing an empty-scene false positive. Fog remains the existing WP3 configuration; no new fog schema key is introduced by D5.

WP5 mounts the original WP3 track through `createTestTrack` and `installTrackColliders`. D5's overlay composes with that owner’s main loop; FOV, shake, roll and camera transforms remain WP6 responsibilities.

## Store and rendering contract

PM approved two new **Camera** rows: `speedLinesStrength` and `vignetteStrength`, both range 0–1, step 0.05, default **0.5**, neither Quick Tune. They participate in presets, share links, change logs, A/B snapshots and recorded parameter sets through the existing schema. The total is 71; Quick Tune remains exactly 14. `setOptions` copies the current store values for drawing; it is not a second settings authority.

```ts
import { createSpeedCues } from './render/speedCues';

const cues = createSpeedCues(host); // full-viewport #app or positioned container
cues.setOptions(tuning.snapshot());
const unsubscribe = tuning.onChange(() => cues.setOptions(tuning.snapshot()));
const cueState = { speed: 0, topSpeed: 0, boostEnvelope: 0 };

// Existing render loop, after reading interpolated vehicle telemetry:
cueState.speed = telemetry.speed; // nonnegative m/s magnitude
cueState.topSpeed = tuning.get('topSpeed'); // unboosted reference speed
cueState.boostEnvelope = telemetry.boostEnvelope; // same smoothed envelope as WP6
cues.update(cueState, simulationRenderDelta); // zero while paused

// Existing resize owner; independent of the world's dynamic render scale:
cues.resize(host.clientWidth, host.clientHeight, window.devicePixelRatio);

// Teardown:
unsubscribe();
cues.dispose();
```

Factory exports `canvas`, `update(state, dtSeconds)`, `setOptions(options)`, `resize(width, height, pixelRatio = 1)` and `dispose()`. The interface was agreed with developer 1. No own RAF, event listener, physics reference or camera mutation. Keep snapshots outside the render hot path; `get()` supplies live values without allocations. Caller owns pause/time scale and sends simulation delta, not wall-clock time. Resize clamps pixel ratio to 0.5–2; canvas uses CSS dimensions and is independent of lower world resolution. Repeated equal resize/update calls do no drawing work. Zero strength clears previously painted pixels immediately, including during pause. Both zero hides the overlay entirely.

## Appearance and bounds

Let `r = clamp(speed/topSpeed, 0, 1)` and `s(x) = clamp(x,0,1)^2 * (3-2*clamp(x,0,1))`.

- Streak alpha ceiling: `0.30 * speedLinesStrength * max(s((r-0.8)/0.2), boostEnvelope)`. No streaks at/below 80% without boost; the shared envelope enables them while boosting below that threshold. Deterministic staggered spokes move outward with bounded phase; no flickering random reseeding. Streaks are 1.25 CSS px and cannot draw within the central 64% × 64% rectangle.
- Vignette corner-alpha ceiling: `0.12 * vignetteStrength * s(r)`. Elliptical falloff leaves the central region transparent. At defaults and top speed, maximum line alpha is 0.15 and corner darkening is 0.06. No vignette at rest.
- The canvas is `aria-hidden`, has no pointer events and uses z-index 5, below HUD 10 and Options 30. UI contrast is unaffected. No blur, post-processing pass, camera kick or FOV expansion.

Zero disables each independently; invalid/nonfinite inputs fail closed. For a reduced-motion preference, the owner can set the two store values to zero, preserving that choice in the same reproducible tuning state. The baseline world cues remain available.

## Verification

`npx vitest run tests/speed-cues.test.ts tests/tuning-schema.test.ts` checks threshold/boost/caps, independent zero values, invalid inputs, defaults/share round-trip, unchanged Quick Tune, existing instancing/fog and zero-density blending.

With the preview server running, `node docs/design/speed-preview/verify.mjs` checks actual canvas pixels: clear center, 80% threshold, boost onset, pause stability, bounded vignette and immediate all-zero clearing. It also compares zero-density WebGL fog against no fog, verifies new Options fields and pointer pass-through, checks resize, and saves default/maximum screenshots to `/tmp/slamdemonium-speed-preview`. Optional arguments: URL, screenshot directory. `PLAYWRIGHT_CHROMIUM_EXECUTABLE` selects a local Chromium build when needed. Software WebGL verifies rendering correctness; it is not a target-device performance measurement.
