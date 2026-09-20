# Decisions

Running log of technical decisions, spike results and changed defaults. New entries go at the bottom; this index is the way in.

## Index

| Date | Decision | Consequence |
|---|---|---|
| 2026-09-20 | [WP0: minimal browser scaffold and reproducible tooling](#2026-09-20--wp0-minimal-browser-scaffold-and-reproducible-tooling) | Strict TypeScript, Vite, three.js, Vitest and Playwright, every dependency pinned exactly; TypeScript held at 6.0.3 for typescript-eslint; no physics dependency until WP1 confirms the Jolt flavor. |
| 2026-09-20 | [WP1 / G0: GO with the separate single-thread Jolt WASM build](#2026-09-20--wp1--g0-go-with-the-separate-single-thread-jolt-wasm-build) | Jolt stays; `jolt-physics@1.1.0` via the separate single-thread WASM asset, all six spike probes passed; determinism is same-binary same-machine only; contact impulse is `number | null` because stock Jolt cannot supply a solved value. |
| 2026-09-20 | [WP5: vehicle force model and approved design corrections](#2026-09-20--wp5-vehicle-force-model-and-approved-design-corrections) | Preserve the configurable ellipse, correct COM load direction, cap dissipative impulses only, use the research drift latch, and keep recovery safeguards independent of handling sliders. |

| 2026-09-20 | [WP6: bounded camera and fixed rendering buffers](#2026-09-20--wp6-bounded-camera-and-fixed-rendering-buffers) | Cap delivered vertical FOV at 115 degrees with honest telemetry; share scaled render time; reuse four skid geometries and adjust resolution from wall time. |

When you add an entry, add one row here: date, the entry heading as a link, one line of consequence.

## 2026-09-20 — WP0: minimal browser scaffold and reproducible tooling

- Use strict TypeScript, Vite, three.js WebGLRenderer, Vitest, and Playwright.
  Keep the design section 5.3 directories ready for each work package. The initial
  scene is intentionally empty. `window.__game.ready` means the first frame rendered;
  unfinished gameplay methods throw clearly until their work packages wire them.
- `GAME_NAME` lives only in `src/core/constants.ts`. Page title and accessible
  application name use that value.
- Read the public npm registry with `npm view <package> version engines --json`
  on 2026-09-20. Confirmed latest: Vite 8.3.0, TypeScript 7.0.2, three 0.186.0,
  Vitest 5.0.1, Playwright 1.63.0, ESLint 10.11.0, @eslint/js 10.0.1,
  typescript-eslint 8.70.0, Prettier 3.9.8, @types/three 0.186.0, and
  @types/node 26.6.2. Pin every direct dependency exactly and commit the lockfile.
- **Compatibility choice:** pin TypeScript 6.0.3, the newest supported 6.0 release:
  typescript-eslint 8.70.0 declares TypeScript `>=4.8.4 <6.1.0`.
  Do not force an unsupported TypeScript 7 install. Pin @types/node 22.20.4
  to match the Node 22 runtime; development uses Node 22.22.1.
- Expose `npm test`, `npm run build`, `npm run e2e`, `npm run lint`,
  and Prettier write/check commands. Devops owns all `.github/` files and CI.
  E2E launches its own Vite server on port 4173 and Chromium with software WebGL
  support for headless hosts. Install Chromium with `npx playwright install chromium`.
- `VITE_BASE_PATH` selects the public base path (default `/`);
  deployment can run `VITE_BASE_PATH=/slamdemonium/ npm run build`.
  This follows [Vite's base configuration](https://vite.dev/config/shared-options.html#base).
  The Playwright server follows the [webServer contract](https://playwright.dev/docs/test-webserver).
- No physics dependency is installed before WP1 verifies the actual Jolt flavor.
  No runtime dependencies beyond three.js are introduced here.

- Validation: the WebGL smoke test also checks resizing and browser errors/warnings.
  Chromium's software renderer emits a specific ReadPixels GPU-stall diagnostic
  during trace capture; only that driver diagnostic is excluded. Application
  warnings and all other diagnostics still fail the smoke test.
- WP0 production payload: about 524 kB JavaScript (131 kB gzip), before Jolt.
  Vite reports the standard 500 kB chunk advisory; rendering passes without
  suppressing this build advisory. Revisit chunk loading when adding the engine.

## 2026-09-20 — WP1 / G0: GO with the separate single-thread Jolt WASM build

**Decision: keep Jolt. All Day-1 checks (design 4.2 a–f) passed.** Use
`jolt-physics@1.1.0`, independently confirmed against the npm registry.
Import `jolt-physics/wasm` and the exported
`jolt-physics/jolt-physics.wasm.wasm?url` asset. The bare package and
`wasm-compat` embed the binary; neither is the flavor used here.
No workers, SharedArrayBuffer, or COOP/COEP headers are needed.

Reuse [R1's verified integration and ownership notes](research/jolt-integration.md)
and the [upstream cleanup example](https://github.com/jrouwe/JoltPhysics.js/blob/c9c122bcd48e92885fbee7d267c928c3781d581c/Examples/proper_cleanup.html).
The generated loader does not accept `wasmBinary`; Node tests supply the
resolved filesystem path through `locateFile`, while the browser uses Vite's
hashed asset URL. Every engine type remains in `src/physics/joltWorld.ts`.

### Reproducible evidence

Run `npm test` for the real-engine adapter/loop tests and Node spike.
Run `VITE_BASE_PATH=/slamdemonium/ npm run e2e` for the built production
browser spike. `E2E_PORT=4181` optionally avoids another clone's local server;
the default remains 4173. E2E now builds and starts its own production preview,
rather than testing the dev server. Devops was notified; no CI file was changed.

| Required probe                             | Observed result                                                                                                                                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a) Dynamic box on static ground at 120 Hz | Settled center Y = 0.4841 m for a 1 m box; stable within the engine's contact tolerance.                                                                                                    |
| (b) World-point force and torque           | -1200 N on a 12 kg body for 1/120 s produced Z velocity -0.833333 m/s; offset force plus torque produced positive yaw velocity 5.25 rad/s. The next unforced step did not repeat the force. |
| (c) Downward raycast                       | Distance 4.00000006 m, normal (0, 1, 0); separate test verifies chassis exclusion, surface ID, and reused collector misses.                                                                 |
| (d) 85 m/s versus a 4 cm wall              | LinearCast stopped the box at X = -0.1000 m. A matching discrete-motion control tunneled beyond the wall.                                                                                   |
| (e) One active box step budget <0.2 ms     | Node measured 0.0923 ms/step during the full suite. Production Chromium measured 0.1118 ms/step, also below 0.2 ms. This is a local host measurement, not the MacBook acceptance run.       |
| (f) Production build and WASM loading      | Chromium fetched the hashed WASM with HTTP 200 and application/wasm under /slamdemonium/; crossOriginIsolated was false. No browser errors.                                                 |

Two runs of the same seed and inputs, each 300 simulated seconds, produced
identical final-state hashes in Node (`4691007e` both times) and passed the
same-browser equality assertion in Chromium (also 4691007e both times). All 72,000 sampled states were
finite and angular speed stayed within the configured cap. This is rigid-body
probe input, not the future WP5 vehicle acceptance suite.

The stock build is **not** compiled with CROSS_PLATFORM_DETERMINISTIC.
The adapter enables runtime mDeterministicSimulation, but that is a separate
setting. The established guarantee here is repeated runs in the same browser;
this is **same-binary, same-machine determinism**. Cross-platform determinism
remains unproven. This closes the stock-build repeatability risk for design
section 3 and the same-environment replay plan in section 15, without claiming
cross-browser or native/WASM identity.

The **0.0923 ms physics-only one-box baseline** is below both the 0.2 ms spike
budget and the 1.0 ms combined engine/vehicle-model budget. Measure the future
WP5 vehicle model against this baseline; its force computation is not included
in this measurement.

The WASM heap reserves 134,217,728 bytes. Repeated warmed-up create/step/dispose
cycles lost **0 allocator bytes**, measured through sGetFreeMemory, not inferred
from heap capacity. The reusable method is: create/step/dispose eight worlds,
capture allocator free bytes after the third warmup cycle, and subtract the final
free-byte count from that baseline. A zero difference is the measured answer to
the repeated-lifecycle WASM leak risk; WP9 should reuse this allocator check
alongside its longer workload and JS-heap sampling. Native scratch and query objects are reused; borrowed return
values are copied immediately and never destroyed. The broader browser JS-heap
and multi-car performance acceptance remains WP9.

Current production assets: separate WASM 2,021,569 bytes / 740,847 gzip;
adapter plus loader about 938 kB / 134 kB gzip; entry about 553 kB / 137 kB gzip.
Vite still reports the upstream Emscripten node:module externalization and
large-chunk advisories. The served browser build works without Node polyfills.

### Adapter and loop contracts

- Body IDs and caller-owned vectors/quaternions are engine independent. Mass/CoM/
  inertia updates preserve body origin, orientation, and both velocities.
  CoM offsets use the standard local axes (+Z backward); the demo maps the
  tuning store's positive-forward comLongOffset to negative Z.
- The adapter adds teardown, allocator diagnostics, velocity initialization for
  reproducible probes, and optional ray-body exclusion/surface IDs to the
  section 5.3 sketch. These keep engine access inside the adapter.
- **PM-approved contact refinement:** impulse is `number | null`.
  Null means the engine did not supply a solved impulse. Stock Jolt still
  supplies the real body IDs, point, and normal. Fabricated zero values or
  velocity-delta estimates would corrupt future crash severity and damage
  scoring; null forces consumers to handle missing data. Rapier can supply
  real solved impulses via contactImpulse/contact-force events, so this is
  an engine capability difference, not a permanent absence.
- FixedStepLoop samples input immediately before each preStep, then calls
  stepPhysics and postStep with constant 1/physicsHz. Only accumulator input
  is scaled by timeScale. Frame dt is capped at 0.1 s, work at eight steps,
  and excess whole steps are discarded while retaining the fractional remainder.
  Hidden-tab pause/resume resets the clock.
- Live physicsHz/timeScale getters read the merged TuningStore. Position lerp
  and quaternion slerp write reused transforms; the proof camera follows the
  interpolated position. The loop/interpolation tests pass at 60 and 144 Hz,
  timeScale 0.05/0.5/1/2, large gaps, live rate changes, and pause/resume.
- The box/plane/thin-wall scene and direct test force/torque are the WP1 proof.
  WP5 supplies the vehicle force layers; WP3/WP6 supply the track and full visuals.

- Production E2E also bundles the independent input fixture from
  src/input/testFixture.ts, installed before ready only when VITE_TEST_API=1.
  Playwright sets that build flag and runs all three original input behaviours
  (focus/Tab, editing-does-not-steer, latency probe) against the same production
  preview as boot/physics. The fixture owns its mapper so simulation steps cannot
  consume the tests' action edges. Two browser workers bound software-WebGL load.
  No separate dev server or deferred built-input coverage gap remains.
- Verified a normal production build with VITE_TEST_API unset: emitted assets
  contain no testFixture chunk, __inputFixture reference, or test-number panel
  marker. This supersedes the proposed later bundled-fixture follow-up.

## 2026-09-20 — WP5: vehicle force model and approved design corrections

The vehicle is one Jolt box and four suspension rays. Pure tire, engine, steering,
and suspension arithmetic lives under `src/vehicle/`; engine types remain confined
to `src/physics/joltWorld.ts`. All wheel state, vectors, queries and force scratch
are allocated once. The model uses the adapter's actual local inertia diagonal
after mass/COM/inertia updates. The boot path installs WP3's ground and barriers
once and removes both WP1 proof colliders.

PM rulings on 2026-09-20 resolve four inconsistencies without changing any schema
names, ranges, or defaults:

- **Friction ellipse:** keep design 6.5.4. `combinedSlipCoupling` intentionally
  controls forgiveness; at zero both axes independently reach mu × Fz, so the
  resultant can reach sqrt(2) × mu × Fz. Section 13.1's unconditional circle test
  was wrong. Tests enforce Fx² + coupling × Fy² <= (mu × Fz)² for every coupling,
  the strict circle only at one, and independent axes at zero.
- **COM direction:** front static share is 0.5 + comLongOffset / wheelbase.
  Positive means forward in both 6.2 and 7.2; the printed minus silently inverted
  the slider's documented understeer/oversteer meaning. Adapter-local forward is
  -Z. A unit test pins increasing front load with positive offset.
- **Impulse cap:** limit forces dissipating existing slip: lateral friction,
  brakes, handbrake, and passive resistance. Do not cap engine launch force by
  current slip: zero initial slip would then forbid launching. A lagged lateral
  force is suppressed when it points along current slip, preventing energy gain.
- **Assist-off:** `countersteerAssist` and `yawAssist` govern tunable handling
  assists only. The drift tracking and limiter both go exactly to zero with
  `yawAssist`. Air damping (fewer than two grounded wheels) and anti-flip
  (past 35 degrees of roll) remain independent internal stability safeguards.
  Coupling them to yawAssist would silently make a drift-feel control alter flip
  recovery. Neither can mask the raw tire model in ordinary grounded flat driving.

Implement the approved [research drift controller](research/drift-assist.md),
not the printed 6.8 C target law: latch the drift side, capture its neutral angle,
slew the target at 90 degrees/s, permit a true zero-angle counter-steer/lift exit,
exit with hysteresis, and share one bounded yawAssist-gated tracking/limiter
budget. Parameter names `yawAssist` and `maxDriftAngle` are unchanged. Arithmetic
checks do not certify the human five-second drift acceptance test.

Boost starts empty and is earned by drifting. For repeatable tuning,
`window.__game.setDriftMeter(value)` fills/clamps the meter to [0,1] without
requiring a drift; `setInput({ throttle: 1, boost: true })` can exercise boost
and `releaseInput()` restores keyboard/gamepad control. This is the existing
automation surface, not a new player control.

Recall before implementation: `deja "Slamdemonium WP5 vehicle suspension drivetrain drift assist"`
found no prior implementation. `deja "vehicle zero assist"` found research session
`01a0c04e-e95`, restating the zero-assist/sign checks also documented in R2.

### Numeric acceptance and replay evidence

At Default, 120 Hz, from a settled spawn, the **real suspended Jolt vehicle**
reaches **100 km/h in 2.208333 s** and **55 m/s in 6.750000 s**. These include the
throttle rise filter, suspension, tire limits and force application, and pass the
2.0–2.3 s / 6.3–7.1 s acceptance ranges. The independent engine-formula unit test
also passes those ranges. The integration test writes
`scratch/vehicle-acceleration.json`. Measure simulated steps, not browser wall
time: headless rAF throttling and the fixed loop's eight-step cap deliberately
drop excess wall-time debt. A PM headless wall-time probe (about 0.29 m/s after
2.5 seconds) therefore does not represent a 2.5-second acceleration run.

Two seeded 300-s / 36,000-step real-vehicle runs produce the identical
**exact float-bit state hash `1e4445c7`** (pose, linear/angular velocity, boost,
and drift controller state). Maximum angular speed was 2.715300 rad/s, below the
default 12 rad/s cap; every sampled state stayed finite without recovery.
This is same-binary, same-machine evidence, not cross-platform determinism.

Measured model-plus-Jolt mean step cost on this shared development machine was
0.273 ms for the first run and **0.218 ms for the warmed second run**, below the
1.0 ms model budget. This measures controls, four suspension queries, tires,
assists, the engine step and telemetry on a flat plane; it excludes rendering
and is not a target-laptop FPS claim. Compare against WP1's 0.092 ms one-box
physics-only baseline. The soak writes `scratch/vehicle-soak.json`.
Vitest files run sequentially so the 300-s vehicle soak does not compete with
the G0 microbenchmark. No timing threshold is relaxed.

The production-browser G1 test passed in CI in 19.5 s: actual keyboard throttle,
left turn, following camera, and R respawn on WP3. The boost API test also passed.
The full track's software shadows make input-heavy browser tests slower than
the proof scene; their test budget is 90 s while preserving every input assertion.
The human five-second drift hold/exit evaluation remains a separate playtest.

### One owner for mass rebuilds

PM ruling: boot owns `DebouncedMassRebuild`, the only subscriber that applies
`needsRebuild` changes. It coalesces them for 100 ms and exposes synchronous
`flush()`, `cancel()` and a reused read-only `{ status, error }` state
(idle/pending/error/unavailable). Options only observes that state through
`readRebuildState`; it must not run a second timer or physics update. This avoids
double rebuilds and interleaved callbacks, and works without a panel mounted.
Manual `stepMany` and respawn flush before step zero. Replay integration must
flush or cancel before reset so no pending timer fires during the script.
Mass updates preserve pose and linear/angular velocity; respawn separately
clears controls, wheel histories, drift controller, boost meter and visual state.

## 2026-09-20 — WP6: bounded camera and fixed rendering buffers

- **Final FOV, not speed ratio, is bounded.** Preserve the design 10.1 formula
  and slider ranges, then clamp delivered vertical FOV to [1, 115] degrees.
  QUESTIONS.md #3 records why: legal boosted speeds can request an invalid
  560-degree projection. Debug telemetry exposes `cameraFovRequested`,
  `cameraFov`, and `cameraFovCapped`; exceeding the ceiling never silently
  changes the apparent meaning of a slider. NaN falls back to 70 degrees;
  infinities hit the finite bounds.
- **Chase position uses the analytical critically damped spring.**
  `camFollowTime = 2 / omega` is the damping time, not a frame lerp factor.
  Heading and planar travel direction interpolate by their shortest angle;
  velocity participates only above 8 m/s. Roll uses conventional G
  (9.81 m/s²), independent of the gravity tuning control. Shake uses continuous
  deterministic sine components and suspension compression relative to a
  smoothed baseline; `camShake = 0` removes both. The future impact hook
  accepts real solved impulses; Jolt's null never becomes an invented kick.
- **One scaled render delta** comes from the fixed-step loop after its catch-up
  cap. Camera motion and speed cues use it, so pause freezes their time and slow
  motion slows them. Manual `stepMany` advances physics time and skid ages
  without fabricating a wall-clock frame. Dynamic resolution instead observes
  real presented-frame intervals: a 0.5 s exponential average above 18 ms for
  2 s reduces scale by 0.1, down to 0.6. Below 17 ms for 2 s restores 0.1,
  up to 1.0; the recovery threshold includes healthy 60 Hz rendering.
  Visibility changes reset the timing sample. Base DPR remains capped at 2.
- **Skids allocate four geometries once**, each holding 8192 six-vertex segments
  in typed-array rings. Contact normals lift strips 12 mm above the surface;
  airborne/low-slip samples and respawns break continuity, and jumps beyond
  5 m never connect. Samples closer than 15 cm wait for movement. A GPU age
  uniform fades marks over 20 simulation seconds; expired slots are overwritten
  by the ring. Dirty uploads reuse range records: there are no per-mark meshes,
  materials, vectors, or range objects.
- **D4 owns visual presentation; WP6 supplies render-ready state.** The existing
  vehicle history interpolates signed wheel spin advance before wrapping to
  [0, 2π), preserving direction at the wrap boundary. C cycles chase/far/hood
  and G routes the existing input action to designer gizmos. Far uses 1.6 times
  chase distance and 1.5 times height; hood follows the chassis at local
  (0, 0.65, -1.55). Automation can use
  `window.__game.setCameraPreset('chase' | 'far' | 'hood')`.
