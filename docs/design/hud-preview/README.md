# WP8 HUD and telemetry

Run npm run dev and open /docs/design/hud-preview/. This mounts the actual HUD and Options with synthetic telemetry. H cycles Full → Minimal → Off; F9 starts/stops CSV; O opens Options. Enable Animate telemetry for changing values. The preview uses a **one-second recording capacity** to demonstrate automatic stops; production defaults to ten simulated minutes.

This implements [D1's instrument contracts](../visual-direction.md#5-hud-layout-design-section-12) with the [D3 components](../ui-kit/README.md). Required deja recall found the canonical brief in prior techwriter work; section 12 and the current producer types remain authoritative. The compiled-browser fixture follows tests/options/server.ts.

## Mount contract

Import mountHud from src/ui/hud.ts. Boot owns main.ts, clock and keyboard routing; WP8 does not edit them.

~~~ts
const renderTelemetry = {
  cameraFov: 70, cameraFovRequested: 70, cameraFovCapped: false,
  renderScale: 1, smoothedFrameMs: 0,
}; // Allocate once, then update from CameraRig.telemetry/view.resolution.
const hud = mountHud({
  host: options.root, // Inherit Options-open layout rules.
  store: tuning, session: options.session,
  readTelemetry: () => vehicle.telemetry,
  readRenderTelemetry: () => renderTelemetry,
});
// Existing input owner, including while paused:
hud.cycleMode(live.actions.hud); // modulo THREE, not odd/even
if (live.actions.recordTelemetry % 2) hud.toggleRecording();
// After each vehicle postStep AND physicsStepMs timing measurement:
hud.recordStep(vehicle.telemetry, dtSeconds, renderTelemetry);
// Existing render loop, monotonic wall clock:
hud.update(nowMs);
// Screenshot hook and teardown:
hud.setMode('minimal'); // full | minimal | off
hud.dispose();
~~~

HudTelemetry/HudRenderTelemetry are exported from src/ui/hudTelemetry.ts. Physics uses the reused VehicleTelemetry. The optional render getter uses the exact five fields above: vertical FOV degrees, cap boolean, resolution multiplier and smoothed frame milliseconds. Missing render data displays an em dash; CSV camera cells remain empty. Full and Minimal show both delivered/requested FOV when capped.

Both getters are gated BEFORE reading at ≤30 Hz; Off/collapsed does not read them. Nodes/canvases are cached. The frame fast path changes numeric timing only; the 30 Hz pass formats text without allocating arrays, snapshots, vectors or drawing objects. ResizeObserver is the only dimension-read path. Disposal releases subscriptions, observers, canvas buffers, recorder memory and the last download URL.

## Instrument interpretation

Speed is magnitude with R for reverse. Slide ticks show both ±driftMinAngle; clipping the marker never clips the number. Steering reuses the vehicle steeringLock function. Pedal bars show actual brake01/handbrake01; CSV also preserves the command fields.

Wheels are FL/FR/RL/RR, usage 0–1.5 with threshold at 1.0, red plus ! above it, unclipped numeric values, and load in kN. Unloaded wheels show AIR/—; loaded wheels expose LOCK/SPIN. Boost/drift read the producer's values without inventing another resource. Charging has steady text and a gentle pip animation respecting reduced motion.

G-G is right-positive lateral X and forward-positive longitudinal Y, m/s². Its dashed **nominal** circle is min(gripFront, gripRear) × surfaceGrip × gravity; developer 1 confirmed effective gravity is the slider directly. The nominal reference excludes downforce/load sensitivity and is labeled accordingly.

Five panes share ten **wall-clock** seconds: speed m/s, beta degrees, yaw degrees/s, lateral Earth G (acceleration/9.81), signed mean loaded-wheel front/rear slip degrees. Front is solid cyan, rear dashed violet. Missing contacts and long observation gaps are not connected. The ring holds 301 samples. Minimal retains history without drawing plots.

Minimal keeps FPS and smoothed frame time (for example, 60 FPS · 16.7 ms), speed, slide, boost/drift, preset/A–B, timeScale and FOV feedback. Press H once from Full, or use the HUD mode button, for this view without the diagnostic plots. Full shows the same FPS/frame-time readout; Off removes instruments but preserves recording feedback. The dock activates at widths up to 1100 px or heights up to 820 px, preventing overlap at 1440×720. It can collapse without changing H mode. Options owns the gear button; mount under its root for panel-aware placement.

## CSV

TelemetryRecorder allocates a Float64Array at F9 start, sized ceil(durationSeconds × CURRENT physicsHz). durationSeconds defaults to 600 and is configurable at mount. The 53 columns reserve approximately **29.1 MiB at 120 Hz for ten minutes**. Every physics call immediately COPIES scalars into its numeric row; it never stores a reference to mutable telemetry or allocates a row object.

F9, capacity exhaustion, a physicsHz change, or mismatched dt stops sampling. Capacity/rate reasons remain visible in the HUD and explicit in the CSV header. The rate-change event is logged, but the new-rate sample is excluded. The next recording sizes itself to the new rate. No samples are overwritten to extend a capture. Pausing adds no physics samples.

Serialization/download occurs on the next HUD update, outside the physics step. Headless users can call takeExport. An optional onExport sink receives {blob, filename, reason, samples, elapsedSeconds}; the default requests a CSV download. One object URL is retained until the next export/disposal.

Line 1 is a # JSON header: version 1, start time, initial complete parameter set and physicsHz, copied live parameter changes, stopReason, sample count, capacity and simulated duration. Line 2 names every numeric column with units. All section 6.11 fields are present: both speeds, v_long/v_lat, beta/yaw rate, both accelerations, steering, throttle/brake/handbrake, boost/drift meters, grounded count, step timing and steps/frame; each wheel has Fz, slip angle, usage and spinning/locked flags, plus grounded. Extras: time, sample index, dt, timeScale, actual brake values, boost envelope and camera/scale fields. Angles are radians except camera *_deg columns; booleans are 0/1; unavailable/nonfinite cells are empty.

## Checks

- npx vitest run tests/hud-telemetry.test.ts: reused-object acceleration does not alias prior samples; rate-sized capacity; stop reasons; full parameters/live changes; bounded signed history.
- npx playwright test e2e/hud.spec.ts: built DOM/CSS, stable nodes, units/flags/FOV, read throttling, H/F9, actual CSV download, automatic stops, responsive layout and Options.
- TypeScript, production build and lint remain required. This synthetic fixture verifies the UI contract, not vehicle dynamics or hardware performance.

The CSV header explicitly defines steps_per_frame as the **last completed rendered frame** total, stable during the current catch-up loop. Developer 1 confirmed the producer retains that value until render; WP8 never substitutes the partial loop counter. Each row uses the supplied physics dt for simulated time and the shared store for timeScale.
