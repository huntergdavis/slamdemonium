# Glossary

Plain-language definitions of the terms you meet in the Options page, the HUD and the [Tuning Playbook](TUNING_PLAYBOOK.md). Each entry points to the section of the [design doc](vertical-slice-design.md) where the idea is defined. Where the shipped behavior has moved on from the design doc, the entry says so and points to the research note that replaced it. Parameter names in `code` are sliders in the Options page.

Units are metric throughout: meters, kilograms, seconds. Speeds show in km/h on the HUD and m/s in most sliders. Angles show in degrees.

## The car and how it moves

**Rigid body.** The car is one solid box that the physics engine moves around. Everything that makes it behave like a car (suspension, tires, engine, assists) is a set of forces added to that box every physics step. Design 6.1.

**Chassis axes.** Forward, right and up, from the car's point of view. Turning left is a positive rotation about the up axis. Sliding to the right is positive lateral velocity. Design 5.1.

**Longitudinal and lateral.** Along the car (forward and back) versus across it (side to side). Longitudinal acceleration is throttle and braking. Lateral acceleration is cornering. Design 5.1.

**Yaw rate.** How fast the car is rotating about its up axis, in degrees or radians per second. A car turning left has positive yaw rate. Shown on the HUD graphs. Design 5.1, 6.11.

**Slide angle (beta).** The angle between where the car is pointing and where it is actually travelling. Zero when driving straight, large in a drift. The HUD shows it as a horizontal bar from -90 to +90 degrees. Design 5.1, 12.1.

**Slip angle.** The same idea for one wheel: the angle between where the wheel points and where its contact patch is moving. Tires make cornering force by having a small slip angle. Past the peak angle, grip falls off and the wheel slides. Design 6.5.2.

**Peak slip angle (`peakSlipAngle`).** The slip angle where a tire produces its most cornering force. Higher is lazier and more forgiving; lower is sharper. Design 6.5.2.

**Slip curve.** The shape that turns slip angle into grip: it rises to a peak, then falls to a sliding level. The Tires group plots it live. `slipFalloffRate` sets how fast it falls (a cliff or a gentle slope) and `slideGripRatio` sets where it lands. Design 6.5.2, 8.4.

**Slide grip ratio (`slideGripRatio`).** How much grip is left once a tire is sliding, as a fraction of its peak. Near 1 means slides are sticky and easy to recover; low means loose and long. Design 6.5.2.

**Weight transfer.** Under braking, weight moves to the front wheels; under acceleration, to the rear; in a corner, to the outside. Because it emerges from the suspension model, changing `comHeightOffset` or `tireForceHeight` changes how much of it you feel. Design 6.1, 6.5.6.

**Center of mass (CoM).** The balance point of the car. `comHeightOffset` moves it up or down (lower rolls less), `comLongOffset` moves it forward (more understeer) or back (more oversteer). Design 6.2, 7.2.

**Inertia.** Resistance to being spun. `yawInertiaScale` makes the car harder or easier to rotate; `pitchRollInertiaScale` does the same for nose-dive and body roll. Design 7.2.

**Understeer and oversteer.** Understeer: the front loses grip first and the car runs wide. Oversteer: the rear loses grip first and the tail steps out. Rear grip lower than front gives oversteer. Design 7.4.

## Tires and grip

**Grip (mu, friction coefficient).** How much sideways or braking force a tire can make per unit of load pressing it into the road. `gripFront` and `gripRear` are the peak values; `surfaceGrip` scales both (a wet-road test). Design 6.5.1.

**Normal load (Fz).** The force pushing a wheel into the pavement: its share of the car's weight, plus suspension motion, plus downforce. More load means more grip, but not proportionally (see load sensitivity). Design 6.4, 6.5.1.

**Load sensitivity (`loadSensitivity`).** Tires get slightly less effective per unit of load as load rises. It is why weight transfer matters: the heavily loaded outside tires do not gain as much as the inside tires lose. Zero turns the effect off. Design 6.5.1.

**Grip usage.** How much of a tire's available grip is being used right now, from 0 to 1. The HUD shows four bars, one per wheel, turning red past 1.0 when the wheel is sliding. Design 6.11, 12.1.

**Friction ellipse (friction circle).** A tire has one budget of grip to spend on cornering and braking or acceleration combined. Hard braking mid-corner steals cornering grip. `combinedSlipCoupling` sets how strictly the budget is shared: 1 is a strict circle, 0 makes the two independent. Design 6.5.4.

**Relaxation length (`tireRelaxationLength`).** Real tires build force over a short rolling distance rather than instantly. This slider is that distance. Short is twitchy and immediate; long is lazy and floaty. Design 6.5.3.

**Downforce (`downforceAtTopSpeed`).** Extra force pressing the car down that grows with the square of speed, like a wing. Expressed as a multiple of the car's weight at top speed. It makes fast corners grippier without changing slow ones. Design 6.7.4, 7.2.

**Locked and spinning.** A wheel is locked when braking asks for more force than the tire can deliver, and spinning when the throttle does. Both leave skid marks. ABS strength (`absStrength`) limits lock-up. Design 6.5.4, 6.7.2.

## Suspension

**Ride frequency (`suspFrequency`).** Suspension stiffness expressed as how many times per second the body would bounce if you pushed it down and let go. Around 1 Hz is soft and boaty; above 3 Hz is stiff. Design 6.4.

**Damping ratio (`suspDampingRatio`).** How quickly a bounce dies out. Below about 0.3 the body keeps oscillating; near 1 it settles in one motion; above 1 it feels dead. Design 6.4.

**Rest length and travel (`suspRestLength`, `suspMaxTravel`).** Ride height when parked, and how far the suspension can compress before hitting a stiff bump stop. Design 6.4.

**Anti-roll (`suspAntiRoll`).** A stiffness that links the left and right wheels of an axle, resisting body roll in corners without stiffening straight-line ride. Design 6.4.

**Tire force height (`tireForceHeight`).** Where tire forces are applied, from the road surface (0, realistic, lots of pitch and roll) up to the center of mass (1, almost no body motion). An arcade trick. Design 6.5.6.

## Steering, braking and drive

**Speed-sensitive steering.** Maximum steering lock shrinks as speed rises, from `steerMaxLowSpeed` at a standstill to `steerMaxTopSpeed` at top speed. `steerSpeedExp` shapes how early the shrink happens. Design 6.6.

**Steering expo and dead zone (`steerExpo`, `steerDeadzone`).** Gamepad only. Expo softens small stick movements so the center is calm. Dead zone ignores tiny stick drift near center. Design 6.6.

**Rise and return time.** Keyboard only. How long a tap takes to reach full steering or full throttle, and how long it takes to come back. These make digital keys feel like an analog pedal. Design 6.6, 7.2.

**Brake curve (`brakeCurveExp`).** The shape of the brake pedal. 1 is linear; higher gives a soft first half and a strong second half. Design 6.7.2.

**Brake bias (`brakeBiasFront`).** The share of braking on the front axle. More front is stable; more rear helps rotate the car into a corner but risks a spin. Design 6.7.2.

**ABS (`absStrength`).** Anti-lock braking. At 1 the wheels never lock; at 0 a locked wheel only delivers sliding friction, so stops are longer and leave marks. Design 6.7.2.

**Handbrake.** Temporarily cuts rear grip to `handbrakeRearGrip` and adds rear braking, so the tail steps out. `handbrakeRecoveryTime` sets how long grip takes to return after release, a big part of drift feel. Design 6.7.3.

**Drive bias (`driveBias`).** The share of engine force sent to the rear wheels. 0 is front-wheel drive, 1 is rear-wheel drive. More rear makes the tail step out under power. Design 6.7.1.

**Power curve (`accel0`, `topSpeed`, `powerCurveExp`).** The engine is a curve of acceleration versus speed: `accel0` at a standstill, zero at `topSpeed`, with `powerCurveExp` controlling how long it stays strong in between. No gears. Design 6.7.1.

**Coast deceleration (`coastDecel`).** How quickly the car slows when you lift off the throttle, standing in for engine braking and drag. Design 6.7.1.

## Assists

**Assist.** A helping force added on top of the tire model to make sliding fun and catchable. Every assist has a strength slider that goes to zero, and at zero nothing hidden remains, including the drift limiter. The Raw preset turns them all off. Design 6.8, 7.3.

**Counter-steer assist (`countersteerAssist`).** Automatically steers the front wheels toward the direction of travel when the car slides, the way an experienced driver would. Design 6.6, 6.8 A.

**Yaw assist (`yawAssist`).** Two jobs with one slider. While gripping, it helps the car rotate at the rate your steering asks for (crisp turn-in). While sliding, it becomes drift angle control, and it also scales the drift limiter. Design 6.8 B and C.

**Drift angle control.** Once the car is in a real slide, steering stops meaning "rotate faster" and starts meaning "how far sideways". Stick neutral holds the angle you entered with. Steer into the slide for more, up to `maxDriftAngle`. Counter-steer fully and the car aims for zero, which is how you exit cleanly. Lifting the throttle (with the handbrake released) also asks the car to straighten. This is what makes a drift holdable and catchable. The shipped control law replaces the one printed in design 6.8 C; see the [drift assist note](research/drift-assist.md).

**Latched drift side.** When a slide begins, the game remembers which way you are sliding and keeps that decision until the drift ends. It stops the assist from flip-flopping when the car passes through straight. A new slide the other way has to start fresh. [Drift assist note](research/drift-assist.md).

**Captured neutral angle.** The slide angle you had when the drift began, kept between about 14 degrees and 30 degrees. With the stick centered, drift angle control holds this angle rather than some fixed number, so a gentle catch stays gentle. [Drift assist note](research/drift-assist.md).

**Drift exit.** The drift ends once the slide angle stays under about 6 degrees for a tenth of a second, or the car crosses to the other side. The small delay stops the assist from switching on and off around zero. [Drift assist note](research/drift-assist.md).

**Drift limiter (soft limit).** Past `maxDriftAngle` a restoring push blends in, reaching full strength about 15 percent beyond it, so a slide does not become a spin by accident. It shares the drift control's torque budget and scales with `yawAssist`, so it is a soft nudge rather than a wall, and at `yawAssist` zero it is gone. Design 6.8 C, replaced by the [drift assist note](research/drift-assist.md).

**Air control and anti-flip.** Small automatic corrections that land jumps flat and right a car that has rolled onto its side. Not sliders. Design 6.8 D and E.

## Boost and drift meter

**Drift meter.** Fills while the slide angle stays above `driftMinAngle` at speed. It charges faster at bigger angles and higher speeds (`driftChargeRate`) and does not decay when the drift ends. Design 6.9.

**Boost.** Spends the drift meter for extra acceleration (`boostAccelMult`) and extra top speed (`boostTopSpeedAdd`) while held, draining at `boostDrainRate`. Also kicks the field of view and camera shake. Design 6.9, 6.7.1.

## Camera

**Field of view (FOV).** How wide a slice of the world the camera shows, measured in vertical degrees. `fovBase` sets it at rest; `fovSpeedGain` widens it with speed and `fovBoostKick` widens it further while boosting. A widening view is one of the strongest cues that you are accelerating. Design 10.1.

**FOV cap.** The delivered field of view is clamped to a ceiling, initially 115 degrees vertical, because boost pushes speed past `topSpeed` and the raw formula would keep widening without limit. When the cap is active, raising FOV sliders changes nothing, and the debug text shows the delivered FOV and whether the cap is engaged. Slider ranges are unchanged. [Speed and vibe note](research/speed-and-vibe.md#camera-finding-the-existing-fov-curve-needs-a-final-bound).

**Velocity blend (`camVelocityBlend`).** Whether the camera looks along the car's nose (0) or along its direction of travel (1). Halfway shows the slide without hiding turn-in. Design 10.1, 7.2.

**Camera shake (`camShake`).** Small, speed-scaled motion that suggests mass and speed. Zero removes it. Design 10.1.

## Time and simulation

**Fixed timestep.** Physics advances in steps of exactly the same length (default 1/120 s, from `physicsHz`) no matter how fast your screen refreshes. This keeps behavior identical on a 60 Hz and a 144 Hz display. Design 5.2.

**Interpolation.** The screen usually refreshes between two physics steps. The renderer blends the car's previous and current physics positions so motion looks smooth at any frame rate. Design 5.2.

**Time scale (`timeScale`).** Slow motion. It changes how many physics steps run per real second, never the length of a step, so what you see at 0.25x is exactly what happens at full speed. Hotkey T toggles 0.25x. Design 5.2, 7.2.

**Physics rate (`physicsHz`).** Steps per simulated second. Changing it should not change the feel; if it does, that is a bug in the model, not a tuning choice. Design 6.10.

**CCD (continuous collision detection).** At 300 km/h the car moves about 0.7 m per step, enough to pass straight through a thin wall between two steps. CCD sweeps the motion so the wall is always hit. Design 4.2.

**Latency probe.** Hotkey L. Flashes the screen when a key is pressed and again when the resulting frame appears, then reports the delay over 100 samples. The target is under two display frames. Design 5.2, 11.3.

**Determinism.** The same starting state and the same recorded inputs produce the same result every run. Used by the automated tests, and it is why the hot path avoids anything random. Design 3.

## The Options page

**Parameter.** One tunable number with a name, unit, default, range and help text. There are 70 of them, grouped as World, Chassis, Engine, Brakes, Tires, Steering, Suspension, Boost & Drift, Collision and Camera. Design 7.1, 7.2.

**Quick Tune.** The pinned section at the top of the Options page with the 14 sliders that change the feel most. Design 7.2, 8.1.

**Live apply.** Every slider takes effect on the next physics step, with no reload. Design 8.1.

**Needs rebuild.** The few mass-related parameters (mass, center-of-mass offsets, inertia scales) that update the car's physical body when changed. They apply within 200 ms and do not move or stop the car. Design 7.1, 8.1.

**Preset.** A named set of parameter values applied over the defaults. Default, Grip, Drifty and Raw ship with the game; you can save your own. Design 7.3, 8.3.

**A/B slot.** Two complete parameter sets you can swap instantly while driving. Press Tab with the game focused, or use the A/B buttons in the panel; the HUD shows which is live. Change one thing in B, drive, swap, compare. Design 8.5.

**Change log.** A record of every slider move (time, parameter, old value, new value), included in exported JSON so you can trace which change made the car feel better. Design 8.3.

**Share link.** Your changed-from-default values encoded into the page URL. Anyone who opens the link gets your exact setup. Design 8.3.

**Tire curve plot.** The small graph at the top of the Tires group. It draws the slip curve for front and rear tires, with a moving dot showing where each axle is operating right now. Design 8.4.

## The HUD

**HUD (heads-up display).** The overlays drawn on top of the game. H cycles full, minimal and off. Design 12.1.

**Slide angle gauge.** Horizontal bar showing the slide angle from -90 to +90 degrees, with a marker at `driftMinAngle` so you can see when a slide starts counting as a drift. Design 12.1.

**G-G diagram.** A scatter plot of longitudinal acceleration (up and down) against lateral acceleration (left and right), with a reference circle at the tire limit. Dots near the circle mean you are using all the grip available. Design 12.1.

**Per-wheel bars.** Four bars showing grip usage on each wheel (red past 1.0) and the load on it. Design 12.1.

**Scrolling graphs.** Ten-second traces of speed, slide angle, yaw rate, lateral G, and front and rear slip angle. Design 12.1.

**Telemetry.** Every number the car model exposes each step: speeds, angles, forces, pedal positions, meters and timing. The HUD draws it; F9 records it to a CSV file for analysis. Design 6.11, 12.2.

**Debug gizmos.** Hotkey G. Lines and markers drawn in the 3D scene showing contact points, forces and wheel states. Design 11.1.

**Gate.** Not a game term, but you may see it in the design doc: a milestone demo (G0 to G5) that proves a piece of the lab works. Design 14.
