# Decisions

Dates in this log are Pacific time, the clock of the machine the commits come from; an agent reading UTC will see the next day for late entries.

Running log of technical decisions, spike results and changed defaults. New entries go at the bottom; this index is the way in.

## Index

| Date       | Decision                                                                                                                                | Consequence                                                                                                                                                                                          |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-20 | [WP0: minimal browser scaffold and reproducible tooling](#2026-09-20--wp0-minimal-browser-scaffold-and-reproducible-tooling)            | Strict TypeScript, Vite, three.js, Vitest and Playwright, every dependency pinned exactly; TypeScript held at 6.0.3 for typescript-eslint; no physics dependency until WP1 confirms the Jolt flavor. |
| 2026-09-20 | [WP1 / G0: GO with the separate single-thread Jolt WASM build](#2026-09-20--wp1--g0-go-with-the-separate-single-thread-jolt-wasm-build) | Jolt stays; `jolt-physics@1.1.0` via the separate single-thread WASM asset, all six spike probes passed; determinism is same-binary same-machine only; contact impulse is `number                    | null` because stock Jolt cannot supply a solved value. |
| 2026-09-20 | [WP5: vehicle force model and approved design corrections](#2026-09-20--wp5-vehicle-force-model-and-approved-design-corrections)        | Preserve the configurable ellipse, correct COM load direction, cap dissipative impulses only, use the research drift latch, and keep recovery safeguards independent of handling sliders.            |

| 2026-09-20 | [WP6: bounded camera and fixed rendering buffers](#2026-09-20--wp6-bounded-camera-and-fixed-rendering-buffers) | Cap delivered vertical FOV at 115 degrees with honest telemetry; share scaled render time; reuse four skid geometries and adjust resolution from wall time. |

| 2026-09-20 | [WP14: mount the tuning laboratory and share command consumption](#2026-09-20--wp14-mount-the-tuning-laboratory-and-share-command-consumption) | Mount persistent Options, HUD and replay on the live store; consume command edges once across stepping and paused UI polling. |

| 2026-09-20 | [WP13: stable material programs and heap regression](#2026-09-20--wp13-stable-material-programs-and-heap-regression) | Prepare material variants once, render planar skids in one pass, and gate retained heap growth without treating function-level allocation attribution as proof of new objects. |

| 2026-09-20 | [F0: canonical tyre surfaces and diagnostic lifetime](#2026-09-20--f0-canonical-tyre-surfaces-and-diagnostic-lifetime) | Resolve registered contacts once, preserve physical grounding and global grip, and keep disposed-world diagnostics visibly invalid. |

| 2026-09-22 | [Five virtual gears and presentation-only gear count](#2026-09-22--five-virtual-gears-and-presentation-only-gear-count) | Ship five derived gears with 1.6 spacing; expose integer 3–8 gear count tuning without changing acceleration or braking. |

| 2026-09-22 | [Six-gear audio profile and deliberate redline cruise](#2026-09-22--six-gear-audio-profile-and-deliberate-redline-cruise) | Ship the CTO upload verbatim while keeping the existing 0.97 unboosted-top-speed cap: top gear is deliberately boost-only and unboosted cruise stays near redline. |

| 2026-09-22 | [RPM ramp and independent firing-rate presentation controls](#2026-09-22--rpm-ramp-and-independent-firing-rate-presentation-controls) | Shape the RPM sweep with an exponent and scale worklet pulse timing separately; neither control changes vehicle forces or the tachometer's RPM. |

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

- **D5 is mounted from main's render loop.** Its preallocated state receives
  speed, unboosted topSpeed and the same boost envelope as the camera; both
  strength controls come directly from the shared tuning store. The overlay
  retains native DPR (capped at 2) when world resolution decreases, preserving
  line width and UI clarity. Its canvas does not intercept driving input.

## 2026-09-20 — WP14: mount the tuning laboratory and share command consumption

Production boot now mounts Options, HUD and ScriptController using the same
live TuningStore and vehicle. Options creates its TuningSession persistence,
so local autosave, JSON import/export and hash restoration participate in the
real game. Boot installs its single mass debounce and live body-property
subscriber before restoration, then flushes restored mass before the first
step. UI only observes the rebuild state.

O, H, F9, Tab, T and P now dispatch alongside R/G/C. T toggles 0.25×/1×;
P, Options' pause request, visibility, perf automation and replay completion
have independent pause flags. Closing Options cannot silently release another
pause request. A paused frame calls InputMapper.sampleActions: it consumes the
same previous-count bookkeeping used by sampleForStep, but does not sample a
script, driving filters or latency. This keeps unpause usable without delivering
an edge twice. Live steps still poll the gamepad exactly once.

HUD samples the borrowed vehicle record after postStep/timing, and reads one
reused render record. CSV stepsPerFrame remains the last completed rendered
frame total, updated only in render. H cycles all three modes; F9 records real
physics samples and exports on a HUD update outside the step.

Replay reset releases injected input and a perf step driver, cancels pending
mass work, synchronously rebuilds current mass, and resets vehicle and visual
history. Both RAF catch-up and manual stepping gate exact EOF. Live respawn
cancels replay, resets to the track spawn and certifies fresh-recording
eligibility. A respawn requested during a step waits until the paired script
postStep completes; UI command polling never invents a physics sample.

Automation now exposes setHudMode and setOptionsOpen alongside setCameraPreset.
The scripts surface includes playback, results, lap progress and fresh-respawn
input recording. Runtime integration tests exercise the built application under
the deployment base path, in addition to the isolated UI component fixtures.

Input-script recording rejects an existing injected input/perf driver, and
setInput or attaching a perf driver rejects active script capture/playback.
The recorder observes mapper.state, so allowing a separate vehicle override
would silently record different commands. Release automation input before a
fresh-respawn recording. F9 telemetry CSV remains independent.

## 2026-09-20 — WP13: stable material programs and heap regression

Reuse research's [allocation evidence](research/perf-outliers.md) from PR #43,
including its exact baseline and full selected stacks. That trace established
allocation traffic, not a leak, and only two slow-step/GC overlaps were decisive.
This change addresses the memory requirement; it promises no frame-time or p99
improvement.

Three r186 caches a material's current program variant. Our track shared paint
between ordinary ring meshes and instanced dashes/ticks, causing repeated
instancing-state invalidation. Its default shadow depth material similarly
alternated between the instanced track and ordinary car meshes. Each lookup
reconstructed parameters and cache-key arrays/strings even if the compiled
program already existed. After mounting the scene, prepare material variants
once for each ordinary/instanced/instance-colored use, and give each shadow
caster its own depth material. Animated single-kind materials retain their
identity, so brake lights continue updating. The preparation owns only its
clones and depth materials, restores original references on disposal, and must
run after any future topology-changing mount. No Three source is patched.

Ground-hugging transparent skid strips use forceSinglePass. Their flat geometry
does not need front/back transparent-volume sorting; the default double pass
otherwise increments material.version twice per draw. Existing segment buffers
and dirty-range records remain reused.

**Vehicle attribution remains unresolved, not proven boxing.** Source inspection
found that tire/suspension vectors, ray outputs, histories and telemetry already
reuse storage. A targeted Node/Vite SSR probe also attributed traffic to scalar
math returns (dot, clamp, hypot); V8 reported fast properties for the vehicle,
wheel, telemetry and vector objects. Those observations do not identify the
allocated object types or establish numeric boxing as the cause. Do not rewrite
the force model or alter borrowed Jolt ownership on that basis. Dependency/VM
allocation can remain, and a stable retained heap cannot prove zero transient
allocation.

The automated regression runs through the **production preview build** at
120 Hz for 36,000 real vehicle steps, with steering, braking and handbrake,
plus an explicit render per simulated second. It compares post-GC JS heap at
simulated minute one and minute five (maximum 10% growth), checks WASM allocator
free bytes as well as heap capacity, requires zero non-finite-state recoveries and skid
activity, and records exact EOF. This accelerated test does not replace
npm run perf's sustained wall-time run. The VITE_TEST_API-only diagnostic counts
actual customProgramCacheKey calls, which observe parameter reconstruction
even on compiled-program cache hits. A fixed warmed view must make zero calls;
restoring the original shared-material pattern is a negative control that
must make calls again. A default production build excludes the diagnostic.

The first CI run exceeded the suite's 90-second deadline on all three attempts;
it is not counted as passing. Its traces show 87–90 seconds inside completed
simulation/render batches. The last attempt reached all 36,000 steps and all
assertions: retained JS was 9,300,436 → 9,533,468 bytes (+2.51%), WASM capacity
134,217,728 bytes and allocator free space 121,256,280 bytes were unchanged,
and warmed parameter builds were zero versus 24 after restoring shared materials.
Give this regression its own 180-second budget, preserving the full workload
and every memory/counter assertion. These elapsed times are test-runner evidence,
not measurements of the physics step budget.

[Hosted CI run 35545284828](https://github.com/huntergdavis/slamdemonium/actions/runs/35545284828)
then passed all 174 unit tests and 27 browser tests, with no browser retries.
The full 36,000-step regression completed: retained JS was 9,236,500 → 9,466,408
bytes (+2.49%); WASM capacity remained 134,217,728 bytes and allocator free space
remained 121,256,280 bytes. The warmed fixed view made zero parameter builds;
restoring shared materials produced 24. This demonstrates the repaired render
call pattern and bounded retained memory, without resolving the separate
vehicle/suspension allocation attributions discussed above.

## 2026-09-20 — F0: canonical tyre surfaces and diagnostic lifetime

The content catalog is the shared authority for material identity and grip.
Validate its dense IDs, authored materials and body registrations during world
construction. The world resolver refines its registered ground by the existing
kerb footprint and maps registered barriers to concrete. It does not trust a raw
ray's numeric surface metadata or project wall contacts onto a floor layout.
Every Vehicle constructor requires the resolver explicitly; the flat-plane and
ring test harnesses use the same pure world factory as the track wrapper.

Keep RayHit as raw physics data and publish the result in nullable
wheel.surfaceId. Grounded remains the physical ray-hit fact. An unregistered
body therefore retains suspension and rigid-body contact while its canonical ID
and tyre grip are null. This matters for future debris: an unknown material must
not remove the springs supporting the car. Known impact-only concrete similarly
has null tyre grip. Neither case applies tyre forces; a ground coefficient of
zero remains a valid, different case that can still report driven wheelspin.

Strict numeric catalog validation belongs before simulation. The tyre path uses
getKnownSurfaceDefinition with the resolver-proven ID and caches only its scalar
grip multiplier. It multiplies the existing live surfaceGrip tuning control;
tire.ts, load sensitivity, slip, combined-slip coupling and braking formulas are
unchanged. Both initially authored ground coefficients are 1. New lookups and
cached wheel fields reuse construction-time data and existing ray records.

The resolver owns one diagnostic record. Unknown-body evidence latches once and
does not disappear on ordinary respawn or mass rebuild. VehicleTelemetry exposes
that readonly live reference; window.__game.getTelemetry copies it for an owned
automation snapshot. Disposing a track immediately marks every issued resolver
record disposed, even without another ray query. Rebuilding creates a fresh
resolver and Vehicle with clean diagnostics. An old reference remains disposed
and can never become the new world's apparently healthy record. Tests check
both the clean replacement and the retained old reference, plus a second unknown
body not overwriting the first diagnostic.

Reuse the [scripted flat-plane experiment](../tests/integration/README.md):
stock Jolt 1.1.0, Node 22.22.1 on Linux x64, default tuning, actual suspended
vehicle and scripted input at 120 Hz. Before and after this change, all recorded
simulation results (including final poses) match exactly: 100 km/h after
265 steps, **2.2083333333333335 simulated seconds**; 55 m/s after **6.75 seconds**;
and braking from a 59.999519 m/s scripted approach reaches the first forward stop
after **72.3990478515625 metres** and **2.5166666666666666 seconds**. The regression
pins the acceleration step and braking distance to sub-millimetre rounding,
alongside the original broader design acceptance bands. These are simulated
workload results, not host wall-time or cross-platform determinism claims.

The focused real-Jolt tests also exercise a test-only lower-grip definition,
live global grip changes, concrete and unregistered-body suspension, zero grip,
stale airborne hit gating and stable reused wheel/ray records. The added
production-preview browser spec checks canonical surface telemetry, live global
grip and independent diagnostic snapshots; hosted CI owns browser validation.
The existing 36,000-step heap regression retains its workload and thresholds.

## Derived rpm and virtual gears are presentation state (2026-09-21)

The engine note, and now the tachometer, need rpm and gears, but design 6.7.1 keeps a single automatic physical gear and the tuned acceleration and braking figures are the CTO's baseline. Decision: `src/vehicle/rpmModel.ts` computes rpm, virtual gears and monotonic shift counters at the end of `Vehicle.postStep` from speed, throttle and boost, and writes them to telemetry (`rpm`, `gear`, `gearCount`, `idleRpm`, `redlineRpm`, `upshiftCount`, `downshiftCount`). The drivetrain, controls and forces never read them. Engine identity is data in `src/vehicle/engineProfile.ts` (`DEFAULT_ENGINE`): idle, redline and boost rpm, gear count and spacing, shift thresholds, firing pattern and exhaust pipe constants, so another car is another profile consumed by the same model, worklet and gauge. Shape a tuner adjusts by ear is in the tuning schema instead: `engineCharacter`, `engineRevLift`, `exhaustLength`, `exhaustFeedback`, `firingUnevenness`, `engineLevel` (engine layer multiplier), `gearSpacing` (ratio between virtual gears) and `gearCount` (number of virtual gears). Gear spacing and count are presentation controls: the CTO tunes gearing by ear the way he tuned the voice, and the physical force model never reads them. Shift events are counters, not one-step flags, so a 30 Hz HUD misses none of them. The vehicle integration regressions (100 km/h in 2.2083 s, 55 m/s in 6.75 s, 72.399 m stop, seeded state hash) are the proof that the car drives exactly as before.

## 2026-09-22 — Five virtual gears and presentation-only gear count

On 2026-09-22 the CTO tuned the deployed audio by ear and supplied these new
defaults: `engineRevLift` 2800 rpm, `exhaustLength` 1.3 m,
`exhaustFeedback` 0.76, `firingUnevenness` 0.7, and `engineLevel` 1.45.
Ship those values verbatim. His `gearSpacing` export was 2.5, the slider
maximum, but that makes the upper gears unreachable; do not ship it. The
four-gear presentation was too sparse, so ship five derived virtual gears,
`firstGearSpeed` 12 m/s and `gearSpacing` 1.6. The thresholds are approximately
12, 19.2, 30.7 and 49.2 m/s, so fifth gear covers 49.2–60 m/s without boost
and remains useful through 85 m/s with boost. Expose `gearCount` in the Audio group as an integer 3–8
presentation slider alongside `gearSpacing`, `engineRevLift` and the other
audio controls. Both sliders are consumed only by `RpmModel`; the physical
drivetrain, acceleration and braking do not read them. Clamp the effective
spacing from `gearCount`, `firstGearSpeed` and top speed so every slider position
has a reachable top gear; the usable spacing range depends on gear count and
top speed and is derived rather than hard-coded. The existing integration baselines remain the guard:
2.2083 s to 100 km/h and 72.399 m braking distance.

## Phase A foundations for air and impact: quaternion statics, pooled bodies, surfaces by construction (2026-09-22)

Three adapter and world changes that both halves of the air-and-impact slice need (see `docs/slices/air-and-impact.md`).

- **Quaternion static bodies.** `IPhysicsWorld.createStaticBody(desc)` takes a unit quaternion, so a pitched ramp is one body rather than a staircase of yaw-only boxes that would be audible through the suspension. `createStaticBox` stays as a yaw wrapper; the two tests that pin the default track at 129 static bodies are untouched.
- **Pooled lifecycle.** `createPooledBox` creates a body at boot without adding it to the simulation; `activateBody` places it and adds it with zero velocity; `deactivateBody` removes it without destroying it. The WebAssembly heap regression asserts exact equality against a 60 second baseline, so runtime body creation or destruction would fail it outright; a unit test now cycles 64 pooled dynamic bodies in and out and asserts free bytes exactly equal after warm-up. `destroyBody` exists for scoped teardown only and is never used mid-session.
- **Pool budget.** `POOL_BUDGET` in `src/world/bodyPool.ts` reserves 32 breakables and 128 debris fragments at boot. Arithmetic: Jolt is initialised for 1024 bodies, the default track uses 130 (ground, 128 barriers, car), the pool adds 160 for 290, leaving about 700 spare. 128 debris is 16 smashed props with 8 fragments each alive at once; when exhausted the pool retires the oldest fragment and reuses it. These are starting numbers to argue with, and a denser smash route is a change to two constants.
- **Surfaces by construction.** The resolver used to be a closed snapshot of the ground and barriers; a body it did not know resolved to null and the tyre model skipped that wheel, so a ramp added without registration would have had suspension force and no grip, brakes or steering. Now one `SurfaceRegistry` is shared by the track resolver and a `SurfacedBodies` facade in the world layer, and the facade is the only way world code creates bodies: every creation registers its authored surface in the same call, pooled bodies register at boot so activation never touches the registry, and destroy unregisters. The adapter stays engine-facing and the rule that no Jolt type leaves `joltWorld.ts` holds. The resolver keeps returning null for an unknown body as defence in depth, with its diagnostic intact, because that is how a future regression would be noticed. A test installs a pitched ramp through the facade and asserts a wheel hit resolves to asphalt.

Not in this change: ramps in the layout, airborne state, the downforce fix, debris behaviour, scoring.

## 2026-09-22 — RPM ramp and independent firing-rate presentation controls

The CTO reported that the RPM note climbed too quickly within each gear while
also wanting the engine voice itself to sound slightly faster. These are
separate presentation axes. `rpmRampExponent` applies a power curve to the
normalized speed within the current virtual gear (default 1.4, range 0.6–2.5):
an exponent above one holds the note lower through most of the gear and steepens
near the shift. This changes the derived RPM/tachometer presentation, not the
physical drivetrain or acceleration. Widening gears would have changed shift
cadence and contradicted the settled five-gear feel, so it was rejected.

`firingRateScale` (default 1.15, range 0.5–2) independently scales the
AudioWorklet pulse train. It does not alter shared telemetry RPM, so the
tachometer remains truthful while the sound can be made slightly quicker. Both
controls are included in replay/example tuning headers; integration baselines
remain 2.2083 s to 100 km/h and 72.399 m braking distance.

## Phase B1 and B2: airborne state on telemetry, downforce gated on ground contact (2026-09-23)

- **Airborne state** (`src/vehicle/airState.ts`, written to telemetry after physics): `airborne` (no wheel grounded this step), `airTime` (seconds since every wheel left, 0 while grounded), `lastAirTime` (the most recent counted flight) and `landingCount`, a monotonic counter so a 30 Hz consumer polling 120 Hz physics misses no landing, the same contract as the gearbox shift counters and for the same reason: a one-step flag was the bug we already fixed once. A flight shorter than 0.1 s is a kerb hop: `airborne` still reports it, but it neither counts a landing nor updates `lastAirTime`. Presentation and scoring read this; forces never do.
- **Downforce** used to be applied along the body's down axis unconditionally, so an airborne car carried a body-relative force and an inverted one was pushed upward in world space. Nothing launched the car, so nobody saw it; ramps would have. Downforce is now zero when no wheel is grounded and unchanged otherwise, which keeps the flat-track acceleration and braking regressions and the determinism digest identical. Scaling it by grounded fraction on two or three wheels is a feel decision left for the CTO, not made here.

## Phase B3: air control, self-levelling as a default not a design (2026-09-23)

`src/vehicle/airControl.ts` gives the player pitch and roll authority once every wheel has been off the ground for the 0.1 s kerb-hop gate, fading in over a further 0.15 s; no yaw, handbrake inert. Three live tuning keys in a new Air group: `airControlAuthority` (target rotation rate at full input, default a quarter turn per second), `airDamping` (the flight damping that was a hardcoded 0.8 times inertia times rate whenever fewer than two wheels are grounded), and `airAutoLevel` (torque toward wheels-down when the player gives no input, default 0.5). The CTO is choosing between a forgiving default (self-levelling on) and a skilful one (off); the slider at zero is the skilful option, so his answer changes one number.

**Pitch reads the change in throttle since takeoff, not the raw pedal.** The arcade convention maps throttle to nose-up, but a player who holds full throttle through every jump for speed would then be pitching nose-high on every single jump, making the common case the worst landing attitude. Reading the difference from the throttle held at takeoff keeps a held pedal neutral: lifting off dips the nose, pressing beyond the takeoff level lifts it, brake always dips it. Roll reads steer, and steer left banks left. Reverting to raw throttle is a one-line change.

**The boundary cannot leak.** The vehicle passes airTime 0 whenever any wheel is grounded, and the tracker resets the clock on every touch, so a car skimming in and out of contact over a kerb never reaches the gate. A unit test drives the real tracker with three steps airborne and one grounded, repeated, and asserts zero authority and zero torque throughout; a real-Jolt test measures zero weight at the gate, a nose-down rate near a quarter turn per second under full brake, and an inverted hands-off launch landing wheels-down under the default self-levelling. The 12 rad/s angular clamp still bounds any flip. Flat-track regressions are unchanged because the fixtures never leave the ground for the gate duration.

## C1: one shared impact severity estimator (2026-09-23)

Stock Jolt reports contact impulse as null, so severity has to be estimated, and two consumers had grown their own estimate of the same closing speed: `src/input/haptics.ts` and `src/audio/director.ts`. The camera kick meanwhile was dead because it ignored the null impulse. `src/core/impactSeverity.ts` is now the one definition: `estimateImpactSeverity(impulse, relativeVelocity, normalIntoVehicle, massKg, out)` writes `approachSpeed` (m/s along the normal into the vehicle, 0 when separating), `energy` (joules), `severity` (canonical 0..1: 0 at 0.8 m/s, 1 at 18.8 m/s, the audio curve that already sounded right) and `estimated` (true unless an engine supplied an impulse, in which case approach speed is the velocity change it implies). Boot estimates once per contact and hands the same record to camera, haptics and audio. A landing and a prop smash are the same call: pre-step velocity relative to the other body and the contact normal. Haptics keeps its own actuator response curve from `approachSpeed`, which is a response, not a definition. Phase C scoring and Codex's breakable props consume this record and invent no second shape.

## 2026-09-22 — Six-gear audio profile and deliberate redline cruise

The CTO's 2026-09-22 upload changed exactly six Audio values, tuned by ear on
the deployed build: `engineCharacter` 0.75, `engineRevLift` 1850,
`rpmRampExponent` 1.2, `firingUnevenness` 1, `engineLevel` 2, and
`gearCount` 6. Every other tuning value remains unchanged, including
`gearSpacing` 1.6. The engine-level ceiling is raised to 3 so the uploaded 2.0
value is not a range endpoint.

The existing `GEAR_TOP_SPEED_HEADROOM` value of 0.97 and its cap based on
unboosted top speed are intentional design behavior. The top speed and the top
virtual gear are deliberately boost-only; without boost, cruising sits pinned
near redline so the racer sounds like it is working hard. A six-gear profile at
`gearSpacing` 1.6 is therefore allowed to use the effective capped ratio while
the slider continues to show the uploaded value. This near-redline unboosted
cruise is intent, not a stranded-gear bug, and the ladder must not be widened to
make it quieter. The physical drivetrain, acceleration and braking remain
unchanged; the integration guards remain 2.2083 s to 100 km/h and 72.399 m
braking distance.

## Phase B4: a landing is an impact (2026-09-23)

When the airborne tracker counts a landing, the vehicle runs the shared estimator (`src/core/impactSeverity.ts`) on the pre-step velocity against the first grounded wheel's contact normal and publishes `landingSpeed` and `landingSeverity` on telemetry, keeping the full record on `vehicle.landingImpact`. Boot watches the monotonic `landingCount` once per step and hands that record to the same three consumers a wall hit uses: camera kick, controller rumble and the audio crunch on the landing surface's profile. No second severity shape, no separate landing-feel code path; phase C scoring reads the same numbers. Kerb hops below the 0.1 s threshold are not landings and produce nothing.

## Phase B5: ramps as data through the surfaced facade (2026-09-23)

`src/world/ramps.ts` authors ramps as data (`RAMP_LAYOUT`: low-edge position, heading, length, width, rise) and derives one pitched static box per ramp from that record, used by both the collider and the mesh so the two cannot disagree. Ramps install through `SurfacedBodies`, which registers their asphalt surface in the same call that creates the body; the unit test shows the trap this avoids by creating the same descriptor straight through the adapter and watching the resolver return null. Two ramps sit at 120 m radius, six to ten metres inside the 127 to 130 m line the example scripts follow, launching along the ring and turned 15 degrees inward so no jump can clear the 152 m barrier and drop past the kill plane. Because they are installed from boot rather than `installTrackColliders`, the two tests pinning the default track at 129 static bodies and the three replay fixtures are unchanged; the trade is that the script harness does not know about ramps, so `tests/integration/ramp-clearance.integration.ts` replays every example against the ramp footprints (the pattern from the prop clearance test) and `ramp-jump.integration.ts` drives the car up a ramp on real Jolt, asserting every ramp contact resolves to asphalt with load, a counted landing follows, and speed survives it.

## Phase C2: light dynamic breakables preserve smash-through feel (2026-09-22)

A real Jolt comparison showed the original static pooled prop stopping a 1300 kg car from 30 m/s to 0 with a 0.22 m/s rebound; releasing it after the contact callback did not change that response because the immovable collision was solved inside the step. Breakables therefore use pooled dynamic 15 kg bodies with friction 0.6, restitution 0.2, angular damping 0.1 and CCD off. The deferred contact ring and single shared `ImpactSeverity` record remain unchanged, so body mutation stays outside `world.Step`. Contacts below 3 m/s nudge the light prop without breaking it; break fragments inherit the forward component of the copied vehicle velocity so the destruction reads ahead of the car. A sensor was rejected because it would require new adapter support and make destruction feel weightless.

## Smash-through is guarded on the real engine (2026-09-22)

The fake-pool unit tests for breakables cannot see the defect the CTO found (a static prop stops the car dead inside the step, whatever happens after it), so `tests/integration/prop-smash-through.integration.ts` drives a car-sized box at one authored prop through the real pool, facade and breakable lifecycle on Jolt, wired the way boot wires them. It asserts under 1 m/s lost through a prop at 30 m/s with all eight fragments spawned, and that a 2.5 m/s nudge shoves the intact box over a metre while costing under 0.5 m/s. Measured on merge: 0.44 and 0.23 m/s. The same investigation recorded a rule in `IPhysicsWorld.onContact`: never call a world method from inside the contact callback, because a getter takes a body lock the solver holds and hangs single-threaded WASM with no error.

## Physics capacity is large; simultaneous contacts are the content budget (2026-09-23)

The Jolt world now reserves 8192 bodies, 32768 body pairs and 16384 contact constraints, with zero worker threads. A fresh-process sweep measured about 12.84 MiB of allocator use at the old 1024/4096/2048 settings and 20.41 MiB at the new ceiling, inside the fixed 128 MiB WASM heap; startup stayed around 0.4–0.55 seconds. Dormant bodies are cheap: 1000 dormant pooled bodies stepped at about 0.05 ms. Awake collision work is the real frame budget: 100 awake colliding boxes cost 18.6 ms per step and 500 cost 163 ms, while 1000 separated awake movers cost about 6 ms. A map may hold thousands of dormant props, but content must avoid arranging for a hundred bodies to be awake and colliding at once. Zero workers is deliberate because the GitHub Pages build has no cross-origin isolation, so this single-thread WASM build cannot use browser worker threads.

## Two smash gates use the expanded pooled budget (2026-09-23)

The crash route now adds two eight-panel gates: six bumper/hood-height slats and two edge pylons per gate, all using the same light dynamic breakable rule as the infield boxes. The pool grows from 32 to 48 breakables and from 128 to 192 debris fragments. With 130 base track bodies, four ramps and 48 loop slabs, the boot reservation is 422 bodies of Jolt's 8192-body capacity, leaving about 7770 spare. The two-gate limit is deliberate: frame cost is measured before adding a third, and each gate keeps a clear bypass and the scripted racing line remains a regression path.

## The loop-de-loop is a helix, as data through the facade (2026-09-23)

`src/world/loopDeLoop.ts` authors the loop as data (entry point, heading, radius, lane width, sideways shift, segment count) and derives one pitched slab per segment for both collider and mesh, installed through `SurfacedBodies` so every slab registers asphalt. A planar loop is geometrically impossible: its descending arc comes down onto the entry lane, so the car drives into its underside, which the first test build did. Real loops are helices, and so is this one: the lane slides one lane width plus clearance toward the car's right over the turn (inward on the counter-clockwise ring), the exit lane lies beside the entry lane, and the driver steers a few degrees to follow it, which is truthful physics rather than a rail. The measured assessment that preceded it (real Jolt, spawned inverted on the arc) showed the stock car rides an inverted curved surface with three to four wheels grounded, downforce pressing it into the track; the only system that fought it was the roll-righting assist, fixed separately by measuring roll against the ground under the car. It sits in the north-west quadrant, the one no ramp lands in and no prop bank occupies, with the entry lane centre at 108 m radius so the example routes clear the whole footprint by over eight metres; a clearance test guards that, and a real-Jolt test sweeps entry speeds on the same slab generator without the slide to record the honest minimum. Measured floors on real Jolt for the 10 m loop: coasting (throttle off) it needs 30 m/s at the entry and fails at 27; with the throttle held the engine drives it round from as little as 14 m/s, because the car keeps traction on the inverted surface. Boost is never required; it is a commitment, not a key.

## Roll-righting is measured against the ground under the car (2026-09-23)

The roll-righting assist exists to rescue a car flipped on the ground. It measured "flipped" as roll against world up, a proxy that only worked while the world was flat: measured on real Jolt, a car riding a loop upside down had the assist applying its full torque about the forward axis the whole way round (1 rad/s of roll rate and a quarter metre of lateral drift on an 8 m loop, exactly zero with the assist off), and a banked wall would read the same. Roll is now measured against the mean contact normal of the grounded wheels, falling back to world up when no wheel touches (a car on its roof has no wheel contact), so a loop or a bank never triggers it and a flipped car on flat ground still rights itself. The assist never fires on flat track, so the acceleration and braking regressions are unchanged; `tests/integration/roll-righting.integration.ts` asserts both the silent loop ride and the working rescue. This is a correction of a condition that was always wrong, not a tuning change.

## The camera rides the track, swings round in reverse, and always sees the car (2026-09-23)

The CTO's loop drive exposed two camera defects, measured with the real rig on real trajectories: reversing at 12 m/s the direction jumped more than 20 degrees on 13 frames in six seconds (a full 180 in one frame) and the camera sat behind the nose showing where he came from; riding the 10 m loop the camera was outside the tube on 43 of 99 arc frames with the structure blocking the line of sight to the car on 41. One cause: the rig assumed a flat world, following the flattened nose direction, hanging off the car by world up, and blending toward the travel direction with an angle wrap that flips when travel is exactly backwards.

Three changes in `src/render/cameraRig.ts`, every one gated on conditions ordinary forward driving never meets, and `tests/integration/camera-identity.integration.ts` pins the camera path over the ring-lap and handbrake fixtures to the bit as proof. (1) The direction is rate-limited on the shortest arc, 720 degrees per second normally and 180 while swinging, so a flip is impossible and every ordinary frame copies the target exactly. (2) After a third of a second of sustained reversing the camera swings round to the front and looks back along the reversing path (`camReverseSwing`, default 1, the CTO's "backup should be cinematic"; zero keeps it behind the nose). The hold is load-bearing: a reverse blip after a crash never throws the view around. (3) The camera's sense of up blends toward the ground normal once the ground tilts past 20 degrees (`camTrackFollow`, default 1, zero is a world-up camera), holds while airborne and eases back over half a second after landing, so it rides inside a loop behind the car; and a line-of-sight rule pulls the camera in to just short of any static geometry between it and the car, quickly in and slowly out, using the adapter ray cast with the car's body ignored. That rule is correctness, not a slider. Distance, height, follow time, shake, roll, field of view and the presets are untouched.

## Large maps distribute contacts, not just bodies (2026-09-23)

The ten-times-larger map is delivered before redistributing crash content so the
CTO can line up long straightaways and isolate loop behavior. Content then scales
by spreading encounter cells rather than clustering every breakable in one place:
start with 192 scenery breakables and six gates, each gate isolated on a long
straight or loop approach with a clear bypass. The pool may hold more dormant
bodies because the 8192-body reservation is cheap; the runtime protection is the
contact layout. An authored cell must contain no more than roughly 24–32 bodies
that can be awake and touching at once, and adjacent cells must be separated far
enough that a car at 80 m/s cannot pull both into one contact island. This is the
content rule that preserves frame rate; a hundred simultaneous colliding bodies
already measured at about 18.6 ms per step, while dormant bodies were effectively
free.

The first proving-ground population applies the rule: 144 scenery records in
twelve 12-prop cells plus six eight-piece gates, 192 records total, promoted
through the existing 220 m / 300 m hysteresis. A clean production build and
300-second perf run measured a 0.2435 ms average and 0.9 ms p99 manual physics
step, with 0.00% WASM allocator growth; retained JS heap rose 4.88%. The
population is broad in authored space while each encounter stays local, and
this measured frame cost is the evidence for the phase rather than an
assumption about dormant body count.

The route-variety pass keeps the same 192 records and promotion hysteresis but
changes the encounter mix: six widened scatter cells sit beside the long
approaches, six tighter clusters reward a committed line, and the six existing
gates remain the tall, high-visibility targets. No runway or target corridor is
occupied, and the placement invariants still keep every cell under 20 m across
and over 80 m from its neighbours. The same perf harness measured 0.3806 ms
average and 1.4 ms p99 manual physics (under the 2 ms gate) with unchanged
allocator capacity; the increase is recorded rather than hidden behind a
different benchmark.

## The proving ground is the default map; the lab ring stays as a named test world (2026-09-23)

The CTO could not test ramps and loops because the 150 m ring gives no room to line up a run at speed. `src/world/maps.ts` now names two worlds as data. The lab is the ring exactly as it was, and `tests/scriptVehicleHarness.ts`, every replay fixture, the e2e build (`VITE_DEFAULT_MAP=lab` in `playwright.config.ts`) and `?map=lab` in the browser keep using it; no fixture was regenerated. The proving ground is the same parametric ring at three times the radius (400 m centre line, 340 to 460 m pavement, 384 barrier boxes of the same 7.7 m length, ground collider scaled with them by `createGroundDescriptor`, 1500 m visual ground, fog at 0.0008) and is what boot loads by default. The design is the approach, not the area: the car spawns at the south end of a 700 m painted runway facing north, reaches top speed in about 250 m, and 380 m ahead on one target line sit the giant ramp on the runway's centre (40 m, 16 m wide, 9 m lip), the lab's 10 m loop unchanged to the west and an 18 m loop to the east on their own branch lanes, so the two loops are compared from the same spawn at the same speed; Respawn returns the car to the same line. Runways are paint (`src/world/runways.ts`, one instanced draw) on the infield's existing asphalt collider, not bodies. The four lab ramps sit on the ring at the diagonals, turned 45 degrees inward instead of 15 because at 60 m/s and above a 15 degree launch from a 365 m radius would clear the 470 m barrier. `tests/maps.test.ts` guards the lanes: nothing but its end target may stand within 5 m of a runway, including the props and gates that still sit at their lab coordinates until they are re-placed. `tests/integration/proving-ground.integration.ts` measures the giant ramp landing at 60 and 85 m/s against the barrier, the east loop's entry-speed floor, and the example routes' clearance of every structure. The camera rig is untouched. Props and gates move in a following change by their owner.

## The proving ground merged past a red perf gate, on evidence, by the PM's decision (2026-09-23)

`npm run perf` gates on the manual physics step's p99 under 2 ms. Five runs on the only host available, all with a load average between 9 and 23 on 8 cores from other agents: lab build 1.9 ms (pass) then 2.7 ms (fail); proving ground build 2.5, 2.7 and 2.9 ms (fail), the last back to back with the failing lab run. The control fails: the unchanged lab build misses the same gate by the same margin, and identical code moves 0.8 ms of p99 between runs, so the instrument was measuring the machine that day, not the change. An interleaved Node A/B with both worlds installed on the real engine (three rounds, 3000 steps each) put the map's cost at hundredths of a millisecond per step (lab 0.19 to 0.23 ms mean, proving ground 0.22 to 0.23). On that evidence the PM decided to merge PR 109 and took responsibility for the call, with two conditions: this record, so that anyone finding a red gate merged later sees a reasoned override rather than a gate people learned to ignore; and the CTO watching his own frame counter when he drives the new map, which is better evidence than this box can produce. If he sees a drop, this is revisited immediately. Merging past a red gate is not routine; the next one needs its own control run and its own record.

**Retired the same day.** After the host was cleaned up (stale emulators and a leaked test runner killed), the gate passed cleanly on both builds: proving ground p99 1.8 ms and lab 1.5 ms against the 2.0 limit. The gate was working, the loaded machine was lying, and the change never cost anything measurable. The entry stays as the record of what was known and decided at the time.

## The east loop is forgiving by geometry; grip is a slider, not a fix (2026-09-23)

The CTO's loop complaint, in his words: "I can do a full loop but only if I'm dead on and good speed. It should be more forgiving." Measured with a plain lane-following test driver on the real engine (`tests/integration/loop-forgiveness.integration.ts`), the 10 m lab loop at 40 m/s tolerates 0 degrees of entry angle and 0 m of offset, completes only between 36 and 44 m/s (faster also falls), and no steering kick or off-centre line survives. The cause is in the wheel data, not the steering: on a perfect line the tyres are at grip usage 1.07 with wheel loads 18 to 26 times static and load sensitivity cutting friction to about 0.9, so the steering the driver has (10 degrees of lock at 40 m/s, 4 to 7 needed) cannot be spent. The 18 m loop changes that by itself: loads of 13 to 17 times static, grip usage 0.25 on the line, and with the same driver it takes 30 degrees of entry angle, 10 m of offset, completes from 16 m/s to 60 with no upper failure, survives a quarter-second steering kick of 0.8 of full lock and a line 5 m off centre. The proving ground's east loop ships as the forgiving one, the west loop untouched as the control: a 20 m lane, 3 m shoulders banked 12 degrees (kick 0.9, ride tolerance held; 30 degree shoulders launched the chassis, and the helix shift grew to 27 m so the descending exit clears the entry's shoulder), and its own surface (`stickyAsphalt`, id 3) whose grip the new `loopGrip` slider scales. The slider defaults to 1: a sweep from 0.8 to 1.5 moved neither the kick nor the ride tolerance in a consistent direction, so the CTO's "sticky surface" guess is not supported by measurement and the slider exists so he can feel that himself. No assistance steers for the player. Radius is the lever.

## The loop rule: 14 m is the minimum fair radius, 18 m is forgiving, nothing smaller is authored (2026-09-23)

The CTO drove both loops and said the blue one is "so great" and the small one "almost impossible, it's too small or not grippy enough", then "the blue large loop you have is so good, that's probably the realistic minimum size". Measured with the same lane-following test driver at every size (`tests/integration/loop-forgiveness.integration.ts`, real engine, plain 14 m lane unless stated; entry angle and offset are the widest that still complete, kick is the fraction of full steering lock held for a quarter second on the wall, speeds are the completing entry speeds from 24 to 60 m/s):

| radius                                                                                                | entry angle | offset   | kick        | off-centre ride | speeds        | grip usage on a perfect line | wheel load, times static |
| ----------------------------------------------------------------------------------------------------- | ----------- | -------- | ----------- | --------------- | ------------- | ---------------------------- | ------------------------ |
| 10 m (lab loop, 12 m lane)                                                                            | 0 deg       | 0 m      | none        | none            | 36 to 44 only | 1.07                         | 18 to 26                 |
| 10 m with sticky surface at 1.3, 1.6, 2.0                                                             | 0 deg       | 0 m      | 0.2 or none | 2 m or none     | scattered     | 1.07                         | 20 to 22                 |
| 10 m at any facet size (1.3 or 0.65 m), lane 12, 14 or 20, with or without shoulders, at 40 or 50 m/s | 0 deg       | 0 m      | none        | none            | scattered     | 1.07                         | 18 to 28                 |
| 12 m                                                                                                  | 0 deg       | 0 m      | 0.6         | none            | 24 to 60      | 1.07                         | 18                       |
| **14 m**                                                                                              | **10 deg**  | **2 m**  | **0.8**     | 1 m             | **24 to 60**  | 0.64                         | 16                       |
| 16 m                                                                                                  | 15 deg      | 2 m      | 0.8         | 4 m             | 24 to 60      | 0.55                         | 15                       |
| **18 m (east loop, 20 m lane, shoulders)**                                                            | **30 deg**  | **10 m** | **0.9**     | 4 m             | **16 to 60**  | 0.55                         | 15 to 17                 |

A second sweep (radius 10 to 22 at 40 and 50 m/s, lane 14 and 20, with and without shoulders, facets of 1.3 and 0.65 m) confirmed the floor and added a second lever. Facet size changes nothing: a 10 m loop with 0.65 m facets is as unfair as with 1.3 m. Lane width is not free: the exit lane must clear the entry lane, so the helix shift grows with the lane (shift >= width + 2 x shoulder + 1 m), and shift costs grip. At the same radius a 14 m lane with 15 m of shift rides at grip usage 0.3, while a 20 m lane with 27 m of shift rides at 1.07 and fails, because the car is fighting a 17 degree skew all the way round. The reason is mechanical, not a preference: to follow a lane that slides sideways the car holds a constant sideways component all the way round, paid for out of the same grip budget it needs to correct its line, on tyres already carrying 13 to 17 times their static load. The skew shift / (2 pi R) therefore stays at or below 0.25 (`MAX_LOOP_SKEW`, about 13 degrees): the east loop's 27 m at 18 m radius is 0.24 and rides at 0.55, and that it sat inside the bound was luck until the guard made it a property. A wider lane needs a bigger radius to pay for it. The 10 m radius is closed as a question: it fails at every facet size, lane width, shoulder and speed tested, with or without extra grip; nobody needs to test it again. Tolerances also move with entry speed: the 14 m loop takes 20 degrees and 10 m at 40 m/s and 15 degrees and 2 m at 50, so the table's single numbers are the conservative end.

Below 14 m a loop is unfair rather than hard: the tyres sit past their grip limit on a perfect line, so a perfect entry at the wrong speed still falls, and no surface we can author changes that (grip 1.3 to 2.0 on the 10 m loop left every tolerance at zero; on the 18 m loop a 0.8 to 1.5 sweep moved nothing consistently). At 14 m a loop is fair: it reads as a challenge, not as broken. At 18 m it is forgiving. The rule, held by `MIN_FAIR_LOOP_RADIUS` and `FORGIVING_LOOP_RADIUS` in `src/world/loopDeLoop.ts` and guarded in `tests/maps.test.ts`: no authored loop goes below 14 m; a loop meant to be fun rather than a test starts at 18 m. When the map editor arrives this table is what stops a beautiful tight loop that nobody can finish. Product decisions by the PM: the west loop becomes the hard loop at 14 m rather than being retired, so size still varies while staying fair; the 10 m loop stays on the lab ring as the control; both proving-ground loops carry the tinted surface with `loopGrip` neutral at 1.0 and a range widened to 0.2 to 8 on purpose, so the CTO, who suggested stickiness twice, can push it until it obviously helps or obviously does not and settle that with his own hands rather than on our word.

Re-verified at gravity 20 on 2026-09-23: the R14 fair minimum, R18 forgiving radius and R10 unfair control remain true; the authored tolerance and peak-load measurements stay within the rule above.

## Phase-one world streaming and the fixed physics heap (2026-09-23)

The Jolt build declares a fixed 2048-page memory with both initial and maximum
set to 2048: 128 MiB is a real WASM limit, not a JavaScript setting or a budget
we can grow at runtime. Changing it requires publishing a different Jolt build;
the browser application has no supported lever to resize it. The 8192-body world
ceiling remains separate from this heap decision.

The capacity probe measured 19,000 inactive pooled bodies at 41,128,320 bytes
used and roughly 0.14--0.17 ms per step; 24,000 inactive bodies used
48,450,592 bytes and measured about 0.13 ms. Active but separated static bodies
measured about 0.43 ms at 19,000 and 0.57 ms at 24,000. The dynamic 19,000-body
probe was inconclusive after exceeding its measurement window, so phase one does
not claim that a resident dynamic world at that scale is safe.

Phase one proves streaming against the existing authored records. One
`PropStreamRecord` is both the authored map record and the runtime stream record:
it has a stable object id, cell id, pose and placement index. Far records use one
instanced visual; records inside a 220 m promotion radius use the preallocated
breakable pool, and demotion waits until 300 m. The hysteresis is deliberately
small and reviewable before phase two scales the data toward 19,000 records.
Destroyed ids stay destroyed across promotion boundaries. A live body is never
demoted while its current physics pose remains near the car, which prevents a
car resting on a body from falling through an unloaded region. Reset is the
explicit session boundary that clears destroyed state; streaming alone never
resurrects content.

The 192/768 phase-one reservation is sized for the planned first content pass,
while the current authored map promotes only its nearby subset. This is a
runtime-content rule rather than a claim that thousands of awake contacts are
safe: no authored cell should arrange more than roughly 24--32 touching bodies,
and adjacent cells must remain separated enough that an 80 m/s car cannot pull
two contact islands together. The authored and streamed records intentionally
share one format so the future editor writes exactly what runtime consumes;
there is no second export format to drift from the game.

## Ramps are triangles where a run should repeat (2026-09-23)

The CTO: "make the ramp triangle shaped so we can go up it both directions and don't have to circle all the way back around." `RampSpec.symmetric` adds a mirrored back face whose low edge lies two lengths along the heading (less a thickness of pitch, so the two top surfaces meet at one ridge); collider and mesh come from the same two descriptors, and `rampFootprint` covers both faces. The giant ramp on the main runway is a triangle: northbound it lands at z 200 from 60 m/s and 294 at boost, southbound at z -39 and -136, on the main runway 200 m short of the spawn, so a run is throttle, ramp, turn, throttle, ramp. The four ring ramps stay one-way on purpose: they launch 45 degrees inward, and a back face would launch 45 degrees outward, which at 60 m/s lands at 520 m radius, past the 470 m barrier and off the ground collider. A primitive that can be driven both ways must have both landing corridors measured, not one.

## A known CI flake in the deployment tooling tests (2026-09-23)

`test_pages.LifecycleTests.test_real_git_open_update_close_keeps_live_root_identical` errored once on PR 112 in its `TemporaryDirectory` teardown with `OSError: [Errno 39] Directory not empty: 'objects'`: the bare git fixture's background maintenance races the cleanup. Every other tooling test passed and the PR touched no tooling; the rerun passed and the PR merged on the clean run. The tooling's original owner is gone, so if it happens again the fix is ours and it is small (ignore cleanup errors on that tempdir, or run the fixture's git with `gc.auto=0`), in its own PR, before anything merges behind it. A check failing on something the PR does not touch is evidence about the check, and the answer is to fix the check, not to merge past it twice.

## The half-pipe rule: a 30 degree spine, depth from radius, range from speed (2026-09-23)

The CTO: "add large half-pipe, so a car could drive up one and jump over to another half-pipe like a skateboard would." Measured before building on the real engine with two facing quarter-pipe walls (`tests/integration/half-pipe.integration.ts` carries the authored version), the first finding reframes the piece: our world runs 1.5 g and the car arrives at 40 to 60 m/s, so a skate-style steep wall is a cannon. A 65 to 80 degree exit threw the car 50 to 110 m into the air for 4 to 5 seconds and landed it at 30 to 40 m/s, twice the giant ramp's landing (19 to 20 m/s at every speed, the yardstick for a landing he already accepts). Exit angle is the coupling: it sets the range and the landing violence together, because both follow the vertical component of the launch.

| exit angle   | landing impact m/s | apex at 40 m/s launch | notes                                    |
| ------------ | ------------------ | --------------------- | ---------------------------------------- |
| 20 deg       | 2 to 12            | 10 m                  | very flat; range short                   |
| **30 deg**   | **4 to 11**        | 23 m                  | softer than the ramp at every speed      |
| 40 deg       | 25 to 32           | 36 m                  | harder than anything shipped             |
| 50 deg       | 26 to 41           | 52 m                  |                                          |
| 65 to 80 deg | 30 to 40           | 50 to 110 m           | 4 to 5 s hang; spectacle you cannot land |

Second: depth comes from radius, not steepness. Wall height at a 30 degree lip is 0.134 R: 3.2 m at 24 m radius, 5.4 m at 40, 7.5 m at 56, with range and landing unchanged by radius. The obvious way to look deep, the same arc continuing above the lip as picture, is a trap: the launch is tangent to the circle, and the rest of the arc curves back over the car's path, so solid it is a wall a car-length after takeoff and visual-only he flies through the picture. Third: full throttle up a 20 m wall adds 8 to 10 m/s, so the gap is sized to the launch speed, not the approach: range is launch speed squared x sin 60 / g, about v^2 / 17, so 30 m/s carries 53 m, 40 carries 94. Fourth, as with loops, transition load is v^2 / R: 40 m radius peaks at 19 to 21 times static, inside the loop's fair region.

The rule, held in `src/world/halfPipe.ts` (`HALF_PIPE_EXIT_ANGLE`, `MIN_HALF_PIPE_RADIUS` 16, `DEEP_HALF_PIPE_RADIUS` 40) and guarded in `tests/maps.test.ts`: the exit is 30 degrees and nothing above it is built, even as picture; radius at least 16 m for load and 40 m for a wall that reads as a pipe; a solid deck under the gap so an undershoot is a landing; the gap sized to v^2 / 17 at the design launch speed; flat ground beyond the far wall so an overshoot lands soft. Because the world is one ground slab and cannot be trenched, the primitive is an honest SPINE: quarter-pipe up, deck, quarter-pipe down, open at ground level both ends and so drivable from either direction. The authored one sits on the cross runway (deck centre x -150, 40 m radius, 45 m deck, 16 m lane, coping rails), approached at 20 to 30 m/s, where it lands in the far pipe at 15 to 23 m/s (the giant ramp lands at 19 to 22); at runway speed the car flies over the whole 85 m structure and lands 155 m beyond it at 33 m/s, upright, a hard landing and a miss nobody misreads. The trade the PM was given: 20 degrees would land the miss at ramp level but cut the wall to 2.4 m at 40 m radius; 30 degrees keeps the pipe that looks like one and makes ignoring the chevrons cost a hard landing. The PM chose 30 degrees: the window lands at the yardstick he already drives happily, and with no damage model a 33 m/s landing is a camera kick and a bang, spectacle rather than failure. If damage or scoring ever arrives, 33 m/s landings are the first thing to revisit, because then they stop being free.

A lesson beside the numbers: the measurement rig read relative effects correctly (which angle lands harder, which radius loads more, that grip does not widen a loop) and was wrong about absolute landing values at low angles. Every comparative conclusion stood; the one absolute claim made from it did not survive a check against the physics, and that check is what saved the recipe rather than invalidating it. Sanity-check a rig's absolute numbers against a back-of-envelope before quoting them, however right it has been about comparisons. Braking chevrons, the runway crossbars tightening from 50 m apart to 10 m over the last 100 m before each wall, carry the speed cue in the road language every driver already reads. The 70 degree stunt wall is not built; the PM is putting it to the CTO as spectacle he cannot land, and five seconds of airborne camera hold is untested if he wants it.

## Gravity retune to 20 m/s² (2026-09-23)

The CTO chose `gravity = 20` on the deployed build after driving the live slider. This is a deliberate tuning change, not a regression accepted by widening a test: the prior default was 14.7 m/s², and the old flat-plane baselines were 2.208333 s to 100 km/h and 72.3990479 m from the 60 m/s braking approach. At the new default, the same real-Jolt integration measures 2.208333 s to 100 km/h and 71.3531494 m to the first forward stop. The old and new values remain together so future changes can distinguish a gravity retune from an accidental force-model drift.

Gravity is coupled to every load-dependent behavior. Higher gravity increases tire load and therefore available grip, shortens airtime and jump range, and raises transition loads. The loop radius/fairness table, ramp flight distances, the old spine recipe and the new ground-level U measurements are therefore gravity-sensitive and must not be quoted as current defaults without a fresh probe. Pure geometry rules such as runway clearance, lane layout, and the fact that the U and spine use opposite radius strategies remain independent of gravity; their speed windows and load figures do not. The U is being remeasured after this retune before its recipe is finalized.

The gravity-20 replay rebaseline also records the route-sensitive expectations that changed with the deliberate retune: the camera identity golden was regenerated, ring-lap clearance floors measure 0.3 m from the lab loop, 2.5 m from the proving-ground structures, and 1.1 m from the authored ramps, while standing-start and handbrake-turn retain the original 5 m floor. The giant-ramp airtime floor is now 1.5 s (measured 1.6083 s). These are deterministic path and flight changes from gravity 20, not loosened physics tolerances; the tests still fail if a route moves closer than its current measured margin or a jump falls short of its new floor.

## Ground-level U half-pipe parked after gravity-20 probing (2026-09-23)

The requested skateboard-style feature is a concave U with its floor at world ground, longitudinal walls curving up at both edges, coping and a long open deck. The earlier spine was the wrong shape: a convex quarter-pipe/deck/quarter-pipe made an n rather than a pipe. The measured alternatives were also closed without shipping them: shallow 30-degree walls escaped laterally; steep walls at radius 40 were not climbable because the height grew with the radius; widening the floor from 16 to 40 metres did not restore a repeatable back-and-forth rhythm. The U and spine therefore use opposite radius strategies: a spine needs a large radius to make a tall wall from a shallow lip, while a U needs a small radius so a near-vertical lip remains reachable.

The resulting candidate was R4–R6 with a near-vertical lip, with R5, a 40 m floor and a long deck as the parked recipe. At gravity 20, however, the real-Jolt probes did not establish climbability or a return transfer: the straight-line harness never reached a wall, and controlled lateral-entry probes at 16, 20, 24 and 30 m/s reached only baseline vehicle height and never became airborne. Consequently there is no validated transfer window or peak transition-load figure for the U at gravity 20, and no U geometry is shipped. The candidate remains parked for a fresh measurement design rather than being represented as a tested feature.

## The aquifer channel rule: tall ride-along U, not a launcher (2026-09-24)

The CTO clarified the requested half-pipe as “like driving through an aquifer”: a long, visible channel with a flat floor at world ground and curved walls on both sides. The old 5.4 m spine was retired because it was hard to find and was the wrong convex shape. The shipped recipe is a 16 m transition radius with an 85 degree lip, a 60 m flat floor, and a 280 m open length on the cross runway. The original slab collider was a staircase and did not validate the ride. After replacing it with a 0.2 m maximum arc segment, the real-Jolt ride-along probe contains the roughly 15 m wall ride at 40–50 m/s, with 8.97–10.15 times static wheel load; at 60 m/s the car launches laterally beyond the channel (128–147 m across), so 60 m/s is outside the honest ride window. The 60 m floor contains the 40–50 m/s ride; 40 m was too narrow.

This is a sustained wall-ride feature, not a promise of a skate-style launcher. The separate launch-and-return sweep found no reliable return for a 15 m wall: R16–R18 launch outside the channel, while only R22–R25 returned marginally at one speed and imposed roughly 34–54 times static load. The channel rule therefore promises a tall, ridable aquifer and explicitly does not promise a repeated airborne transfer. The old spine and the new U use opposite radius strategies: a shallow spine needs a large radius to make a tall wall, while a near-vertical U needs a small radius so its wall remains climbable.

## Pipe-to-pipe transfer is closed (2026-09-24)

The final transfer question was measured with two parallel real-Jolt aquifers at
gravity 20. With the shipped R16/85-degree walls and 60 m floors, physically
distinct channels begin at 92 m centre separation (zero lip gap). Separations
of 92, 96, 104, 112 and 120 m were swept at 32, 40, 48, 56 and 60 m/s, with
steering toward the neighboring channel. Every airborne case landed short of the
neighboring channel; none landed long or inverted. Peak transition load was
5.3 to 10.2 times static wheel load. A narrower 40 m floor was also tested at
zero through 28 m lip gaps and remained short, so spacing alone does not create
a usable human transfer window. Launch-and-return into the same pipe is likewise
not reliable at the 15 m wall scale. The aquifer is therefore a ride-along wall
feature, full stop; pipe-to-pipe transfer is not a supported mechanic and should
not be re-opened by adding more spacing.

## Phase-two active promotion cap (2026-09-24)

The 19,000-record phase-two probe separates authored density from awake physics.
With dynamic 15 kg boxes in real Jolt, separated active bodies measured below the
2 ms p99 gate through 128 bodies (1.70 ms p99); 192 bodies reached 3.05 ms p99.
Dense touching clusters exceeded the budget much earlier: 32 bodies reached
7.18 ms p99 and 64 reached 16.82 ms. Separated bodies are cheap; dense touching
contact islands are what break the frame budget, not the total object count. The
runtime therefore caps active breakable promotions at 128 while reserving 192
pool bodies for lifecycle headroom. This cap does not make dense contact cells
safe: the existing content rule remains roughly 24--32 touching bodies per cell,
with enough separation that an 80 m/s car cannot merge two contact islands.

## Phase-two content ceiling (2026-09-24)

The final transition-queue implementation was measured with the official sustained performance gate (300-second minimum, two complete replays, manual `stepMany` physics p99, 2 ms limit). The largest passing population is **256 breakable records**: 0.5367 ms average and 1.9000 ms p99, with 0.00% WASM allocator growth. This population contains the authored route variety (scatter cells, clusters and six gates) plus 64 deterministic far-field records; runway and target corridors remain clear.

The next bisection point, 512 records, failed the same official gate at 0.6428 ms average and 2.5000 ms p99. The requested 19,000 records also fit the fixed heap without allocator growth, but failed at 0.5464 ms average and 3.2000 ms p99; the failure is CPU work, not memory capacity. The shortened smoke runs were not used to set this ceiling.

Going higher requires a spatial or level-of-detail path that avoids touching the full far-field candidate/visual set every physics update; further threshold tuning of the current scan is not enough.

## Ground depth-stability guard (2026-09-24)

Nine merges shipped today with all five required checks green, yet the CTO
found the aquifer's jumping ground texture in the first minute of driving.
The cause was a coplanar asphalt floor, a class of defect that ordinary unit,
reachability, bundle, integration, and preview checks cannot see. The map
tests now reject authored horizontal asphalt bodies whose top is within 1 cm of
the track ground plane. This catches duplicate floors, plazas, and aprons
without screenshot goldens or a render-maintenance tax; the existing track
ground remains the aquifer floor. The mini-map PR also moved hidden-HUD work
behind its visibility gate, so collapsed HUDs skip telemetry and map redraws.

## The far prop layer drew every record at the world origin (2026-09-24)

The CTO said twice that small objects "just appear pretty close". Two measurements concluded nothing was distance-culled and every record was drawn, and one fix (matching the far and near colours) changed nothing. The cause: since phase one, `streamedPropVisual` set each record's position and rotation on a helper `Object3D` and uploaded `helper.matrix`, but an object outside the scene never recomputes its matrix, so every far instance carried the construction matrix and all 256 were drawn in one pile at the runway crossing. Nothing was drawn where a prop actually was until it was promoted into physics at 90 m, which is exactly what he saw. The earlier claim that records were "always drawn" was true of the code and false on the screen: the review and the measurement checked that the far mesh existed and what material it had, not that its matrices carried the positions. The fix is `transform.updateMatrix()` before the upload, and the unit test now reads the instance matrices back and checks each record's position and rotation, which fails on the old code. The lesson beside the loop-rig one: verify the thing on the screen, not the thing in the scene graph.
