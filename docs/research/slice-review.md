# R6: release the experimental tuning lab; keep acceptance open

**Judgment: this is honestly releasable as an experimental first tuning-lab
release, with Chrome as the verified browser.** The lab now exposes its controls,
measurements and replay. Its human feel and reference-device performance are not
signed off, and two acceptance requirements remain unmet in the evidence below.
Do not describe design section 3 as complete.

**5 MET · 5 UNVERIFIED · 2 NOT MET.** This dated snapshot assesses production
[54a4296][revision] on **2026-09-20**, replacing [R5's c869be6 assessment][r5].
A fresh normal production build was probed in Chromium, without fixture code.
The [green CI descendant e933f87][ci] has identical application, test, dependency
and build-configuration files; its only intervening change is the backlog.

MET means demonstrated within the stated test scope. UNVERIFIED means a required
observation is missing. NOT MET means an observed failure or an unresolved
measured violation. The table preserves every [section 3 criterion][acceptance],
in order. A passing module is still not a substitute for integrated evidence.

## Feel and function

| #   | Acceptance criterion                                                                                                   | Verdict and evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Static-host Chrome, Safari and Firefox; drivable within 5 seconds on typical broadband.                                | **UNVERIFIED.** Production Chromium boots and drives. [CI configuration][browser-config] still tests Chromium; no Safari/Firefox result or measured cold-load-to-driving time under a recorded broadband profile is attached to this snapshot. Cross-browser smoke and the load measurement are engineering work that can still close this gap.                                                                                                                                                                                                                                                                                                                                                                                            |
| 2   | Default 0–100 km/h in 2.0–2.3 s; 0–55 m/s in 6.3–7.1 s, from telemetry.                                                | **MET.** The real vehicle integration artifact reports **2.208333 s / 6.750000 s**, default tuning at 120 Hz after a settled spawn. [The integration run on this exact commit passed][integration-ci]. It also records a **72.399 m** stop from 59.9995 m/s, inside appendix A's 77 m ±15% band. These are simulated-time, real-Jolt vehicle measurements.                                                                                                                                                                                                                                                                                                                                                                                 |
| 3   | Every Options slider changes behavior within one frame; mass rebuild within 200 ms without resetting position.         | **NOT MET in the measured environment: the 200 ms clause failed.** The missing mount is fixed. All **85 controls / 71 parameters** synchronously updated the production store; accel0 changed the very next physics step. Mass edits preserved exact pose and speed, but direct callback timestamps were **2.880–3.940 s** after the edit, despite a 100 ms requested timer. The shared Linux/software-WebGL host was rendering around 1 FPS. This establishes that run's failure, not a target-device defect; repeat the deadline measurement on a representative GPU desktop before promotion. Store binding alone also does not certify every parameter's behavioral effect in every driving context. [Probe data and source][evidence] |
| 4   | Human holds a controlled default drift on the circle for ≥5 seconds, using steering-plus-throttle and handbrake entry. | **UNVERIFIED — CTO playtest required.** The drift law and handbrake manoeuvre have automated coverage, including the browser replay below. A human must still enter, adjust the line, hold five seconds and recover by both methods at defaults. Spins and wall-supported slides do not count.                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 5   | Grip, Drifty and Raw distinguishable blind within 30 seconds.                                                          | **UNVERIFIED — CTO playtest required.** Presets are reachable in the real Options panel. No randomized, name-hidden human result is recorded. Different parameter values and successful preset switching cannot establish distinguishable feel.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 6   | Every assist can be zero while the car remains drivable, without explosions/NaNs.                                      | **UNVERIFIED — CTO playtest required.** [Grounded zero-assist torque][zero-assist-test] and finite-state tests pass, but sustained controllability at zero still needs a driver. Follow [Q7][questions]: countersteerAssist=0 and yawAssist=0 also disable the drift limiter; internal airborne damping and extreme-roll recovery remain. Do not zero steering lock or other unrelated steering parameters.                                                                                                                                                                                                                                                                                                                                |

## Engineering

| #   | Acceptance criterion                                                                                         | Verdict and evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7   | Fixed 120 Hz physics, independent of refresh, with interpolation; verified at 60/144 Hz.                     | **MET for the automated refresh-rate contract.** [Loop/interpolation tests][loop-tests] pass. R6 additionally ran the real vehicle, input mapper and script controller through synthetic 60/144 Hz frame schedules: exact step counts and valid interpolation alpha. Physical-display visual inspection is not implied.                                                                                                                                                                                                                                                                                     |
| 8   | timeScale 0.05–2 changes simulation speed, never dt, without instability.                                    | **MET in the controlled real-vehicle test.** Eight cases combined 60/144 Hz with 0.05/0.5/1/2. Each completed the same **420-step handbrake script**, every dt was **1/120 s**, virtual wall duration matched timeScale within one display interval, every telemetry sample stayed finite, and final states matched exactly with zero recoveries. This R6 probe is reproducible from the [evidence bundle][evidence]; it is not yet a permanent CI regression. A separate 0.05× real-RAF probe timed out after 240 wall seconds on the overloaded software renderer and supplies no completed-run evidence. |
| 9   | Sustained 60 FPS on M-series MacBook Air, Chrome or Safari, 1080p-equivalent; model plus physics mean <1 ms. | **UNVERIFIED — reference hardware required.** FPS and smoothed milliseconds are now visible in Minimal HUD mode; that makes the check possible, not passed. No M-series result is attached. The hosted manual p99 of 0.10 ms is a different metric and machine. Record delivered render dimensions/scale so automatic downscaling cannot silently replace the 1080p target.                                                                                                                                                                                                                                 |
| 10  | Five minutes scripted driving: no NaN/Infinity, stable JS heap, no per-frame hot-path allocations.           | **NOT MET: allocation-free requirement remains unresolved.** [Measured allocation churn][outliers] has no completed WP13 remediation/after-profile at this cutoff. Positive partial evidence: the new integration run completed **36,000 steps / 300 simulated seconds**, all finite, zero recoveries. The post-WP14 [hosted browser soak][perf-ci], with identical application sources, passed retained-heap gates (**+0.0023% JS, flat WASM allocator**) over **309.02 wall seconds / 72 simulated seconds**. Neither stable retained heap nor those different workloads proves this entire criterion.    |
| 11  | Same seed and recorded input yield identical final state repeatedly in the same browser.                     | **MET for the tested build/browser.** R6 loaded the full versioned 420-step handbrake recording twice through the mounted facade, first applying and then verifying tuning. Pose, linear/angular velocity, wheel state and replay metrics matched exactly; all samples were finite, no recoveries occurred, and overshooting stepMany stopped at exact EOF. [Built-page CI also checks replay integration][runtime-tests]. This is same-browser/build evidence; cross-browser equality is optional.                                                                                                         |
| 12  | npm test, npm run e2e and npm run build pass CI.                                                             | **MET.** [Source-equivalent CI run 35544485941][ci] passed **156 unit tests, 26 browser tests**, build and lint. [Design 13.2 integration tests][integration-ci] additionally passed on the exact reviewed commit. These numbers do not certify untested browsers or human feel.                                                                                                                                                                                                                                                                                                                            |

## What the production probe established

The previous unmounted-UI finding is closed. In the real page, P paused,
O opened Options, H exposed Minimal HUD with visible FPS/ms, T toggled 0.25×/1×,
and Tab switched A/B slots. All slider bindings worked; changing accel0 from
6 to 30 changed the next step's speed gain from **0.04769 to 0.19214 m/s** from
the same initial state. A mass value of 1800 survived reload and was applied to
the actual body. F9 exported **24 physics samples plus metadata/header**, and the
full handbrake replay repeated exactly. No page/console errors were observed.

The direct timer probe avoids conflating late polling with late rebuilding:
the three 100 ms callbacks started at **3931.7 / 2880.0 / 3177.4 ms**.
Their bodies took **8.1 / 0.4 / 0.4 ms**. This points to delayed callback
execution in this environment, not several seconds spent rebuilding inertia.
It does not identify which renderer/scheduler activity caused the delay.
Keep the failed timing observation; do not convert it into a reference-laptop
performance claim or silently discard it because the host was slow.

The [integrated hosted performance run][perf-ci] at **23cc24d** passed with
**0.10 ms manual full-step p99** against the 2 ms gate (mean **0.0295 ms**).
Application sources match this review snapshot; later changes added the
reachability check and documentation. Configuration fingerprint:
16581fb4f669cba8ebc8b00c28d5b39c40f26b799f2aa577a7fb4f79501a22c4.
Retained JS grew **0.0023%**, with flat WASM allocator use. This closes the earlier
lack of a post-WP14 performance run. It is not a MacBook frame-rate measurement.
No timing speedup is promised from allocation fixes: the earlier diagnostic found
**116 of 119 slow steps outside GC**, with one apparent overlap inside clock
precision.

## What only external evidence can settle

The CTO must judge **drift holding, blind preset distinction and zero-assist
drivability** (4–6). A person with the specified **M-series MacBook Air** must
supply the delivered-resolution and sustained-performance measurement (9).
More tests on this development host cannot replace those observations.
Use the refreshed [QA checklist][qa] and [tuning method](tuning-method.md), and
attach the tune, input/CSV recordings and browser/hardware details.

The remaining engineering work is separate: browser/load coverage (1), a
representative-device control-latency check (3), and allocation/soak evidence
for the integrated release candidate (10). These are not human-feel questions.

**Release recommendation:** publish the first experimental tuning lab with those
limitations in its release notes and ask the CTO to perform the three feel
checks. Treat that as the beginning of tuning, not a certificate that every
acceptance item has passed. The original reason to withhold a lab release—its
controls being absent from the shipped app—has been corrected.

## Evidence and reproduction

[Compact measurements, exact input references and probe sources][evidence]
preserve both successful checks and the failed deadline/RAF attempt. The browser
was Chromium 153 with software WebGL at 800×450. The probes used a fresh profile,
ordinary production assets and the public game facade. The frame-schedule
probe used the real Jolt/vehicle/script stack with rendering omitted.

To reproduce, use the reviewed commit in a separate checkout. Extract the
evidence JSON's sources map to its named paths; run npm ci, npm run build and
npx playwright install chromium. Run npx tsx scratch/r6/probe.mts, then
npx tsx scratch/r6/mass-timer.mts, then
npx vitest run tests/r6-timescale.test.ts. Run the browser probes sequentially.
Outputs go to scratch/r6. The recorded revision fields name this original
snapshot; update them if deliberately measuring a different revision. The
first browser probe intentionally retains its 240-second replay watchdog;
a timeout is an incomplete test, never a shortened passing drive.

[revision]: https://github.com/huntergdavis/slamdemonium/commit/54a429695ce197be59cde999d33911c080529286
[r5]: https://github.com/huntergdavis/slamdemonium/pull/45
[acceptance]: https://github.com/huntergdavis/slamdemonium/blob/54a429695ce197be59cde999d33911c080529286/docs/vertical-slice-design.md#3-success-criteria-acceptance
[ci]: https://github.com/huntergdavis/slamdemonium/actions/runs/35544485941
[integration-ci]: https://github.com/huntergdavis/slamdemonium/actions/runs/35544417491
[perf-ci]: https://github.com/huntergdavis/slamdemonium/actions/runs/35544691665
[browser-config]: https://github.com/huntergdavis/slamdemonium/blob/54a429695ce197be59cde999d33911c080529286/playwright.config.ts
[zero-assist-test]: https://github.com/huntergdavis/slamdemonium/blob/54a429695ce197be59cde999d33911c080529286/tests/vehicle.test.ts#L119
[questions]: https://github.com/huntergdavis/slamdemonium/blob/54a429695ce197be59cde999d33911c080529286/QUESTIONS.md
[loop-tests]: https://github.com/huntergdavis/slamdemonium/blob/54a429695ce197be59cde999d33911c080529286/tests/loop.test.ts
[runtime-tests]: https://github.com/huntergdavis/slamdemonium/blob/54a429695ce197be59cde999d33911c080529286/e2e/runtime.spec.ts
[outliers]: https://github.com/huntergdavis/slamdemonium/blob/54a429695ce197be59cde999d33911c080529286/docs/research/perf-outliers.md
[qa]: https://github.com/huntergdavis/slamdemonium/blob/54a429695ce197be59cde999d33911c080529286/docs/QA_CHECKLIST.md
[evidence]: slice-review-evidence.json
