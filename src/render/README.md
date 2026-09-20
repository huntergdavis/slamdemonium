# Rendering integration

`main.ts` owns the frame, input actions, resources and disposal. The renderer
owns resize and world resolution. D4 owns `carVisual.ts`/`carVisualState.ts`;
D5 owns `speedCues.ts`. Neither starts its own animation loop.

- `CameraRig.update(pose, vehicle.telemetry, loop.renderDeltaSeconds)` consumes
  interpolated chassis pose. `reset()` snaps after respawn; `setPreset()`
  accepts chase/far/hood. The input mapper's C action cycles these presets.
  `addImpact(impulse, mass)` ignores null impulses; stock Jolt supplies null.
- `VehicleVisualHistory.beforeStep()` runs before physics;
  `interpolate(alpha, pose)` supplies D4's render-ready state. Signed spin
  advance is interpolated before wrapping. G routes to `toggleDebug()`.
- `createSkidMarks(scene).sample(wheels, simulationSeconds)` runs after
  physics; `update(renderSimulationSeconds)` uploads changed ranges and sets
  GPU fade time. `breakStrips()` prevents respawn bridges. Four fixed rings
  retain at most 8192 segments each, with no per-mark objects.
- Speed cues use `loop.renderDeltaSeconds`, the shared scaled frame delta
  after catch-up debt is discarded. Paused frames have zero delta. Resize uses
  CSS dimensions and native DPR, independent of world resolution.
- Dynamic resolution measures wall-clock frame intervals, smoothing over
  0.5 seconds. Two seconds above 18 ms reduces scale by 0.1; two seconds below
  17 ms restores 0.1. Scale stays in [0.6, 1], with base DPR capped at 2.

## Debug and automation

`window.__game.setCameraPreset('chase' | 'far' | 'hood')` supports screenshots.
`getTelemetry()` includes:

| Field | Meaning |
|---|---|
| cameraFov | Delivered vertical FOV, degrees, bounded to [1, 115] |
| cameraFovRequested | Raw design formula before the final projection bound |
| cameraFovCapped | Requested and delivered FOV differ |
| cameraRoll | Delivered camera roll, radians |
| cameraPreset | chase, far or hood |
| cameraPosition | Final world position including shake/bob |
| renderScale | World resolution multiplier, [0.6, 1] |
| smoothedFrameMs | Real frame-time average used by resolution controller |
| skidSegments | Occupied ring slots, including faded slots awaiting reuse |
| skidSegmentsWritten | Cumulative segments emitted |

For an allocation-free HUD, read `cameraRig.telemetry` and
`view.resolution` directly; the automation snapshot intentionally allocates.
See [the WP6 decision](../../docs/DECISIONS.md#2026-09-20--wp6-bounded-camera-and-fixed-rendering-buffers)
for camera time constants, FOV rationale and skid lifetime.

After mounting the track, car and skid meshes, call prepareScene(scene) once.
It separates shared materials across instancing variants and assigns stable
shadow depth materials. Keep its disposable with the scene resources. It
preserves identity for materials used by only one kind of mesh (including
animated brake lights); mixed-kind materials are static snapshots. A later
topology-changing mount needs preparation too. The current scene uses ordinary
and instanced meshes with directional shadows, not skinned/batched meshes or
point-light distance shadows.

The built-browser allocation regression is e2e/allocation.spec.ts. Its
VITE_TEST_API diagnostic counts parameter/cache-key builds, not compiled shader
count, and is absent from a normal production build. The test's five minutes
are simulated; npm run perf retains the sustained wall-time acceptance check.
