# Decisions

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
