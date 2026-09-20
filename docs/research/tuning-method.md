# R4: tune the car, not your memory

**Leave the first 30 minutes with one defensible improvement.** Screening all 14
quick sliders is useful; declaring 14 winners is not. Keep the original setup,
re-test the strongest candidate blind, and export the evidence.

This procedure uses the [playbook](../TUNING_PLAYBOOK.md),
[design §§3, 7–12](../vertical-slice-design.md), and actual
[preset overrides](../../src/tuning/presets.ts). It describes the completed lab's
tools; missing controls or telemetry make the affected check **untested**.

## Make each comparison fair

1. **Freeze the conditions.** Same build, controller, camera, window size and
   audio state. Prefer gamepad; evaluate keyboard separately. Use `timeScale = 1`,
   `physicsHz = 120`, no boost, stable frame rate. Start with Default and export
   it. Confirm road texture, markings and posts are visible before judging speed.
2. **Write the claim first.** Example: “Raising `yawAssist` from 0.4 to 0.5 makes
   a five-second drift easier to hold without making exit harder.” Score hold,
   exit and fun separately, 1–5, immediately after driving and before looking at
   the numbers. “Different” is not automatically “better.”
3. **Protect A.** Put the chosen baseline in A, copy A to B, then change exactly
   one parameter in B. Start with roughly 5–10% changes, or 0.1 for an assist.
   Before testing another slider, restore B from A. Save promising candidates;
   do not silently accumulate them into the baseline.
4. **Reset between runs.** Select the slot while stopped, press R, repeat the
   same approach, and let the car settle. A live mid-drift swap is useful for
   exploration but carries the previous tune's state into the next comparison.
   Tab swaps with game focus; inside Options use the explicit A/B controls.
5. **Re-test without knowing the answer.** Have a helper hide the slot/preset
   labels and slider values, randomize which tune is called A, and run A–B–B–A
   with equal practice. Record ratings before revealing the mapping. Solo A–B–B–A
   reduces order bias but is not blind.

Assume you can start acclimatising within a minute: “this feels normal now” is
weak evidence. Steering research finds rapid adaptation to modest changes in
vehicle response; it does **not** establish a universal 60-second threshold.
[Macuga, 2018](https://www.sciencedirect.com/science/article/pii/S1369847817303364)

Fixed conditions and varied order reduce nuisance effects
([NIST](https://www.itl.nist.gov/div898/handbook/pri/section3/pri332.htm)). One slider
at a time identifies a useful local change, not the globally best setup:
parameters interact. Combine winners only after individual checks, then re-test
the combination against the original A.
[NIST on the limits of one-factor testing](https://www.itl.nist.gov/div898/handbook/pri/section2/pri212.htm)

## Use a route card

**Default route:** R, follow the 130 m dashed centre line counter-clockwise,
settle at **35 m/s**, and start the maneuver opposite spawn. Lap one: enter by
steering plus throttle, hold for five seconds, counter-steer out. Lap two: repeat
with a brief handbrake entry, releasing the handbrake for the hold. Return to the
centre line after each maneuver; use the same landmark and entry speed within
1 m/s. Two laps take roughly a minute including setup. Judge staying in the
painted ring, corrections and clean exit, not just a large slide angle.

For quick screening, repeat only the relevant maneuver:

| Probe          | Repeatable task                                                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Launch/brakes  | From spawn, short straight 0→25 m/s, then brake 25→5 m/s. Reset; do not attempt a long top-speed straight into the outer wall.                          |
| Speed/steering | Same ring sector at 50 m/s, or a lower speed both tunes can sustain. For `topSpeed`, also compare speed reached after the same ten seconds of throttle. |
| Tire grip      | Follow the 30 m skidpad circle, gently increase speed from 20 m/s until the line cannot be held. Repeat the same direction and ramp.                    |
| Drift          | The route's five-second entry/hold/exit, with the entry method fixed for the pair.                                                                      |

Choose an attainable speed during warm-up and keep it for both slots. A missed
entry speed invalidates the pair; inability to hold the line after a matched
entry is a result. Log spins and wall hits as failures, but exclude their impact
spikes from tire-grip measurements.

## Read the G-G diagram with the tire bars

Acceleration/braking uses the longitudinal axis; cornering uses the lateral
axis. Combined braking and turning share the tire budget. A cloud well inside
the reference circle does **not** prove weak tires: first confirm meaningful
steering/pedal demand. Low front usage can mean too little steering; front usage
near its limit with a widening path suggests front saturation. Check normal
loads and slip angles as well. More slip with less lateral acceleration can mean
the tires have passed their peak, not that you should add more steering.

The drawn `mu * gravity` circle is a reference, not a hard envelope. Downforce,
load sensitivity and different front/rear grip alter available force. At Default,
the simple no-aero reference is `1.5 * 14.7 = 22.05 m/s²`; downforce at top speed
adds **60% of the car's weight**. Do not credit that extra load to the tires.
For an isolated tire comparison, save the original A, then create a separate
diagnostic A/B pair with `downforceAtTopSpeed = 0` in **both** slots. Change only
the tire parameter between them. Afterwards restore the original A and normal
downforce, and re-test the candidate. [Force model, design §6](../vertical-slice-design.md)

## The first 30 minutes

Each screening row lists sliders **in order**, not a bundle to change together.
Give each about a minute for one short A/B maneuver and a note. Keep A unchanged;
if setup takes longer, mark the remaining knobs untested instead of rushing.

| Minutes | Do this                                                                                                                                                                                                           |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0–3     | Check conditions, export Default, practise the route. Note whether Default supports both five-second entries; do not treat a tuned preset as Default acceptance.                                                  |
| 3–7     | Drive **Raw → Grip → Drifty**, about a minute each. Rate turn-in, drift hold and exit; choose one baseline and copy it to A/B. Presets are bundles: Raw also changes aero, tire lag and camera, not just assists. |
| 7–8     | Screen `fovSpeedGain` at matched speed. Check delivered FOV and cap-active telemetry; choose a readable picture before chasing more engine power.                                                                 |
| 8–11    | Screen `accel0`, `topSpeed`, `brakeDecel`: launch, sustained throttle, then stopping.                                                                                                                             |
| 11–13   | Screen `gravity`, then `downforceAtTopSpeed`: establish weight/load effects before interpreting grip.                                                                                                             |
| 13–17   | Screen `gripFront`, `gripRear`, `slideGripRatio`, `slipFalloffRate`: turn-in balance first, then how the tire loses and retains grip.                                                                             |
| 17–21   | Screen `handbrakeRearGrip`, `steerMaxTopSpeed`, `countersteerAssist`, `yawAssist`: entry, high-speed authority, catch, then hold/exit.                                                                            |
| 21–27   | Restore the strongest single candidate in B. Have a helper run the blind A–B–B–A route test; record each run separately with F9. Include both drift entries.                                                      |
| 27–30   | Check one CSV claim, reveal the mapping, export the candidate and baseline JSON, and write one keep/reject/uncertain decision.                                                                                    |

This is a screening session. A separate blind preset-identification check must
still establish the design's “distinguishable within 30 seconds” criterion.

## Make the CSV answer one question

F9 starts/stops a physics-rate recording. Use **one unchanged parameter set per
file**; its header describes the setup, not every later slider move. Keep build,
input device, route, A/B JSON and run IDs together. Compare all valid repeats,
not the prettiest run; two runs per setting here give preliminary evidence.

For “the drift holds for five seconds,” find a continuous interval with
`|beta| >= driftMinAngle`, speed above 15 m/s and at least two grounded wheels.
Check angle units first. Use timestamps, or sample-index difference divided by
120 if the file has no time column and the recording is complete: **600 step
intervals**, not 600 isolated qualifying rows. Verify video/observation shows a
controlled path and clean exit; a spin can also satisfy an angle threshold.
Report duration, peak absolute angle and failures separately for both entries.
These numerical conditions support, but do not replace, the human acceptance.

For a brake claim, compare elapsed time from 25→5 m/s at the same brake input;
integrate `sum((speed[i] + speed[i+1]) / 2 * dt)` for distance. “Feels faster”
needs two columns in the notes: measured speed and perceived speed.
[Recorder contract, design §§6.11, 12.2](../vertical-slice-design.md)

## Traps worth catching early

- **Missing speed cues or capped FOV:** fix/read presentation before raising
  `topSpeed`. A higher slider value can deliver the same capped view.
  [Speed and vibe](speed-and-vibe.md)
- **Aero doing the tire's work:** match speed and load conditions. `gravity`
  changes suspension and grip; `topSpeed` also normalizes aero, steering and FOV.
  One edited parameter can affect several systems.
- **A hold with no exit:** rate entry, hold and recovery independently. More
  assist is not a win if the car refuses to straighten. [Drift assist](drift-assist.md)
- **Learning masquerading as improvement:** identical practice, hidden labels,
  reverse order, and a fresh baseline run. Slow motion is for diagnosis; return
  to normal speed for judgment.
- **Stacking guesses:** export one candidate and its evidence. Save the next
  question for the next session instead of changing three more sliders on exit.
