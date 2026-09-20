# R2: make the drift catchable, then make it holdable

**Recommendation:** retain the bounded angle-error torque in design §6.8 C, but
replace its stateless target selection with a latched drift side and a captured
neutral angle. Give counter-steering a genuine zero-angle exit. Keep **`yawAssist`**
and **`maxDriftAngle`**, with their existing defaults **0.4** and **55°**.

Success means a human holds a controlled drift for **at least five seconds at
Default**, after both steering-plus-throttle entry and handbrake entry. The law
below is an implementation proposal, not a claim that this acceptance test has
already passed. [Design §3, §6.8 and §7.2](../vertical-slice-design.md)

## What to borrow from other racers

These sources establish public mechanics, not undocumented internal controllers.
The lessons in the right column are our design inferences. Checked 2026-09-20.

| Reference | Supported mechanic | Lesson for the lab |
|---|---|---|
| **Ridge Racer** | Namco distinguishes Dynamic cars that sustain/reorient drifts easily but need care to exit, Mild cars that exit easily, and balanced Standard cars. Ridge Racer 6 charges nitrous through drifting, with higher-speed drifts earning more. [Drift types][ridge] · [Nitrous][nitrous] | Entry, sustain and exit need separate evaluation. Copy the drift-to-speed reward loop; avoid making every preset an endless slide. |
| **Mario Kart 8 Deluxe** | Nintendo teaches accelerate + hold R + steer to enter, visible sparks to communicate charge, release R to cash out a mini-turbo. [Nintendo guide][mario] | Give the player an unmistakable entry and feedback during a hold. Our handbrake must still change rear grip; do not turn it into a mandatory held drift button. |
| **Absolute Drift** | Its developer teaches a brief handbrake tap, counter-steering and throttle; speed/steering alone can also initiate. Steering assist can be disabled. Tire tracks and ghosts help learning. [Developer tutorial][absolute] | Closest reference for the two required entry methods and assist-off learning. Make wheel direction and skid marks readable. |
| **art of rally** | Funselektor explicitly supports beginner-friendly options alongside counter-steering, Scandinavian flicks, left-foot braking and handbrake turns. [Developer site][rally] | Preserve weight transfer and throttle consequences. Accessible handling need not erase the tire model. This source does not disclose assist equations or gains. |
| **Burnout Paradise** | The official manual separates brake/handbrake, rewards dangerous driving with boost, and gives different boost rules to Speed, Stunt and Aggression cars. [EA manual, pp. 3, 14–16][burnout] | Keep speed and danger emotionally rewarding. The manual is not evidence for a particular drift servo; do not present a guessed Burnout torque model as fact. |
| **Distance** | Refract describes survival racing with a car that boosts, jumps, rotates and flies. [Developer press kit][distance] | Useful for recovery agency and vehicle readability, not proof of an angle-holding road-drift algorithm. Air control remains separate from grounded C. |
| **Inertial Drift / ModNation Racers** | Inertial Drift separates steering and drifting across two sticks. ModNation's designer describes steering during sustained drifts that earn boost. [Publisher][inertial] · [Designer][modnation] | Drift angle should feel like a controllable variable. We can express that through the existing steering axis during sliding, without adding inputs. |

## What is risky in the published C

At Default, `s_f = 0` requests `(3 + 55) / 2 = 29°`, regardless of entry angle.
That can turn a caught 14° slide into an unsolicited deeper drift. Recomputing
`sign(beta)` every step can switch targets around zero, while maximum
counter-steer still requests 3° rather than a clean exit. An independently added
soft limiter can also accidentally remain active with `yawAssist = 0`.

Keep the useful part: damp **change in slip angle**, not yaw rate itself. A car
holding constant slip around a circle must keep yawing as its velocity direction
turns. Damping yaw toward zero would fight the corner.

## Recommended C: explicit state, bounded torque

All angles below are radians in code. Named values in degrees are converted once.
Use the design's filtered steering `s_f`, filtered throttle `T`, chassis yaw inertia
`I_yaw`, and fixed physics `dt`. The additional constants are research starting
points, not new sliders or edits to the approved schema.

1. **Enter from a real slide.** While at least three wheels are grounded and
   forward speed exceeds 3 m/s, latch when `|beta| >= 10°` and there is entry intent:
   handbrake, or `T > 0.2 && |s_f| > 0.1`. Set `d = sign(beta)`,
   `holdAngle = clamp(|beta|, 14°, min(30°, maxDriftAngle))`, and
   `betaTarget = beta`. Holding state does not require keeping the handbrake down.
2. **Let the stick request angle.** With `u = clamp(d * s_f, -1, 1)`, compute
   `angleWanted = u >= 0 ? lerp(holdAngle, maxDriftAngle, u) : holdAngle * (1 + u)`.
   Desired signed target is `d * angleWanted`. Neutral retains the captured angle;
   full input into the turn asks for the maximum; full counter-steer asks for zero.
   With handbrake released, multiply the desired target by
   `smoothstep(0.05, 0.25, T)`, so lifting requests recovery.
3. **Change targets smoothly.** Move `betaTarget` toward that desired target by
   at most `90°/s * dt`. Re-clamp the captured angle if `maxDriftAngle` is changed
   live. Compute `betaDotRaw = wrapPi(beta - previousBeta) / dt`, then filter with
   `betaDot += (1 - exp(-dt / 0.05)) * (betaDotRaw - betaDot)`.
   Reset derivative history on entry, respawn and teleport.
4. **Apply the following torque**, combined with A and B as described below.
5. **Exit with hysteresis.** Clear the latch after `|beta| < 6°` for 0.10 s, on a
   slip-sign crossing, or when the grounded/forward-speed condition fails. A new
   opposite slide must cross the entry threshold again. Outside the latch, C is zero.

```text
gate       = groundedWheels >= 3 ? smoothstep(3, 10, v_long) : 0
w_slide    = smoothstep(6°, 14°, abs(beta))

alphaTrack = 25 * (betaTarget - beta) - 10 * betaDot
excess     = max(0, abs(beta) - maxDriftAngle)
outward    = max(0, sign(beta) * betaDot)
limitBlend = smoothstep(maxDriftAngle, 1.15 * maxDriftAngle, abs(beta))
alphaLimit = -sign(beta) * limitBlend * (60 * excess + 10 * outward)

tau_C = I_yaw * yawAssist * gate * w_slide
        * clamp(alphaTrack + alphaLimit, -15, +15)
```

The existing 25 s⁻² position gain, 10 s⁻¹ damping and 15 rad/s² cap stay intact.
The limiter shares C's torque budget and assist strength: it is a soft intervention,
not a guaranteed angle wall. At Default, C's maximum angular acceleration is
6 rad/s² once its gates are fully on. No hidden correction survives `yawAssist=0`.

Use `beta = atan2(v_lat, v_long)` in the forward-driving domain; it agrees with
the design's absolute-denominator form there. Disable/reset C for backward motion;
do not mistake the folded angle beyond 90° for a recoverable forward drift.
Positive yaw torque increases positive `beta` under the design's -Z-forward,
+X-right convention. The limiter opposes whichever sign is actually excessive.

Counter-steer A still changes the front wheel angle, using its own slider. B keeps
its published `w_grip = 1 - w_slide`; do not stack full grip and slide assists.
Apply C about chassis up, transformed to world space. Tires still determine the
path; this controller does not rotate linear velocity or invent lateral grip.

## If the published structure fails in playtesting

| Observed failure | Change to try, in this order |
|---|---|
| Sudden deeper slide, side switching, or drift that refuses to end | Use the captured target, latched sign, target slew and zero-angle exit above before raising gains. |
| Angle oscillates even with a steady target | Inspect derivative resets/filtering and tire lag; reduce position gain or increase damping using an A/B build. Do not differentiate noisy render transforms. |
| Angle is stable but the car runs wide or loses all speed | Examine tire lateral force and combined-slip/drive saturation. Torque cannot bend the velocity vector by itself. Test existing post-peak grip and recovery knobs, and send any proposed default changes through the PM. |
| Steering + throttle never reaches entry, while handbrake works | C cannot help before its entry gate. Check B's torque sign, front/rear loads and rear saturation first. If needed, propose a brief capped entry torque, gated by sustained throttle/steer demand and near-limit rear grip, scaled by `yawAssist`; never fake a permanent rear-grip loss. Treat it as a separate experiment. |
| The angle PD still fights the rotating path | Replace its tracking term with a velocity-heading-aware yaw-rate servo (below), retaining state, limits and public parameter names. Compare on the same recorded entry, then with a human. |

Alternative tracking term: estimate the horizontal velocity heading rate
`thetaDot` from physics velocity/acceleration and filter it over 50 ms. Set
`rTarget = thetaDot + clamp(3 * (betaTarget - beta), -1.5, 1.5)` and
`alphaTrack = (rTarget - omega_y) / 0.15`; retain the same final acceleration cap,
limiter, weights and `yawAssist`. Since `betaDot = omega_y - thetaDot`, this is a
related controller with explicit path-turn feedforward, not magic extra grip.
Guard the heading-rate estimate at low speed and reset after impacts/teleports.

## Five-second acceptance session

Use **Default**, 120 Hz, normal time, gamepad first, boost off. On the ring at
roughly 35–45 m/s, test steering-plus-throttle entry with no handbrake, then a brief
handbrake entry followed by release. Repeat left and right; then repeat both entry
methods on keyboard with the existing input ramps. Save F9 telemetry and video.

A successful attempt has five continuous seconds of intentional sliding while
the player can adjust the line, followed by a deliberate recovery. Record time
above `driftMinAngle`, angle overshoot, speed loss, steering demand and torque
saturation; these explain a failure, but no numeric trace replaces the human
judgment. Do not count a wall scrape, endless spin, or automated orbit as success.
Also compare Raw: zero assist must remove both tracking and the soft limiter.

Before that session, check mirrored torque signs, neutral/exit targets, exact
zero-assist output, and equivalent responses at 60/120/240 Hz. An isolated angular
model can check controller arithmetic; it cannot certify tire-model behavior or
the five-second acceptance criterion.

Recall: `deja "drift assist"` found the PM and techwriter briefing sessions
(`7ebecf16-292`, `7d6db575-cdb`), repeating the approved design. No independent
prior control-law finding was reused.

[ridge]: https://www.bandainamcoent.co.jp/cs/list/ridgeracers_psp/newridge/drift.php
[nitrous]: https://www.bandainamcoent.co.jp/cs/list/ridgeracer6/system/
[mario]: https://www.nintendo.com/jp/ichikara/aabpa/index_en.html
[absolute]: https://blog.playstation.com/2016/08/04/absolute-drift-zen-edition-launches-august-16-on-ps4/
[rally]: https://www.artofrally.com/
[burnout]: https://eaassets-a.akamaihd.net/eahelp/manuals/bpr-pc-en.pdf
[distance]: https://refractstudios.com/press/distance/index.html
[inertial]: https://pqube.co.uk/news/inertial-drift-twilight-rivals-edition-out-now/
[modnation]: https://blog.playstation.com/2010/03/19/modnation-racers-redesigning-kart-racing/
