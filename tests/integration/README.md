# Scripted vehicle integration tests (WP9b)

Run all seven design [13.2](../../docs/vertical-slice-design.md#132-integration-tests-vitest-with-the-real-engine-in-node-if-the-wasm-loads-there) scenarios:

```sh
npm ci
npm run test:integration
```

`vitest.integration.config.ts` selects `tests/integration/**/*.integration.ts`. The normal config selects `tests/**/*.test.ts`, so the integration suite adds no work to `npm test` or its PR check. The intended automatic consumer is a separate, non-required job on pushes to main, owned by devops. The first measured run on the shared development host took **67.28 seconds command wall time**, including **56.28 seconds in Vitest**. The soak itself took 21.66 seconds. This justifies keeping it separate; devops has the exact command, runtime, artifact path and a suggested five-minute job timeout for execution on every main push.

The suite loads stock single-thread Jolt in Node and uses the production `Vehicle`, `InputMapper`, `ScriptController`, and `FixedStepLoop.stepMany`. Every scenario crosses the v1 JSON parser with a complete schema-derived tuning header, a fixed seed and a fresh spawn. Physics never reads a timer; wall time is measured only outside the simulation for runtime reporting. No velocity, pose, boost meter or controls are injected mid-drive.

The harness uses a flat 10 km-square ground collider, without ring barriers or kill-plane respawns. This is the flat-plane experiment required by section 13.2; driving the braking approach on the game's bounded ring would measure wall collisions instead. The original ring harness remains the default for WP11's example/lap regressions.

| Scenario | Assertion |
| --- | --- |
| Straight acceleration | Appendix A's 0–100 km/h and 0–55 m/s expectations, using the section 13.1 bands; negligible lateral displacement |
| Full brake from 60 m/s | Unchanged defaults, 30-second full-throttle approach reaching 60 within 0.01 m/s, then full brake; first forward stop travels 77 m ±15% |
| Constant-steer circle | Full circle with nonzero speed and lateral acceleration, four grounded wheels, and per-step acceleration bounded by measured tire capacity during the settled window |
| Handbrake turn | Rear wheels lock, rear grip reaches its configured multiplier, the car slides/turns left, and grip recovers after release |
| Determinism | Two identical seeded 30-second scripts produce equal SHA-256 hashes of every completed state; a different seeded drive produces a different hash |
| Soak | Exactly 300 simulated seconds of seeded pseudo-random input, no non-finite state or automatic recovery, and bounded angular speed |
| Coast energy | Speed never increases beyond float32 roundoff after the throttle filter fully releases, with more than nine seconds of observed coast |

All runs also assert exact EOF step count, finite telemetry, no vehicle recovery, speed below the captured boosted limit and angular speed below the captured clamp. Seeded frames are authored before loading, not generated during playback. The hash includes pose, velocities, wheel state, controls, drift and boost; renderer and wall-clock measurements are excluded. Equality guards this engine build's determinism, not cross-platform or cross-version compatibility.

The circle uses actual per-wheel `mu * Fz`, including downforce and load sensitivity. The approved [combined-slip ruling](../../QUESTIONS.md) (question 4) permits a total force up to `sqrt(2 - combinedSlipCoupling) * mu * Fz`; applying a strict unit friction circle at every coupling would contradict that ruling. A 1 m/s² allowance accounts for the published acceleration's 0.1-second filter lag and suspension transients. The test checks every sample in a 15-second settled window and requires a completed turn, so low speed or a stationary car cannot satisfy it vacuously.

Braking distance is measured at the first forward stop (below 0.5 m/s), before a continuously held brake becomes reverse input. The coast invariant starts when the actual filtered throttle is zero; a zero raw pedal during `throttleFallTime` still commands positive engine force. Both distinctions follow the real input/vehicle path rather than bypassing it.

Results and per-scenario wall times are written to `scratch/wp9b-integration.json`. Reference sources reused: WP5's production-vehicle checks in `tests/vehicle.test.ts` (PR #31), WP11's real script harness, and appendix A. Appendix-derived thresholds are cited beside their assertions so default changes point back to the intended behavior.

## First measured outcomes

- Acceleration: 100 km/h in 2.208 s; 55 m/s in 6.750 s.
- Brake approach: 59.999519 m/s; first stop after 72.399 m and 2.517 s.
- Circle: 1,800 settled samples, all four wheels grounded, 7.532 rad heading travel, 20.198 m/s² peak lateral acceleration.
- Handbrake: both rear wheels locked for 60 steps; grip reached 0.35 and recovered to 1.
- Determinism: identical 64-digit SHA-256 state hashes; different seed produced a different hash.
- Soak: all 36,000 steps completed; maximum angular speed 2.416 rad/s under the captured 12 rad/s bound.
- Coast: speed decreased from 49.255 to 29.953 m/s over 1,190 checked intervals; no interval gained speed.

These are observed results, not replacement acceptance thresholds. The assertions retain the design-derived targets and captured tuning limits.

`proving-ground.integration.ts` measures the default map's structures on the real engine: the giant ramp landing radius at 60 and 85 m/s against the 470 m barrier, the lowest entry speed that completes the 18 m east loop, and every example route's clearance of the proving ground's ramps and loops (the lab fixtures replay in-game on whichever map is loaded).

`loop-forgiveness.integration.ts` measures how forgiving each authored loop is with a plain lane-following test driver: widest entry angle, largest lateral offset and lowest speed that still complete, plus two in-loop tolerances (a quarter-second steering kick on the wall, and riding a line off centre). It reports the lab loop, the east loop with radius only, and the east loop as authored, side by side, into `scratch/loop-forgiveness.json`.
