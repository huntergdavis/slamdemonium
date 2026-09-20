# R5: the slice is not ready for acceptance

**3 MET · 7 UNVERIFIED · 2 NOT MET.** This is an assessment of production
commit [c869be6][revision], dated 2026-09-20, against every item in
[design section 3][acceptance], in its original order. A merged, tested module
does not establish that the shipped application exposes it.

**MET** means the stated check has passing evidence within the scope below.
**UNVERIFIED** means a required observation is missing, not that the feature
has failed. **NOT MET** means there is a demonstrated gap or an unresolved
measured violation. Pending work and projected fixes do not count as passes.

## Feel and function

| #   | Acceptance criterion                                                                                                  | Verdict and evidence                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Static-host Chrome, Safari and Firefox; drivable within 5 seconds on typical broadband.                               | **UNVERIFIED.** [Production Chromium tests][boot-tests] demonstrate readiness and keyboard driving; the [physics test][physics-tests] verifies WASM delivery. [Playwright runs Chromium only][browser-config]; no Safari/Firefox result or measured cold-load-to-driving result under a recorded broadband profile is attached. Local readiness is not a network-loading measurement.                                                       |
| 2   | Default 0–100 km/h in 2.0–2.3 s; 0–55 m/s in 6.3–7.1 s, measured from telemetry.                                      | **MET.** The [real suspended Jolt vehicle test][acceleration-test] asserts both ranges and passes in [CI][ci]. [Recorded results][numeric-results]: **2.208333 s / 6.750000 s**, default tuning at 120 Hz, after settling the spawn. Includes throttle filtering, suspension and tire traction; times are simulated seconds, not headless browser wall time.                                                                                |
| 3   | Every Options slider changes behavior within one frame; mass rebuild within 200 ms without resetting position.        | **NOT MET at this revision.** [Production boot][boot] does not mount Options. The passing [Options browser tests][options-tests] exercise a [separate fixture explicitly excluded from the application][options-fixture]. The tuning API and mass rebuild exist, but neither proves the player can use a slider. WP14 must mount the UI, dispatch its actions, then measure behavior latency and pose preservation through the actual page. |
| 4   | Human holds a controlled default drift on the circle for ≥5 seconds, with steering-plus-throttle and handbrake entry. | **UNVERIFIED — CTO playtest pending.** The drift law has sign/exit tests and [handbrake replay coverage][replay-tests]. Neither demonstrates a human can enter, adjust the line, hold five seconds and recover using **both** methods at defaults. A spin or wall-supported slide is not a pass.                                                                                                                                            |
| 5   | Grip, Drifty and Raw distinguishable blind within 30 seconds.                                                         | **UNVERIFIED — CTO playtest pending.** Preset values and the fixture's selector work; no blind human result is recorded. Hiding the name matters. Use randomized trials with repeats and report mistakes, not merely that the parameter sets differ.                                                                                                                                                                                        |
| 6   | Every assist can be zero while the car remains drivable, without explosions/NaNs.                                     | **UNVERIFIED — CTO playtest pending.** [Grounded zero-assist torque test][zero-assist-test] passes; it is not a sustained handling test. Apply [PM ruling Q7][questions]: zero the tunable handling assists, including the yawAssist-gated limiter; internal airborne damping and extreme-roll recovery remain. Drive and recover at zero, record finite state and unexpected recoveries, and judge whether control remains usable.         |

## Engineering

| #   | Acceptance criterion                                                                                         | Verdict and evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7   | Fixed 120 Hz physics, independent of refresh, with interpolation; verified at 60/144 Hz.                     | **MET for the automated refresh-rate contract.** [Loop tests][loop-tests] feed 60/144 Hz frame timestamps and verify exact step counts, constant 1/120 s dt, interpolation alpha and no dropped time; [transform tests][transform-tests] cover position lerp/quaternion slerp. Production uses those paths. These are simulated display schedules, not a claim of visual inspection on two physical displays.                                                                                                                                                                                                                 |
| 8   | timeScale 0.05–2 changes simulation speed, never dt, without instability.                                    | **UNVERIFIED in full.** The same [loop tests][loop-tests] prove step-count scaling at 0.05/0.5/1/2 with invariant dt using synthetic physics hooks. The [browser check][physics-tests] reads live settings and uses manual stepping; it does not exercise an extreme-scale vehicle run under RAF. Add a real vehicle/loop scale sweep with finite-state and recovery assertions. Separately, production currently ignores the T slow-motion action.                                                                                                                                                                           |
| 9   | Sustained 60 FPS on M-series MacBook Air, Chrome or Safari, 1080p-equivalent; model plus physics mean <1 ms. | **UNVERIFIED.** No specified-hardware run is attached. [Node model-plus-Jolt means][numeric-results] of 0.273/0.218 ms and the [shared-host browser measurements][outliers] cannot establish this. Report delivered render dimensions/scale alongside frame distribution and the full-step mean; automatic resolution reduction must not conceal missing 1080p evidence.                                                                                                                                                                                                                                                      |
| 10  | Five minutes scripted driving: no NaN/Infinity, stable JS heap, no per-frame hot-path allocations.           | **NOT MET: allocation-free requirement remains open.** [Profiling][outliers] measured allocation churn in renderer and vehicle/adapter stacks; WP13 remediation and a comparable after-profile are pending at this cutoff. Positive partial evidence: [two 36,000-step Node runs][soak-test] cover 300 simulated seconds each with finite checked state and zero recoveries; the earlier browser capture had +2.85% retained JS and flat WASM allocator use. These are different workloads. Stable retained heap does not mean no transient allocations, and elapsed wall time does not establish simulated driving duration. |
| 11  | Same seed and recorded input yield identical final state repeatedly in the same browser.                     | **UNVERIFIED for the integrated vehicle replay.** [WP11 example tests][replay-tests] replay standing start, handbrake turn and a ring lap exactly in the same Jolt world, in **Node**. [Chromium's one-box test][physics-tests] and [manual/RAF procedural parity][perf-tests] supply narrower browser evidence. Production has no ScriptController or game.scripts facade. Wire the controller and repeat an actual versioned recording in the same browser, checking full final state and exact EOF. Cross-browser equality is optional.                                                                                    |
| 12  | npm test, npm run e2e and npm run build pass CI.                                                             | **MET.** [CI run 35542697717][ci] passed all three, plus lint, on the exact assessed commit. This certifies the tests that exist; it does not expand their browser coverage or turn fixture tests into production integration tests.                                                                                                                                                                                                                                                                                                                                                                                          |

## Production spot check

A fresh production build of c869be6, without the test-fixture flag, was opened
in headless Chromium at 800×450 on 2026-09-20. After readiness, the probe paused
RAF simulation through the perf API and consumed actual keyboard events through
manual physics steps. O followed by one step left **zero Options panels**;
game.scripts was **undefined**; T followed by one step left timeScale at **1**.
W held for 120 steps produced **13.0114 m/s**, with no page errors. This confirms
a functioning driving demo with absent controls, not a failed application boot.
Reproduce with a normal production build/preview and the same keyboard/stepMany
sequence; do not substitute the standalone Options fixture.

## What must change before sign-off

1. **Finish and verify production integration.** WP14 is in progress. Options,
   HUD/CSV and ScriptController must be reachable from the shipped entry point.
   At the assessed revision, boot consumes only respawn, gizmos and camera
   actions: [O, H, T, P, Tab and F9 are emitted but ignored][keyboard]. Startup
   constructors alone will not fix that. Re-check this assessment after WP14
   merges; do not preserve a stale failure once integrated evidence exists.
2. **Close the automated evidence gaps.** Exercise real sliders and mass rebuild
   timing, vehicle timeScale extremes, recorded browser replay and a finite-state
   browser soak with explicit completed steps. Re-profile allocations after WP13.
   The earlier finding that **116/119 slow steps did not overlap GC** still
   applies to that capture: reducing allocations does not promise lower p99.
3. **Run the CTO playtest on the specified hardware.** Record five-second drifts
   by both entries, blind preset identification within 30 seconds, and sustained
   zero-assist driving. Use the [tuning method](tuning-method.md), actual parameter
   exports and recordings. Also capture load time in all three browsers and
   sustained target-size rendering; Chromium CI cannot sign those off.

The [manual QA checklist][qa] is a procedure, not a completed result sheet. Its
opening “not yet drivable” status is stale, and its “Firefox is a bonus” wording
does not waive section 3's Firefox loading requirement. Read its zero-assist
instructions alongside Q7 rather than zeroing unrelated steering parameters.

[revision]: https://github.com/huntergdavis/slamdemonium/commit/c869be69141d3d51bb1bd47eb6e0ffcbea30fa3d
[acceptance]: https://github.com/huntergdavis/slamdemonium/blob/c869be69141d3d51bb1bd47eb6e0ffcbea30fa3d/docs/vertical-slice-design.md#3-success-criteria-acceptance
[ci]: https://github.com/huntergdavis/slamdemonium/actions/runs/35542697717
[boot]: https://github.com/huntergdavis/slamdemonium/blob/c869be69141d3d51bb1bd47eb6e0ffcbea30fa3d/src/main.ts
[boot-tests]: https://github.com/huntergdavis/slamdemonium/blob/c869be69141d3d51bb1bd47eb6e0ffcbea30fa3d/e2e/vehicle.spec.ts
[browser-config]: https://github.com/huntergdavis/slamdemonium/blob/c869be69141d3d51bb1bd47eb6e0ffcbea30fa3d/playwright.config.ts#L26
[acceleration-test]: https://github.com/huntergdavis/slamdemonium/blob/c869be69141d3d51bb1bd47eb6e0ffcbea30fa3d/tests/vehicle.test.ts#L246
[numeric-results]: https://github.com/huntergdavis/slamdemonium/blob/c869be69141d3d51bb1bd47eb6e0ffcbea30fa3d/docs/DECISIONS.md#numeric-acceptance-and-replay-evidence
[options-tests]: https://github.com/huntergdavis/slamdemonium/blob/c869be69141d3d51bb1bd47eb6e0ffcbea30fa3d/e2e/options.spec.ts#L7
[options-fixture]: https://github.com/huntergdavis/slamdemonium/blob/c869be69141d3d51bb1bd47eb6e0ffcbea30fa3d/tests/options/entry.ts#L9
[zero-assist-test]: https://github.com/huntergdavis/slamdemonium/blob/c869be69141d3d51bb1bd47eb6e0ffcbea30fa3d/tests/vehicle.test.ts#L119
[questions]: https://github.com/huntergdavis/slamdemonium/blob/c869be69141d3d51bb1bd47eb6e0ffcbea30fa3d/QUESTIONS.md
[loop-tests]: https://github.com/huntergdavis/slamdemonium/blob/c869be69141d3d51bb1bd47eb6e0ffcbea30fa3d/tests/loop.test.ts#L58
[transform-tests]: https://github.com/huntergdavis/slamdemonium/blob/c869be69141d3d51bb1bd47eb6e0ffcbea30fa3d/tests/loop.test.ts#L160
[physics-tests]: https://github.com/huntergdavis/slamdemonium/blob/c869be69141d3d51bb1bd47eb6e0ffcbea30fa3d/e2e/physics.spec.ts
[outliers]: https://github.com/huntergdavis/slamdemonium/blob/c869be69141d3d51bb1bd47eb6e0ffcbea30fa3d/docs/research/perf-outliers.md
[soak-test]: https://github.com/huntergdavis/slamdemonium/blob/c869be69141d3d51bb1bd47eb6e0ffcbea30fa3d/tests/vehicle.test.ts#L142
[replay-tests]: https://github.com/huntergdavis/slamdemonium/blob/c869be69141d3d51bb1bd47eb6e0ffcbea30fa3d/tests/script-examples.test.ts
[perf-tests]: https://github.com/huntergdavis/slamdemonium/blob/c869be69141d3d51bb1bd47eb6e0ffcbea30fa3d/e2e/performance.spec.ts
[keyboard]: https://github.com/huntergdavis/slamdemonium/blob/c869be69141d3d51bb1bd47eb6e0ffcbea30fa3d/src/input/keyboard.ts#L18
[qa]: https://github.com/huntergdavis/slamdemonium/blob/c869be69141d3d51bb1bd47eb6e0ffcbea30fa3d/docs/QA_CHECKLIST.md
