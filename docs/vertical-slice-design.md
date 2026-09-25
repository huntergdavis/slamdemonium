# Web Arcade Racer: Vehicle Feel Vertical Slice

**Design document, v0.1** (2026-09-20)
**Owner:** Hunter
**Audience:** the command-and-control agent and the implementation team it directs
**Working title:** TBD (do not hard-code a product name anywhere; use a single `GAME_NAME` constant)

---

## 0. How to use this document

This document is the brief for the first full vertical slice of a browser-based arcade racing game. It is meant to be read top to bottom once by the orchestrating agent, then used as a reference by each work package (section 14).

Conventions:

- **MUST / MUST NOT** are requirements the slice cannot ship without. **SHOULD** is strong guidance that can be deviated from with a written reason. **MAY** is optional.
- Anything in a table of default values is a **starting guess**, not a truth. The whole point of the slice is that a human will tune these by feel. Do not "fix" a default because it looks unrealistic; make it easy to change.
- Decisions already made are stated as decisions. Open questions are collected in section 16. If you hit an open question that blocks you, pick the option marked "default" there, note it in `docs/DECISIONS.md`, and keep going.
- Units are SI everywhere in code (meters, kilograms, seconds, radians internally). Degrees and km/h appear only in the UI and in this document where marked.

---

## 1. Vision and the goal of this slice

We are building a fast, loud, crash-happy arcade racer that runs in a browser tab. Earlier attempts at this genre on the web and in ports tend to fail on one thing: **the driving does not feel right.** It is either too floaty, too simulation-heavy, or too sticky, and the speed never registers in the player's body.

So the first milestone is not a game. It is a **driving-feel laboratory**:

> A plain box drives around a big paved circle in 3D. Every number that shapes how it accelerates, brakes, grips, slides and drifts is a slider on an options page that applies live. Overlays show what the physics is doing. A human can sit in it for an hour and find the fun.

If the box feels fast and fun on flat pavement, everything else (car models, crashes, traffic, other cars) is content on top of a foundation that works. If it does not, no amount of content will save it.

### What "feels right" means (design pillars)

1. **Speed is felt, not read.** Acceleration is punchy, the world streams past, the camera and field of view respond to speed. The speedometer is decoration.
2. **Drifting is a skill that is easy to start and rewarding to hold.** The car grips hard, then lets go progressively enough that a player can catch it. Sliding sideways at speed feels intentional and controllable, and it charges the boost meter.
3. **Braking is powerful and predictable.** Late braking is a valid tactic. Braking response is tunable through a real curve, not a single number.
4. **Assists are dials, not walls.** Every arcade-style assist (counter-steer help, yaw help, drift angle limits) is a slider that goes to zero. We must be able to feel the raw tire model with everything off and then add back only what is fun.
5. **Tunability beats correctness.** Any physical shortcut is fine if it feels better and has a slider.
6. **Latency is a feature.** Input-to-motion delay is measured and minimized (section 5.2).

---

## 2. Scope

### 2.1 In scope for this slice

- 3D driving of one box-shaped vehicle on a flat paved circular track plus paved infield, in a browser.
- A custom arcade vehicle dynamics model (section 6) running on top of a real rigid-body physics engine (section 4).
- An **Options page** with sliders for 69 parameters, live-applied, with presets, save/load, import/export and A/B comparison (sections 7 and 8).
- A **debug/telemetry HUD** with overlays that make tuning possible (section 12).
- A chase camera with speed-reactive FOV and drift-aware framing (section 10).
- Keyboard and gamepad input (section 11).
- Simple boost mechanic and drift-charged boost meter, because they change the physics feel and must be tuned together with it.
- Slow-motion time scale (a slider and hotkey), because it is a core future mechanic and stresses the timestep design.
- Automated tests and performance measurement (section 13).

### 2.2 Explicitly out of scope (do not build yet)

- Car models, textures beyond procedural ones, liveries.
- Collisions between multiple cars, traffic, AI opponents, race rules, laps, scoring UI.
- Soft-body or deformable car bodies (section 15 explains the plan so we do not paint ourselves into a corner).
- Audio (optional stretch, section 10.5).
- Menus, accounts, networking, saving to a server.
- Any track other than the test circle.

---

## 3. Success criteria (acceptance)

The slice is done when **all** of the following are true. Each is testable.

**Feel and function**

- [ ] A build served from a static host loads in Chrome, Safari and Firefox on desktop and reaches a drivable state in under 5 seconds on a typical broadband connection.
- [ ] With default values, the car does 0 to 100 km/h in 2.0 to 2.3 s and 0 to 55 m/s in 6.3 to 7.1 s (verified by an automated test reading telemetry).
- [ ] Changing any slider on the Options page changes the car's behavior within one frame, with no reload. Exceptions flagged `needsRebuild` (mass properties) apply within 200 ms without resetting position.
- [ ] The car can be put into a controlled drift on the circle using (a) steering plus throttle and (b) handbrake, and held for at least 5 seconds by a human using default values.
- [ ] Each of the three shipped presets (Grip, Drifty, Raw) is distinguishable by a human blind test within 30 seconds of driving.
- [ ] All assists can be set to zero and the car remains drivable (it may be twitchy; it must not explode or produce NaNs).

**Engineering**

- [ ] Physics runs on a fixed timestep (default 120 Hz), independent of display refresh rate, with render interpolation. Verified at 60 Hz and 144 Hz display rates.
- [ ] `timeScale` from 0.05 to 2.0 changes simulation speed without changing the physics timestep and without instability (verified by test).
- [ ] Sustained 60 FPS on an M-series MacBook Air in Chrome or Safari at 1080p-equivalent render size, with physics step plus vehicle model under 1.0 ms per step on average.
- [ ] 5 minutes of scripted driving produces no NaN or Infinity values and no growth in JS heap beyond a stable band (no per-frame allocations in the hot path).
- [ ] Same seed plus same recorded input produces the same final state on repeated runs in the same browser (determinism test; cross-browser determinism is a MAY).
- [ ] `npm test`, `npm run e2e` and `npm run build` all pass in CI.

---

## 4. Technical decisions

### 4.1 Stack (decided)

| Layer | Choice | Version checked on 2026-09-20 | Why |
|---|---|---|---|
| Language | TypeScript, `strict: true` | typescript 7.0.2 | Types catch unit and vector mistakes early. |
| Build/dev server | Vite | vite 8.3.0 | Fast HMR matters: tuning code changes should reload in under a second. |
| Renderer | three.js with `WebGLRenderer` | three 0.186.0 | Most mature ecosystem. `WebGPURenderer` exists and can be evaluated later; do not adopt it for the slice. |
| Physics | **Jolt Physics via `jolt-physics` (WASM)**, behind an adapter | jolt-physics 1.1.0 | See 4.2. |
| Physics fallback | Rapier via `@dimforge/rapier3d-compat` | 0.20.0 | Only if the Day-1 spike fails. |
| Tests | Vitest (unit), Playwright (end to end) | vitest 5.0.1, @playwright/test 1.63.0 | Headless Chromium is available in the environment. |
| Tuning UI | Custom DOM UI generated from a schema (no heavy framework) | n/a | We need sliders, numeric inputs, presets, a live tire-curve plot, A/B slots. `lil-gui` or `tweakpane` MAY be used for the debug-only extras but not as the main Options page. |

Versions above are what the public package registry reported when this document was written. Pin exact versions in `package.json` and record any upgrade in `docs/DECISIONS.md`.

### 4.2 Physics engine selection

The important insight is that **we write our own vehicle dynamics** (section 6). Arcade handling is a set of tuned forces, not a faithful simulation, and no general vehicle library will give us the parameters we want. So the engine's job is narrow but critical: integrate rigid bodies stably, resolve contacts, run ray casts, and later handle many colliding bodies at high speed.

Requirements that drove the choice:

1. Stable at speeds up to about 85 m/s (about 300 km/h) with thin walls. At 120 Hz that is about 0.7 m of travel per step, so **continuous collision detection** (CCD) is mandatory.
2. Scales to 20 to 40 dynamic bodies later (multi-car pileups) within a few milliseconds per frame.
3. Room to grow toward soft-body-like effects, ragdolls and slow motion.
4. Good ray cast API (for suspension) and a way to apply forces and torques at points.
5. Runs in a plain browser build with no special server headers for the slice.

| Option | Assessment | Verdict |
|---|---|---|
| **Jolt (`jolt-physics`)** | WASM port of a modern, high-performance C++ engine used in shipped AAA games. The JS bindings expose nearly the whole C++ interface, including vehicle constraints, soft bodies, ragdolls and CCD (motion quality "linear cast"). Multithreaded builds exist (they need cross-origin isolation headers; the slice uses a single-thread build). The repository also mentions a cross-platform deterministic build mode; the team MUST check whether the prebuilt npm package exposes it or whether it needs a source build. Downsides: C++-style API with manual memory management (`Jolt.destroy` for objects created with `new`), larger WASM payload, less friendly docs than JS-native engines. | **Chosen** |
| Rapier (`@dimforge/rapier3d-compat`) | Rust compiled to WASM with an ergonomic JS API and documented **cross-platform determinism** in the JS build. Has CCD. No built-in soft-body support as far as I know. Smaller and simpler than Jolt. | **Fallback**, and the reference implementation if Jolt's integration cost is too high |
| Havok (`@babylonjs/havok`) | Very capable, but a proprietary binary tied to the Babylon.js ecosystem. Poor fit with a three.js stack and adds lock-in. | Not chosen |
| cannon-es | Pure JS, easy to use, but slower and not competitive for many fast bodies. | Not chosen |
| Ammo.js (Bullet port) | Has soft bodies and a raycast vehicle, but it is an aging port with a heavy payload and awkward API. | Not chosen |
| Own integrator (no engine) | Fastest way to a driving box on a plane. Gets thrown away at the first collision. | Not chosen |

**Day-1 spike (time box: one working day).** Before anything else, one engineer stands up Jolt in the Vite + three.js scaffold and proves: (a) a dynamic box on a static ground, stepped at 120 Hz; (b) applying a force at a world point and a torque each step; (c) a downward ray cast against the ground returning hit distance and normal; (d) CCD enabled on the box hitting a thin wall at 85 m/s; (e) step time for 1 box under 0.2 ms; (f) production `vite build` works and the WASM loads. If any of (a) to (f) is a blocker after the time box, switch to Rapier. Because all engine access goes through the adapter (5.3), the switch must not touch vehicle, camera, UI or track code. Record the outcome in `docs/DECISIONS.md`.

**Slice uses Jolt's single-thread WASM build.** No SharedArrayBuffer, no COOP/COEP headers, works on any static host.

---

## 5. Architecture

### 5.1 Coordinate system and conventions

- Right-handed, **Y up**, meters, kilograms, seconds.
- Vehicle local axes: **+X right, +Y up, -Z forward** (matches three.js camera convention).
- Positive rotation about +Y is counter-clockwise seen from above, which is a **left turn**. So: steering angle `delta > 0` means wheels turned left; yaw rate `omega_y > 0` means turning left.
- Lateral velocity `v_lat > 0` means moving to the car's right. Body slip angle `beta = atan2(v_lat, |v_long|)`. A car sliding to the right has `beta > 0`, and its front wheels must steer right (negative `delta`) to point along the velocity.
- Write these conventions at the top of `src/vehicle/README.md` and unit-test the sign of every assist.

### 5.2 Main loop: fixed timestep, interpolation, latency

The loop is the most important piece of infrastructure in the project. Get it right first.

```
frame(nowMs):
  frameDt = min((nowMs - lastMs) / 1000, 0.1)          // clamp to avoid spiral of death
  accumulator += frameDt * tuning.timeScale             // slow-mo scales what is fed in, NEVER the step size
  while accumulator >= FIXED_DT:                        // FIXED_DT = 1 / tuning.physicsHz
      input.sampleForStep()                             // latest input state, sampled immediately before the step
      vehicle.preStep(FIXED_DT)                         // suspension, tires, drivetrain, assists -> forces
      physics.step(FIXED_DT)
      vehicle.postStep(FIXED_DT)                        // telemetry, wheel visuals state, skid emission
      accumulator -= FIXED_DT
  alpha = accumulator / FIXED_DT
  render(interpolate(prevState, currState, alpha))      // position lerp, quaternion slerp
```

Rules:

- **MUST** step physics only with the constant `FIXED_DT`. Slow motion changes how many steps happen per real second, never the length of a step.
- **MUST** interpolate rendered transforms between the previous and current physics state so the picture is smooth at any display rate. The camera follows the interpolated transform.
- **MUST** clamp the maximum number of steps per frame (default 8) and drop excess time, so a background tab does not cause a catch-up storm. Pause when the tab is hidden.
- **MUST NOT** allocate objects, arrays or closures in `preStep`, `postStep` or the render loop. Preallocate all vectors and quaternions. Use a small in-house math scratchpad or three.js objects reused across calls.
- Input sampling happens once per physics step, immediately before it, from the latest event state. This keeps input latency below one physics step plus one frame.
- Provide a **latency probe**: a debug key that flashes the screen when a key event is received and when the resulting frame is presented (`requestAnimationFrame` timestamp), and reports the delta over 100 samples. Target: input event to next presented frame under 2 display frames.

### 5.3 Module layout and the physics adapter

```
/
  index.html
  package.json, tsconfig.json, vite.config.ts
  docs/
    DECISIONS.md          // running log of choices and spike results
    TUNING_PLAYBOOK.md    // copy of section 7.4, kept in sync
  src/
    main.ts               // boot, wiring, top-level loop
    core/                 // loop.ts, time.ts, events.ts, math scratch, seeded rng
    physics/
      adapter.ts          // IPhysicsWorld interface (below), nothing engine-specific leaks out
      joltWorld.ts        // Jolt implementation
      rapierWorld.ts      // only if the fallback is used
    vehicle/
      Vehicle.ts          // owns chassis body id + wheel state, orchestrates layers
      suspension.ts       // ray casts, spring-damper, anti-roll
      tire.ts             // pure functions: slip curve, friction limit (unit tested)
      drivetrain.ts       // power curve, drive split, boost, reverse
      brakes.ts           // curve, bias, ABS, handbrake
      steering.ts         // speed-sensitive angle, rate limits, input filter
      assists.ts          // counter-steer, yaw assist, drift limit, anti-flip
      driftMeter.ts
    tuning/
      schema.ts           // ParamDef[] (single source of truth, section 7)
      store.ts            // current values, change events, typed accessors
      presets.ts
      storage.ts          // localStorage, JSON import/export, URL hash share
    world/
      track.ts            // circle ring + infield + barriers (config-driven)
      materials.ts        // procedural asphalt and markings
    render/
      renderer.ts, carVisual.ts, cameraRig.ts, skidMarks.ts, fx.ts
    input/
      keyboard.ts, gamepad.ts, mapper.ts
    ui/
      optionsPanel.ts, hud.ts, graphs.ts, tireCurvePlot.ts
  tests/                  // vitest unit tests
  e2e/                    // playwright tests
```

The engine adapter is intentionally tiny. Only these operations may cross the boundary:

```ts
interface IPhysicsWorld {
  setGravity(g: number): void;                                   // magnitude along -Y
  step(dt: number): void;
  createStaticBox(center: V3, halfExtents: V3, rotY?: number, friction?: number, restitution?: number): BodyId;
  createDynamicBox(desc: {
    center: V3; halfExtents: V3; mass: number; comOffset: V3;
    inertiaScale: V3; friction: number; restitution: number;
    ccd: boolean; maxAngularVelocity: number; angularDamping: number;
  }): BodyId;
  updateMassProperties(id: BodyId, m: MassDesc): void;           // for needsRebuild params, keeps state
  getTransform(id: BodyId, outPos: V3, outQuat: Quat): void;
  getLinearVelocity(id: BodyId, out: V3): void;
  getAngularVelocity(id: BodyId, out: V3): void;
  getPointVelocity(id: BodyId, worldPoint: V3, out: V3): void;
  applyForceAtPoint(id: BodyId, force: V3, worldPoint: V3): void; // accumulates until next step
  applyTorque(id: BodyId, torque: V3): void;
  setAngularVelocity(id: BodyId, w: V3): void;
  setTransform(id: BodyId, pos: V3, quat: Quat, zeroVelocity: boolean): void;
  rayCast(origin: V3, dir: V3, maxLen: number, out: RayHit): boolean; // hit distance + normal + surface id
  onContact(cb: (a: BodyId, b: BodyId, impulse: number, point: V3, normal: V3) => void): void; // future crash FX
}
```

Everything above is an interface for the team to refine, but the principle is fixed: **no `Jolt.*` type may appear outside `physics/joltWorld.ts`.**

---
## 6. Vehicle dynamics model

### 6.1 Approach in one paragraph

The car is **one rigid body** (a box) owned by the physics engine, with gravity, collisions and integration handled by the engine. Everything that makes it a car is **our own force model**, computed every physics step in `Vehicle.preStep` and applied to the body as forces and torques. The model has four layers, each independently tunable and individually disable-able:

1. **Suspension:** four ray-cast spring-dampers give each wheel a normal load and keep the box off the ground. Weight transfer emerges from this.
2. **Tires:** each wheel turns its normal load into a longitudinal and a lateral force using a slip-angle curve (grips, peaks, then falls off to a sliding level) and a friction ellipse that couples the two directions.
3. **Drivetrain and brakes:** an acceleration-versus-speed curve for the engine, a pedal curve and bias for the brakes, a handbrake that temporarily removes rear grip, and a boost multiplier.
4. **Assists:** counter-steer help, yaw help and drift angle control that make sliding fun and catchable. Each has a strength slider that goes to zero.

### 6.2 Geometry (defaults, config-driven in `vehicle/constants.ts`)

| Item | Value |
|---|---|
| Chassis box (full size) | length 4.0 m (Z), height 1.0 m (Y), width 1.8 m (X) |
| Wheelbase / track | 2.6 m / 1.6 m |
| Wheel radius | 0.34 m (visual and ray-cast offset) |
| Wheel mount points (chassis local) | FL (-0.8, -0.2, -1.3), FR (+0.8, -0.2, -1.3), RL (-0.8, -0.2, +1.3), RR (+0.8, -0.2, +1.3) |
| Centre of mass | box centre plus `comLongOffset` (Z, positive forward) and `comHeightOffset` (Y) |
| Sprung mass per wheel | `mass / 4`, adjusted for `comLongOffset` (front share = 0.5 - comLongOffset / wheelbase) |

At default settings the box centre rides about 0.86 m above the pavement and the underside about 0.36 m. Static suspension compression is about 8 cm.

### 6.3 Per-step pipeline

```
preStep(dt):
  1. controls   = filterInputs(rawInput, dt)              // throttle, brake, steer, handbrake, boost
  2. state      = read chassis pos/rot/linVel/angVel; derive axes f (forward), r (right), u (up)
                  v_long = v . f ; v_lat = v . r ; speed = |v| ; beta = atan2(v_lat, max(|v_long|, 0.1))
  3. steering   = steerAngle(controls.steer, |v_long|)     // 6.6, includes counter-steer assist
  4. for each wheel i:
       suspension(i)  -> grounded_i, contactPoint_i, contactNormal_i, compression_i, Fz_i    // 6.4
  5. downforce   = m * g_eff * downforceAtTopSpeed * (speed / topSpeed)^2   // along -u, shared by wheel load
  6. for each grounded wheel i:
       wheel frame from chassis axes rotated by steer angle (front wheels only)
       (vx, vy)  = contact-point velocity in wheel frame   // vx forward, vy right
       slip angle alpha = atan2(vy, max(|vx|, vEps)); relaxed alpha~ (6.5.3)
       Fy   = lateral force from slip curve                // 6.5
       Fxd  = desired longitudinal force (drive + coast + brake + handbrake)   // 6.7
       Fx   = clamp Fxd to friction ellipse remaining capacity                 // 6.5.4
       apply (Fx, Fy) at raised application point           // 6.5.6
       record slip flags (spinning / locked) for FX
  7. assists   -> yaw torque, drift angle control, anti-flip, air control        // 6.8
  8. boost & drift meter update                                                  // 6.9
  9. stability guards                                                            // 6.10
postStep(dt):
  read back state, compute telemetry (body-frame accelerations by finite difference, low-passed),
  update wheel visual state (steer, spin, suspension travel), emit skid marks/smoke events.
```

### 6.4 Suspension

- Ray origin at each wheel mount, direction along chassis `-u`, length `suspRestLength + wheelRadius + maxDroop` (`maxDroop = 0.10 m`, constant).
- Compression `x = (suspRestLength + wheelRadius) - hitDistance`, valid in `[-maxDroop, suspMaxTravel]`. Beyond `suspMaxTravel` apply a stiff bump stop (spring rate x 10).
- Spring rate from ride frequency: `k_i = m_i * (2 * pi * suspFrequency)^2`. Damper: `c_i = 2 * suspDampingRatio * sqrt(k_i * m_i)`. `m_i` is the sprung mass for that wheel.
- Force `F_s = max(0, k * x + c * dx/dt)` along the ground normal, applied at the wheel mount. `Fz_i` for the tire model is `F_s` plus this wheel's share of downforce.
- **Anti-roll bar:** for each axle, add `+/- suspAntiRoll * k * (x_left - x_right)` to the two wheels.
- If the ray misses, the wheel is airborne: `Fz = 0`, no tire force.
- Debug toggle `suspensionEnabled = false`: replace ray-cast loads with a constant `m * g_eff / 4` per grounded wheel (useful to isolate tire tuning).

### 6.5 Tire model

Each grounded wheel produces a lateral force `Fy` (along the wheel's right axis) and a longitudinal force `Fx` (along its forward axis). Signs are chosen so forces oppose the corresponding slip velocity.

**6.5.1 Effective friction**

```
mu_eff = mu_axle * surfaceGrip * handbrakeMult_axle * (Fz / Fz_ref)^(-loadSensitivity)
```

- `mu_axle` is `gripFront` or `gripRear`. `Fz_ref = m * g_eff / 4`.
- `handbrakeMult` applies to the rear axle only (6.7.3).
- `loadSensitivity` makes a heavily loaded tire slightly less effective per unit load. It is what gives weight transfer real consequences. At 0 the load term vanishes.

**6.5.2 Slip curve**

With `x = |alpha_relaxed| / peakSlipAngle` (radians) and `s = slideGripRatio`:

```
g(x) = 2x - x^2                         for 0 <= x <= 1     (rises to 1.0 at the peak, zero slope at the top)
g(x) = s + (1 - s) * exp(-k * (x - 1))  for x > 1           (falls to s; k = slipFalloffRate)
Fy   = -sign(alpha_relaxed) * mu_eff * Fz * g(x)
```

`g` is continuous at `x = 1`. **The shape of `g` past the peak is the drift feel:** a small `k` and `s` near 1 is forgiving and grippy; a large `k` and small `s` is cliff-edge and snappy. Implement `g` as a pure function in `tire.ts` with unit tests (peak at `x = 1`, continuity, monotone fall-off, limits). The Options page MUST plot this curve live (section 8.4).

**6.5.3 Slip lag (relaxation length)**

Real tires build force over a short distance rather than instantly. This gives turn-in a tiny delay and stabilizes the simulation:

```
alpha_relaxed += clamp(|vx| * dt / tireRelaxationLength, 0, 1) * (alpha - alpha_relaxed)
```

Low `tireRelaxationLength` is twitchy; high is lazy and floaty.

**6.5.4 Friction ellipse (combining directions)**

Let `Fy_norm = |Fy| / (mu_eff * Fz)` (equals `g(x)`). Longitudinal capacity:

```
Fx_cap = mu_eff * Fz * sqrt(max(0, 1 - combinedSlipCoupling * Fy_norm^2))
Fx     = clamp(Fx_desired, -Fx_cap, +Fx_cap)
```

With `combinedSlipCoupling = 1` hard braking or accelerating uses up cornering grip (full friction circle); at 0 the two are independent (very forgiving, less believable). If `|Fx_desired| > Fx_cap` set the wheel's `spinning` or `locked` flag for visuals.

**6.5.5 Low-speed handling**

Slip angle is ill-defined near standstill. Let `w = smoothstep(0, lowSpeedBlend, |vx|)`:

```
Fy_visc = clamp(-(mu_eff * Fz / 0.5) * vy, -mu_eff*Fz, +mu_eff*Fz)     // viscous "stick" model
Fy      = w * Fy_slip + (1 - w) * Fy_visc
```

The same idea keeps the car from creeping when stopped: below about 0.3 m/s with no throttle, apply a stronger longitudinal viscous hold.

**6.5.6 Where forces are applied**

Applying tire forces at the ground contact point makes the body pitch and roll violently under braking and cornering. Arcade racers raise the application point toward the centre of mass. Use:

```
applyPoint = contactPoint + u * (tireForceHeight * heightOfCoMAboveContactAlong_u)
```

`tireForceHeight = 0` is realistic (lots of body motion), `1` applies forces at CoM height (nearly no weight transfer feel). Default 0.6.

### 6.6 Steering

- Input filter (keyboard): the filtered steer `s_f` moves toward the target at `1 / steerRiseTime` per second when increasing magnitude and `1 / steerReturnTime` per second when returning to centre.
- Gamepad: apply deadzone `steerDeadzone`, then expo `s = (1 - e) * x + e * x^3` with `e = steerExpo`, then a fixed 30 ms low-pass.
- Speed-sensitive lock: `delta_max(v) = lerp(steerMaxLowSpeed, steerMaxTopSpeed, clamp(|v_long| / topSpeed, 0, 1)^steerSpeedExp)`.
- `delta = s_f * delta_max(v)`, plus counter-steer assist: `delta += -countersteerAssist * beta_front` when `|beta| > 3 deg`, where `beta_front` is the angle of the front axle's velocity relative to chassis forward (signed as `beta`). Clamp the total to `1.25 * delta_max(v)`.
- Both front wheels use the same angle in the slice. Ackermann geometry MAY be added.

### 6.7 Drivetrain and brakes

**6.7.1 Engine (single automatic "gear", no gearbox)**

Design intent: the sliders describe what the player feels, so they map directly to measurable numbers.

```
vTop_eff = topSpeed + boostTopSpeedAdd * boostEnvelope           // boostEnvelope in [0,1], ~0.2 s rise/fall
M        = 1 + (boostAccelMult - 1) * boostEnvelope
a_eng(v) = accel0 * M * (1 - (v / vTop_eff)^powerCurveExp)       // clamp to >= 0
a_res(v) = coastDecel * (v / 30)                                  // passive drag/engine braking, v >= 0
a_long   = T * a_eng(v) - (1 - T) * a_res(v)                      // T = filtered throttle in [0,1]
```

At full throttle net acceleration is exactly `a_eng`, so `accel0` and `topSpeed` are literal. Longitudinal drive force per wheel: `F = m * a_long * share_i`, where `share_i` comes from `driveBias` (rear axle gets `driveBias`, front gets `1 - driveBias`, each split equally left and right; no differential model). Resistance (`a_res`) is spread over all four wheels by static weight.

**Reverse:** when the brake pedal is held and `v_long < 1 m/s`, brake input becomes reverse throttle with `a_rev(v) = 0.6 * accel0 * (1 - (|v| / reverseSpeed)^powerCurveExp)`.

**Throttle filtering:** `T` rises at `1 / throttleRiseTime` and falls at `1 / throttleFallTime`.

**6.7.2 Brakes**

```
p      = filtered brake pedal in [0,1]      // rises at 1 / brakeRiseTime
a_b    = brakeDecel * p^brakeCurveExp        // total commanded deceleration, m/s^2
F_b,i  = m * a_b * axleShare_i               // axleShare: front = brakeBiasFront, rear = 1 - brakeBiasFront, split L/R
```

- Direction is smooth: `-clamp(vx / 0.5, -1, 1)` to avoid chatter at standstill.
- ABS: the brake force per wheel is limited to `lerp(mu_slide, mu_peak, absStrength) * Fz` where `mu_slide = slideGripRatio * mu_eff` and `mu_peak = mu_eff`. At `absStrength = 1` the wheel never locks; at 0 a locked wheel only delivers sliding friction (longer stops, skid marks).
- The brake force is clamped so it cannot reverse the wheel's velocity in a single step: `|F_b| <= m_wheel * |vx| / dt`.

**6.7.3 Handbrake**

While held: rear friction multiplier eases (in about 0.05 s) from 1 down to `handbrakeRearGrip`, plus a rear-axle braking force of `m * handbrakeDecel`. On release the multiplier returns to 1 over `handbrakeRecoveryTime`. The recovery ramp is a major part of drift feel: too quick and the car snaps straight, too slow and it stays loose.

**6.7.4 Downforce and gravity**

`g_eff = gravity` (slider). Downforce along `-u` as in the pipeline. The engine's gravity is set to the same `g_eff`. Both scale suspension loads and tire limits consistently.

### 6.8 Assists

All assists are gated to "grounded with at least 3 wheels" except air control, and scale in from 0 at 3 m/s to 1 at 10 m/s.

**A. Counter-steer assist.** Described in 6.6.

**B. Yaw-rate assist (grip phase).** Makes turn-in crisp and the car stable when not sliding.

```
w_grip  = 1 - smoothstep(6 deg, 14 deg, |beta|)                       // fades out as a slide develops
omega_t = s_f * min( v_long * tan(delta_max(v)) / wheelbase,  a_cap / max(v, 1) )
a_cap   = mu_rear * surfaceGrip * slideGripRatio * g_eff
tau_B   = yawAssist * w_grip * I_yaw * clamp((omega_t - omega_y) / 0.15, -12, +12)     // rad/s^2 cap
```

**C. Drift angle control (slide phase).** Once the car is sliding, steering stops meaning "yaw rate" and starts meaning "how far sideways". This is what makes a drift holdable.

```
w_slide = 1 - w_grip
d       = sign(beta)
u       = s_f * d                      // +1: steering into the slide (more angle), -1: counter-steering out (less angle)
beta_t  = d * lerp(3 deg, maxDriftAngle, (u + 1) / 2)
beta_dot = low-passed finite difference of beta
tau_C   = yawAssist * w_slide * I_yaw * clamp(25 * (beta_t - beta) - 10 * beta_dot, -15, +15)
```

Sign check (unit-test it): with `beta = psi - theta_v` (heading minus velocity direction, counter-clockwise positive), a positive yaw torque increases `beta`. Beyond `1.15 * maxDriftAngle` add a strong restoring torque so the car cannot spin out by accident; this is the "soft limit".

Total yaw assist torque is `(tau_B + tau_C)` about the chassis up axis. `I_yaw` is the effective yaw inertia including `yawInertiaScale`.

Assist C is the least certain part of this document. **Treat it as a research item:** deliver A and B as written, then iterate C until a human can hold a five-second drift at default values (acceptance criterion in section 3). If C's structure proves wrong, replace it, but keep the parameter names.

**D. Air control.** While fewer than 2 wheels are grounded, add damping torque on pitch and roll of `-0.8 * I * omega` per axis so jumps land flat. (A player-steerable version is a later mechanic.)

**E. Anti-flip.** If roll exceeds 35 degrees and the car is nearly stationary or grounded, add a righting torque proportional to the roll error. Internal constant, not a slider.

### 6.9 Boost and drift meter

- Boost input drains the meter at `boostDrainRate` per second while it is above zero. `boostEnvelope` eases to 1 while boosting, back to 0 otherwise (0.2 s time constant). Effects: engine curve (6.7.1), FOV kick, camera shake, HUD.
- Drift meter charge: when `|beta| >= driftMinAngle`, speed above 15 m/s and at least two wheels grounded:
  `meter += driftChargeRate * (|beta| / 30 deg) * (speed / 40) * dt`, clamped to 1.
- Meter persists after the drift ends (no decay in the slice). A visual pip flashes while charging.

### 6.10 Stability safeguards (all MUST)

- **Impulse limiting:** no tire force may apply more impulse in one step than would take the contact-point slip velocity to zero: `|F| * dt <= m_wheel * |v_slip|`. This prevents oscillation at low speed and high stiffness.
- **Angular velocity clamp** at `maxAngularVelocity` (slider, engine-side).
- **NaN/Infinity guard:** after each step, if any of position, rotation or velocity is non-finite, reset the car to the spawn pose and log an error (in development builds, also `debugger`).
- **Stuck recovery:** hotkey `R` respawns on the track facing along it with zero velocity.
- **Fixed step sanity:** `physicsHz` changes MUST NOT change the default feel noticeably. If they do, the model contains an unintended dependence on `dt`; fix the model, not the default.

### 6.11 Telemetry the model must expose

Speed (m/s and km/h), `v_long`, `v_lat`, `beta`, yaw rate, body-frame lateral and longitudinal acceleration (finite difference of velocity, low-passed, plus an optional sum of forces), per-wheel `Fz`, slip angle, `|F| / (mu_eff * Fz)` grip usage, `spinning`/`locked` flags, steering angle, throttle, brake, handbrake, boost meter, drift meter, grounded wheel count, physics step time, steps per frame. These feed the HUD (section 12) and the automated tests.

---

## 7. Tuning parameters

### 7.1 Schema (single source of truth)

All parameters are defined once, in `src/tuning/schema.ts`. The Options page, presets, import/export, URL sharing, validation and documentation tooltips are generated from this array. Physics code reads values from a typed store, never from constants.

```ts
export interface ParamDef {
  key: string;                    // unique, camelCase, matches the table below
  group: 'World' | 'Chassis' | 'Engine' | 'Brakes' | 'Tires' | 'Steering'
       | 'Suspension' | 'Boost & Drift' | 'Collision' | 'Camera';
  label: string;
  unit: string;                   // '' for dimensionless
  default: number;
  min: number; max: number; step: number;
  quick?: boolean;                // shown in the pinned "Quick Tune" section
  needsRebuild?: boolean;         // changes body mass properties; apply via updateMassProperties()
  advanced?: boolean;             // collapsed by default
  discrete?: number[];            // for physicsHz: [60, 90, 120, 180, 240]
  help: string;                   // one or two sentences: what it does and what happens when raised
}
```

Validation: values are clamped to `[min, max]` on load and on input. Unknown keys in imported files are ignored with a warning; missing keys use defaults.

### 7.2 The parameters

Flags: **Q** = quick tune, **R** = needs rebuild of mass properties, **A** = advanced.

| Key | Group | Unit | Default | Min | Max | Step | Flags | What it changes |
|---|---|---|---|---|---|---|---|---|
| gravity | World | m/s^2 | 20 | 4 | 40 | 0.1 | Q | Weight of everything: tire limits, suspension load, air time. Higher feels heavier and grippier. |
| timeScale | World | x | 1.0 | 0.05 | 2.0 | 0.01 | | Simulation speed. Slow motion for testing crashes and drift catches. |
| surfaceGrip | World | x | 1.0 | 0.2 | 1.5 | 0.01 | | Global multiplier on tire friction (wet/dirt test). |
| physicsHz | World | Hz | 120 | 60 | 240 | discrete | A | Physics step rate. Feel should not change; used to test stability. |
| mass | Chassis | kg | 1300 | 500 | 4000 | 10 | R | Inertia. Scales forces, so acceleration stays as set; mass mostly changes crash behavior and feel of turning. |
| comHeightOffset | Chassis | m | -0.20 | -0.6 | 0.4 | 0.01 | R | Centre of mass height relative to box centre. Lower is more stable and rolls less. |
| comLongOffset | Chassis | m | 0.0 | -0.8 | 0.8 | 0.01 | R | Positive moves weight forward (more understeer), negative rearward (more oversteer). |
| yawInertiaScale | Chassis | x | 1.0 | 0.3 | 3.0 | 0.05 | R | How easily the car rotates. Low is darty, high is heavy and stable. |
| pitchRollInertiaScale | Chassis | x | 1.0 | 0.3 | 3.0 | 0.05 | R | How easily the body pitches and rolls. |
| angularDamping | Chassis | 1/s | 0.4 | 0 | 5 | 0.05 | | Engine-side damping of all rotation. Calms wobble, dulls spins. |
| accel0 | Engine | m/s^2 | 14.0 | 4 | 40 | 0.1 | Q | Full-throttle acceleration from a standstill. |
| topSpeed | Engine | m/s | 60 | 20 | 120 | 1 | Q | Speed where unboosted acceleration reaches zero. |
| powerCurveExp | Engine | | 2.0 | 0.5 | 6.0 | 0.1 | | How long acceleration stays strong. High keeps punching near top speed; low tapers early. |
| throttleRiseTime | Engine | s | 0.12 | 0.01 | 1.0 | 0.01 | | Time for pedal to reach full throttle. |
| throttleFallTime | Engine | s | 0.08 | 0.01 | 1.0 | 0.01 | | Time for throttle to release. |
| driveBias | Engine | 0 FWD to 1 RWD | 0.65 | 0 | 1 | 0.05 | | Share of drive force on the rear axle. Higher makes the tail step out under power. |
| coastDecel | Engine | m/s^2 at 30 m/s | 1.5 | 0 | 10 | 0.1 | | Deceleration when off the throttle (engine braking and drag). |
| reverseSpeed | Engine | m/s | 15 | 0 | 40 | 1 | | Top reverse speed. |
| brakeDecel | Brakes | m/s^2 | 24 | 5 | 60 | 0.5 | Q | Peak commanded braking deceleration (tire grip may limit it). |
| brakeCurveExp | Brakes | | 1.5 | 0.5 | 4.0 | 0.05 | | Pedal shape. 1 is linear; higher gives a softer first half of the pedal. |
| brakeRiseTime | Brakes | s | 0.08 | 0.01 | 0.5 | 0.01 | | Time for brake force to build. |
| brakeBiasFront | Brakes | fraction | 0.62 | 0.2 | 0.9 | 0.01 | | Front share of braking. More front is stable; more rear rotates the car under braking. |
| absStrength | Brakes | 0 to 1 | 0.7 | 0 | 1 | 0.05 | | How well wheels are kept from locking. 0 allows lock-up. |
| handbrakeRearGrip | Brakes | x | 0.35 | 0.05 | 1.0 | 0.01 | Q | Rear friction multiplier while the handbrake is held. Lower slides more. |
| handbrakeDecel | Brakes | m/s^2 | 6 | 0 | 30 | 0.5 | | Rear-axle braking added by the handbrake. |
| handbrakeRecoveryTime | Brakes | s | 0.35 | 0.05 | 2.0 | 0.05 | | How long rear grip takes to return after release. |
| gripFront | Tires | mu | 1.5 | 0.4 | 3.5 | 0.01 | Q | Front tire peak friction (stickiness). |
| gripRear | Tires | mu | 1.5 | 0.4 | 3.5 | 0.01 | Q | Rear tire peak friction. Lower than front gives oversteer. |
| slideGripRatio | Tires | x | 0.78 | 0.3 | 1.0 | 0.01 | Q | Grip left once sliding, as a fraction of peak. Low makes drifts loose; near 1 makes slides sticky. |
| peakSlipAngle | Tires | deg | 11 | 3 | 25 | 0.5 | | Slip angle where grip peaks. Higher is more forgiving and lazier. |
| slipFalloffRate | Tires | | 1.5 | 0.1 | 6.0 | 0.05 | Q | How abruptly grip drops after the peak. High is a cliff; low is progressive. |
| combinedSlipCoupling | Tires | 0 to 1 | 0.85 | 0 | 1 | 0.01 | | How much braking or acceleration steals cornering grip. |
| tireRelaxationLength | Tires | m | 0.6 | 0.05 | 3.0 | 0.05 | | Tire response lag. Low is twitchy; high is lazy. |
| loadSensitivity | Tires | | 0.15 | 0 | 0.5 | 0.01 | | How much grip per unit load falls as load rises (weight transfer consequence). |
| downforceAtTopSpeed | Tires | x weight | 0.6 | 0 | 3.0 | 0.05 | Q | Extra downward force at top speed as a multiple of weight (scales with speed squared). |
| lowSpeedBlend | Tires | m/s | 3.0 | 0.5 | 10.0 | 0.1 | A | Speed below which the tire model blends to the stable low-speed model. |
| steerMaxLowSpeed | Steering | deg | 32 | 5 | 60 | 0.5 | | Maximum steering angle at standstill. |
| steerMaxTopSpeed | Steering | deg | 5 | 1 | 30 | 0.5 | Q | Maximum steering angle at top speed. Lower is calmer at speed. |
| steerSpeedExp | Steering | | 0.5 | 0.2 | 3.0 | 0.05 | | How quickly steering lock shrinks with speed. Low shrinks early. |
| steerRiseTime | Steering | s | 0.18 | 0.02 | 1.5 | 0.01 | | Keyboard: time from centre to full lock. |
| steerReturnTime | Steering | s | 0.10 | 0.02 | 1.5 | 0.01 | | Keyboard: time to return to centre. |
| steerExpo | Steering | 0 to 1 | 0.25 | 0 | 0.9 | 0.01 | | Gamepad stick curve. Higher softens small inputs. |
| steerDeadzone | Steering | | 0.08 | 0 | 0.3 | 0.01 | | Gamepad stick dead zone. |
| countersteerAssist | Steering | 0 to 1 | 0.6 | 0 | 1 | 0.05 | Q | Automatic steering toward the direction of travel in a slide. |
| yawAssist | Steering | 0 to 1 | 0.4 | 0 | 1 | 0.05 | Q | Strength of yaw-rate assist (grip phase) and drift angle control (slide phase). |
| maxDriftAngle | Steering | deg | 55 | 20 | 90 | 1 | | Target slide angle at full steering into the slide, and the soft limit. |
| suspFrequency | Suspension | Hz | 2.2 | 0.8 | 6.0 | 0.1 | | Suspension stiffness (ride frequency). Higher is stiffer, less body motion. |
| suspDampingRatio | Suspension | | 0.55 | 0.1 | 1.5 | 0.05 | | Bounce damping. Low bounces; high feels dead. |
| suspRestLength | Suspension | m | 0.40 | 0.15 | 0.90 | 0.01 | | Ride height. |
| suspMaxTravel | Suspension | m | 0.25 | 0.05 | 0.60 | 0.01 | | Compression before the bump stop. |
| suspAntiRoll | Suspension | x spring | 0.6 | 0 | 2.0 | 0.05 | | Roll stiffness. Higher reduces body roll. |
| tireForceHeight | Suspension | 0 to 1 | 0.6 | 0 | 1 | 0.05 | | Raises where tire forces act toward the centre of mass; reduces squat, dive and roll. |
| boostAccelMult | Boost & Drift | x | 1.6 | 1.0 | 3.0 | 0.05 | | Acceleration multiplier while boosting. |
| boostTopSpeedAdd | Boost & Drift | m/s | 25 | 0 | 60 | 1 | | Extra top speed while boosting. |
| boostDrainRate | Boost & Drift | 1/s | 0.25 | 0.05 | 2.0 | 0.05 | | Meter used per second of boost. |
| driftChargeRate | Boost & Drift | 1/s at reference | 0.1 | 0 | 2.0 | 0.05 | | Meter earned per second of a reference drift (30 deg at 40 m/s). Much slower than it was (0.35), so the accelerator pads are the main way to earn boost. |
| driftMinAngle | Boost & Drift | deg | 12 | 3 | 40 | 0.5 | | Slide angle needed to count as a drift. |
| restitution | Collision | | 0.25 | 0 | 1.0 | 0.01 | | Bounciness of impacts. |
| wallFriction | Collision | | 0.05 | 0 | 1.0 | 0.01 | | Friction against barriers. Low lets you scrape along walls without stopping. |
| maxAngularVelocity | Collision | rad/s | 12 | 3 | 40 | 0.5 | A | Hard cap on rotation speed. |
| fovBase | Camera | deg | 70 | 40 | 110 | 1 | | Field of view at rest. |
| fovSpeedGain | Camera | deg | 15 | -30 | 50 | 1 | Q | Extra FOV at top speed. Positive widens the lens for peripheral motion and pushes the car visually further away; negative narrows it for a tighter, closer look. |
| fovBoostKick | Camera | deg | 15 | 0 | 50 | 1 | | Extra FOV while boosting. |
| camDistance | Camera | m | 7.5 | 3 | 20 | 0.1 | | Chase camera distance behind the car. |
| camHeight | Camera | m | 2.6 | 0.5 | 8 | 0.1 | | Chase camera height. |
| camFollowTime | Camera | s | 0.25 | 0.02 | 1.5 | 0.01 | | Camera lag. Low is rigid; high is loose and cinematic. |
| camVelocityBlend | Camera | 0 to 1 | 0.5 | 0 | 1 | 0.05 | | 0 frames along the car's heading; 1 along its direction of travel, which shows the slide. |
| camShake | Camera | x | 0.3 | 0 | 2.0 | 0.05 | | Speed and impact shake. |
| camRollGain | Camera | deg per g | 3 | 0 | 15 | 0.5 | | Camera lean into corners. |

The `quick` set (14 sliders): gravity, accel0, topSpeed, brakeDecel, handbrakeRearGrip, gripFront, gripRear, slideGripRatio, slipFalloffRate, downforceAtTopSpeed, steerMaxTopSpeed, countersteerAssist, yawAssist, fovSpeedGain.

### 7.3 Presets

Presets are partial maps of key to value applied over the defaults. Ship Default plus these three:

| Preset | Overrides |
|---|---|
| **Default** | none |
| **Grip** | gripFront 1.9, gripRear 1.9, slideGripRatio 0.92, slipFalloffRate 0.7, handbrakeRearGrip 0.5, yawAssist 0.2, countersteerAssist 0.3 |
| **Drifty** | gripRear 1.25, slideGripRatio 0.60, slipFalloffRate 2.5, handbrakeRearGrip 0.20, driveBias 0.8, yawAssist 0.6, countersteerAssist 0.8, driftChargeRate 0.6 |
| **Raw** (all assists off) | yawAssist 0, countersteerAssist 0, tireRelaxationLength 0.9, downforceAtTopSpeed 0.2, steerExpo 0, absStrength 0, camVelocityBlend 0 |

### 7.4 Tuning playbook (ship this in the UI as a collapsible help panel and in `docs/TUNING_PLAYBOOK.md`)

| Symptom | First knobs to try |
|---|---|
| Feels slow even at top speed | Raise `fovSpeedGain`, raise `accel0`, lower `camDistance`, raise `powerCurveExp` so acceleration lasts. Check speed cues (section 10.2) before touching physics. |
| Feels floaty or weightless | Raise `gravity`, raise `suspFrequency`, raise `downforceAtTopSpeed`, lower `comHeightOffset`. |
| Twitchy or nervous at high speed | Lower `steerMaxTopSpeed`, raise `tireRelaxationLength`, raise `yawInertiaScale`, raise `steerExpo` on gamepad. |
| Understeers, will not turn in | Raise `gripFront`, lower `slipFalloffRate`, move `comLongOffset` forward, raise `steerMaxTopSpeed`, raise `yawAssist`. |
| Snaps into a spin | Lower `slipFalloffRate`, raise `slideGripRatio`, raise `countersteerAssist`, lower `maxDriftAngle`. |
| Cannot start a drift | Lower `handbrakeRearGrip`, lower `gripRear`, raise `driveBias`, raise `steerMaxLowSpeed`. |
| Drift will not hold | Raise `yawAssist`, raise `slideGripRatio`, raise `maxDriftAngle`, check `driftMinAngle`. |
| Drift never ends / feels on rails | Lower `yawAssist`, lower `countersteerAssist`, lower `slideGripRatio`. |
| Brakes feel grabby or weak | Adjust `brakeCurveExp` first (pedal shape), then `brakeDecel`; if wheels lock, raise `absStrength` or lower `brakeBiasFront`. |
| Body rocks like a boat | Raise `suspDampingRatio`, raise `suspAntiRoll`, raise `tireForceHeight`, lower `comHeightOffset`. |

---
## 8. Options page (tuning UI)

### 8.1 Behavior

- Toggle with **`O`** (or the on-screen gear button). Slides in from the right, about 380 px wide, semi-transparent so the car stays visible. The game keeps running while it is open; a "Pause while open" checkbox (default off) freezes the simulation.
- **Everything applies live.** Dragging a slider updates the value in the tuning store on every input event; the physics reads it at the start of the next step. Parameters flagged `needsRebuild` call `updateMassProperties()` (debounced 100 ms) and MUST NOT teleport or stop the car.
- **Driving keys must keep working.** After a pointer interaction with a slider, blur it so arrow keys go back to the game. Key events whose target is a text or number input are ignored by the game input layer.
- Layout: a pinned **Quick Tune** section at the top (the 14 `quick` params), then one collapsible section per group, generated from the schema. A search box filters by label and key.

### 8.2 Each control

- Label, unit, a slider, a numeric input (typing overrides slider precision, still clamped), a "reset to default" button, an "unsaved change" marker when different from the active preset, and a `?` tooltip showing `help`.
- Sliders for parameters whose range spans more than a factor of 20 (`timeScale`, `tireRelaxationLength`, `mass`) SHOULD use a logarithmic mapping.
- Group header buttons: "Reset group", "Collapse all".

### 8.3 Presets and persistence

- Preset dropdown (Default, Grip, Drifty, Raw, plus user presets). "Save as..." stores a named preset in `localStorage`.
- **Export / Import JSON** of the full parameter set (`{ version, name, values }`). Version mismatches are handled by ignoring unknown keys.
- **Share link:** encode the current changed-from-default values into the URL hash (base64url of JSON). Opening a link with a hash applies it.
- Auto-save the working set to `localStorage` on change (debounced) and restore on load, with a "Reset everything" button.
- **Change log:** append every change (timestamp, key, old, new) to an in-memory list and include it in exported JSON. It makes it possible to reconstruct which change made the car feel better.

### 8.4 Live tire-curve plot

A small canvas at the top of the Tires group draws `g(x)` (section 6.5.2) for front and rear on shared axes, with the car's current per-axle operating point drawn as a moving dot (slip angle on X, grip usage on Y). It updates when any tire parameter changes and at 30 Hz for the dot. This is the fastest way to understand what `slipFalloffRate`, `slideGripRatio` and `peakSlipAngle` do.

### 8.5 A/B comparison

Two parameter slots, A and B. `Tab` (documented in the panel; the game MUST call `preventDefault` so it does not move browser focus) swaps the live values between slots instantly while driving; the HUD shows which slot is active. "Copy A to B" makes it easy to change one thing and compare.

### 8.6 Performance

The panel is plain DOM. Reading telemetry into the panel MUST be throttled to 30 Hz or less and MUST NOT trigger layout thrash while driving. Do not rebuild the DOM on value changes; update `value` and text nodes in place.

---

## 9. World: the test track

### 9.1 Geometry (config object in `world/track.ts`, all numbers changeable in one place)

| Item | Default |
|---|---|
| Paved disc radius | 150 m (the entire disc is pavement) |
| Ring lane (painted) | inner edge 110 m, outer edge 150 m, centre-line radius 130 m, width 40 m |
| Infield | free open pavement inside r = 110 m for donuts and free driving |
| Skidpad marking | painted circle of radius 30 m at the centre, plus a smaller one of 15 m |
| Outer barrier | continuous wall at r = 152 m to 154 m (2 m thick), 1 m high, 128 straight box segments |
| Ground beyond the barrier | large flat plane to 1000 m (visual; not reachable) |
| Kill plane | y < -50 m respawns the car |
| Spawn | on the ring centre-line at angle 0, facing counter-clockwise |

Rationale: at the default numbers the car's peak-grip corner radius is roughly 100 to 165 m at top speed, so the ring is at the edge of what the car can hold at 60 m/s, and boosted speeds (up to about 85 m/s) exceed it and force slides. The infield lets the player test low-speed rotation and handbrake turns at any radius.

The barrier is 2 m thick so that per-step travel at 85 m/s (about 0.7 m at 120 Hz) cannot tunnel through it, and the car body has CCD enabled as a second line of defense.

### 9.2 Surface

One surface type (asphalt) in the slice. The physics interface already carries a `surfaceId` on ray hits so more surfaces (wet, dirt, curb) can be added later with a per-surface friction multiplier. `surfaceGrip` (slider) multiplies all of them.

### 9.3 Materials

- Procedural asphalt: a tiled 1024x1024 noise texture generated in code at startup (fine grain plus larger blotches), mipmapped, anisotropic filtering at maximum. Grain is important: **it is a speed cue** (section 10.2).
- Markings: solid white edge lines, dashed centre line (3 m dash, 6 m gap), radial tick marks every 10 degrees at the ring edges. Draw with instanced quads or a single shader on the ring mesh.
- Curbs: alternating red/white instanced boxes along both edges of the ring (visual only).

---

## 10. Rendering, camera and the "feels fast" checklist

### 10.1 Chase camera

```
dirHeading  = chassis forward flattened onto the ground plane
dirVelocity = velocity flattened (only used above 8 m/s, otherwise heading)
dir         = slerp(dirHeading, dirVelocity, camVelocityBlend)
targetPos   = carPos - dir * camDistance + up * camHeight
camPos      = criticallyDamped(camPos, targetPos, camFollowTime)          // frame-rate independent
lookAt      = carPos + dir * (4 + 0.1 * speed) + up * 0.8                 // look ahead a little more at speed
fov         = fovBase + fovSpeedGain * (speed / topSpeed)^1.5 + fovBoostKick * boostEnvelope
roll        = camRollGain * lateralAccelInG                                // lean into corners
shake       = camShake * (noise(t) * speedFactor + impactImpulseKick)      // impact hook for the future
```

`camVelocityBlend` at 0.5 lets the player see the slide angle: the car visibly rotates in frame while the road ahead remains centered. Make it the default and let the tuner set it to 0.

### 10.2 Speed cues (must exist before anyone judges "speed")

Human speed perception comes from visual flow and camera behavior more than from the number. The slice MUST include:

1. **Roadside posts**: instanced posts every 12 m on both ring edges, alternating two colors.
2. **Dashed centre line** and radial tick marks (section 9.3).
3. **Asphalt grain** with mipmaps and anisotropy (streaks at speed, sharp near the car).
4. **FOV increase** with speed and boost (10.1).
5. **Camera shake** that scales with speed, plus a small vertical bob from suspension.
6. **Exponential fog** (light) so distant posts pop out of haze.
7. **Speed lines** (MAY): thin streaks at screen edges above 80% of top speed and while boosting.
8. **Vignette** that darkens edges slightly with speed (MAY).

### 10.3 Car visual

- A box body (4.0 x 1.0 x 1.8 m) in a saturated color with a **bright front chevron or nose stripe** so heading is unmistakable, and a **rear light strip** that brightens under braking.
- Four wheel boxes (or short cylinders) that steer with `delta`, spin with `v_long / wheelRadius` (faster when the wheel is `spinning`), and move up and down with suspension compression. Wheels are how a person reads the physics.
- Debug gizmos toggled with `G`: a heading arrow and a velocity arrow drawn on the ground (the angle between them is the slide angle), and a per-wheel force vector.

### 10.4 Skid marks and smoke

- **Skid marks (MUST):** a ring buffer of ground-hugging quad strips (one strip per wheel) written whenever a wheel's grip usage exceeds 0.95 or it is flagged `spinning`/`locked`. Fade over about 20 seconds. A single dynamic geometry per wheel; no per-mark objects.
- **Tire smoke (MAY):** instanced camera-facing sprites emitted at wheels with heavy slip.

### 10.5 Audio (stretch, MAY)

A WebAudio engine tone with pitch mapped to speed and a tire-squeal layer with volume mapped to `max(grip usage)` are cheap and change perceived feel dramatically. Not required for acceptance.

### 10.6 Renderer settings

`WebGLRenderer` with MSAA, `outputColorSpace = SRGB`, ACES tone mapping, pixel ratio `min(devicePixelRatio, 2)`. **Dynamic resolution:** if the smoothed frame time exceeds 18 ms for 2 seconds, reduce the render scale in steps down to 0.6; raise it back when headroom returns. One directional light with a shadow map that follows the car (2048 px); ambient hemisphere light. No post-processing chain required.

---

## 11. Input

### 11.1 Keyboard

| Action | Keys |
|---|---|
| Throttle | W, Up |
| Brake / reverse | S, Down |
| Steer | A / D, Left / Right |
| Handbrake | Space |
| Boost | Left Shift |
| Respawn | R |
| Options panel | O |
| HUD mode (full / minimal / off) | H |
| Debug gizmos | G |
| Camera preset (chase / far / hood) | C |
| Slow motion toggle (0.25x) | T |
| Pause | P |
| Latency probe | L |
| A/B swap | Tab |

### 11.2 Gamepad (standard mapping)

Right trigger throttle (analog), left trigger brake/reverse (analog), left stick X steer, A handbrake, X boost, Y respawn, Start options. Analog triggers matter for feel: **the design assumes gamepad play is the reference experience** and keyboard is the accessible fallback (hence the ramped steering and pedal filters). Poll the Gamepad API once per physics step.

### 11.3 Latency

Use `keydown`/`keyup` handlers that only write to a preallocated state struct (no work in handlers), and read it in the step. Use `event.timeStamp` for the latency probe.

---

## 12. HUD and telemetry

### 12.1 On-screen elements (DOM for text, canvas for graphs)

- Speed in km/h (large) and m/s (small).
- **Slide angle gauge:** a horizontal bar showing `beta` from -90 to +90 degrees, with a marker at `driftMinAngle`.
- **G-G diagram:** a scatter of longitudinal versus lateral acceleration with a reference circle at `mu * g_eff`. This shows whether the tuner is using all the available grip.
- **Per-wheel bars:** grip usage `|F| / (mu_eff * Fz)` (four bars; red past 1.0), plus normal load.
- Steering wheel indicator, throttle / brake / handbrake bars.
- Boost meter and drift meter (which fills as `beta` stays above `driftMinAngle`).
- Small text block: FPS, physics ms per step, steps per frame, `timeScale`, active preset and A/B slot.
- **Scrolling graphs (10 s):** speed, `beta`, yaw rate, lateral G, front and rear slip angle. Toggle with `H`.

### 12.2 Recording

Hotkey `F9` starts/stops a telemetry recording at the physics rate into memory and downloads a CSV (all values in 6.11 plus the current parameter set as a header comment). This lets an agent or human analyze a drive numerically ("did the slide angle exceed 45 degrees?") rather than by feel alone.

---

## 13. Testing, QA and performance

### 13.1 Unit tests (Vitest)

- `tire.ts`: `g(x)` peaks at exactly 1 at `x = 1`, is continuous at 1, monotone decreasing after, approaches `slideGripRatio` as `x` grows; friction ellipse never returns a combined force larger than `mu_eff * Fz`.
- Engine curve: `accel(0) = accel0`, `accel(topSpeed) = 0`, monotone non-increasing; **0-100 km/h between 2.0 and 2.3 s** and **0-55 m/s between 6.3 and 7.1 s** at defaults, using a small headless integration of the drivetrain formula.
- Steering: `delta_max` endpoints and monotonicity; **sign tests** for counter-steer and yaw assist against the conventions in 5.1 (a car sliding right must steer right).
- Fixed timestep loop: N steps per real second at `timeScale` 0.5, 1.0, 2.0; `alpha` interpolation in `[0, 1)`; clamp on huge frame gaps.
- Schema: every `ParamDef` has `min <= default <= max`, unique keys, and a non-empty `help`; presets only reference known keys.

### 13.2 Integration tests (Vitest with the real engine in Node, if the WASM loads there)

- Drive the vehicle with scripted inputs on a flat plane: straight-line acceleration, full-brake stop distance from 60 m/s (expect about 77 m at defaults, within 15%), constant-steer circle, handbrake turn. Assert no NaN, speed bounds, and that lateral acceleration in a steady circle stays under the friction limit.
- **Determinism:** run the same scripted input twice with a fixed seed and assert equal state hashes.
- **Soak:** 300 simulated seconds of pseudo-random inputs (seeded); assert no non-finite values and bounded angular velocity.
- **Energy check:** coasting with zero throttle on flat ground never increases speed.

### 13.3 End-to-end (Playwright, headless Chromium)

- Loads the page, waits for `window.__game.ready`, drives a scripted lap via `window.__game.setInput(...)`, and takes screenshots at fixed times.
- Opens the Options panel, changes a slider through the DOM, and asserts `window.__game.tuning.get(key)` changed and telemetry reflects it.
- Switches presets and asserts the expected keys change.
- Asserts the console has no errors or warnings during a 60 s run.

Expose a stable test surface: `window.__game = { ready, tuning: { get, set, applyPreset }, setInput, stepMany(n), getTelemetry(), respawn() }`. It MAY be stripped from production builds.

### 13.4 Performance harness

`npm run perf` launches Chromium headless, drives a lap, and prints: average and p99 frame time, average and p99 physics step ms, JS heap after 5 minutes, and WASM heap size. CI fails if physics p99 exceeds 2 ms or the heap grows more than 10% between minute 1 and minute 5.

### 13.5 Manual QA checklist (a human, on real hardware)

Test on an M-series MacBook Air, in Chrome and Safari, at least once each: 60 seconds free driving, 60 seconds of drifting on the ring, hard braking from top speed, a wall hit at boost speed (must not tunnel), switching presets while driving, opening and closing the panel while driving, tab away and back, window resize.

---

## 14. Work packages and sequencing

The orchestrating agent SHOULD begin with WP0 and WP1 (they unblock everything), then run WP2, WP3 and WP4 in parallel, then WP5 through WP8, with WP9 running continuously. Suggested worker roles in brackets.

| WP | Name | Depends on | Deliverables |
|---|---|---|---|
| **WP0** | Scaffold and CI [tooling] | none | Vite + TypeScript strict repo, lint/format, Vitest + Playwright wired, GitHub-style CI file, `docs/DECISIONS.md`, `window.__game` stub, empty scene that renders. |
| **WP1** | Physics adapter and main loop [physics] | WP0 | **Day-1 spike (4.2)** and its result recorded. `IPhysicsWorld` with Jolt implementation, fixed timestep loop with interpolation, `timeScale`, CCD box on a plane, ray cast working. Loop unit tests. |
| **WP2** | Tuning schema and store [tuning] | WP0 | `ParamDef[]` with all rows of 7.2, typed store with change events, presets, JSON import/export, URL-hash share, validation, schema tests. |
| **WP3** | World: track and materials [world] | WP0, WP1 | Ring, infield, barrier colliders, procedural asphalt, markings, posts, curbs, skidpad circles, fog and lights, kill plane. |
| **WP4** | Input [input] | WP0 | Keyboard, gamepad, mapper, per-step sampling, latency probe. |
| **WP5** | Vehicle model [vehicle] | WP1, WP2 | 5a suspension, tires, drivetrain (engine curve, drive bias, coast, reverse). 5b brakes (curve, bias, ABS), handbrake, steering (speed-sensitive, filters). 5c assists A, B, C, D, E; boost and drift meter; stability safeguards; telemetry. Unit and integration tests from 13.1 and 13.2. |
| **WP6** | Rendering and camera [render] | WP1, WP3, WP5 | Car visual with wheels, gizmos, chase camera rig, speed cues, skid marks, dynamic resolution. |
| **WP7** | Options UI [ui] | WP2 | Panel generated from the schema, Quick Tune, tooltips, presets, A/B slots, tire-curve plot, change log, focus handling. |
| **WP8** | HUD and telemetry [ui] | WP5 | All HUD elements in 12.1, scrolling graphs, CSV recorder. |
| **WP9** | QA, performance, hardening [qa] | all (continuous) | Playwright suite, perf harness, soak and determinism tests, manual QA checklist run, `docs/TUNING_PLAYBOOK.md`, README with run instructions. |

**Gates (each is a demo the orchestrator can verify):**

- **G0 Spike:** engine proved or fallback chosen (end of WP1 spike).
- **G1 Drivable:** box on the plane driven by keyboard using a minimal tire and engine model; camera follows.
- **G2 Tunable:** Options panel changes engine and tire values live.
- **G3 Complete model:** full section 6 model, assists, boost, ring and barrier in place.
- **G4 Readable:** HUD, gizmos, skid marks, speed cues, tire-curve plot.
- **G5 Hardened:** section 3 acceptance list passes in CI and on the manual QA checklist.

**Working agreements for the team**

- `strict` TypeScript, no `any` in `vehicle/` and `physics/`.
- No new runtime dependencies beyond three.js and `jolt-physics` without a note in `docs/DECISIONS.md`.
- Hot-path functions (step, tires, suspension, camera update) are allocation-free; add a lint rule or a test that watches heap growth.
- Every default in 7.2 is a starting guess; do not change defaults without recording why in `docs/DECISIONS.md`, but DO make it easy to change them.
- The project uses no product name in code identifiers (use `GAME_NAME`).

---

## 15. Beyond the slice: keeping the door open

The slice deliberately stops at one box on flat pavement. These are the next mechanics, and how today's decisions keep them cheap.

| Future mechanic | Plan | What the slice must already do |
|---|---|---|
| **Crash deformation (soft-body look)** | Keep the rigid-body hull as the source of truth for dynamics. Drive a **visual deformation layer** (lattice or per-vertex displacement, plus detachable parts as separate bodies) from contact impulses. True soft-body simulation of the whole car is expensive and hard to tune; evaluate Jolt's soft bodies only for cloth, ropes and props, and measure before adopting anything heavier. | Adapter exposes `onContact` with impulse, point and normal. Car visual is a separate object from the physics body. |
| **Many cars colliding** | One `Vehicle` per car sharing the world; collision layers; CCD on all cars. Budget: about 4 ms of physics per frame at 20 cars, to be measured. | `Vehicle` is a class with no singletons or globals. Tuning is a `ParamSet` object passed in, not module-level state, so different car types can have different values. |
| **Slow motion and hit-stop** | `timeScale` ramps (already a parameter); hit-stop is a very short drop to near zero. Audio and camera respond to the scale. | Fixed step with the accumulator feeding on scaled time (section 5.2). Tested at 0.05 to 2.0. |
| **Post-impact steering (steer the wreck)** | While a car is airborne or tumbling after an impact, allow limited player steering torque and a slow-motion window. | Air control layer (6.8 D) exists and is separable. |
| **Crash-scoring mode, traffic, AI** | Layers on top of the same physics. | Deterministic step, seeded RNG, spawn/respawn API on the world. |
| **Replays and possible netcode** | Record inputs plus seed, replay deterministically. | Determinism test in CI (13.2). Physics never reads wall-clock time. |
| **Real tracks** | Spline-based tracks with per-surface materials. | Ray hits carry `surfaceId`; `track.ts` is config-driven. |

---

## 16. Risks and open questions

### 16.1 Risks

| Risk | Mitigation |
|---|---|
| Jolt integration friction (build flavor, memory management, API ergonomics) | Day-1 spike with a written go/no-go; adapter isolates the engine; Rapier as fallback. |
| The assist layer (6.8 C) does not produce a holdable drift | Treated as research; A and B ship regardless; C can be replaced while keeping parameter names. |
| "Feel" is subjective, so progress is hard to verify | Telemetry, G-G diagram, CSV recording, A/B slots, change log, presets, and numeric acceptance tests for the parts that can be measured. |
| Browser timing differences (ProMotion, Safari, background tabs) | Fixed step plus interpolation; clamped frame time; pause on hidden; tested at 60 and 144 Hz. |
| Keyboard steering is digital | Ramped steering with separate rise and return times; gamepad is the reference input. |
| Tunneling at 85 m/s | CCD on the car, 2 m thick barrier, wall-hit test. |
| Memory leaks from WASM objects | Adapter owns creation and destruction; heap growth check in the perf harness. |
| Payload size of physics WASM | Report actual size in WP0/WP1; lazy-load the engine after first paint if it matters. |

### 16.2 Open questions (each has a default so work is never blocked)

| Question | Default |
|---|---|
| Hosting target | Any static host; deliver `dist/` from `vite build`. |
| Minimum browsers | Current Chrome, Safari and Firefox on desktop. |
| Units in the UI | km/h for speed; SI for parameters. |
| Ackermann steering | Not in the slice. |
| Multithreaded physics | Not in the slice (single-thread build). |
| Product name | Undecided; use `GAME_NAME` constant. |
| Should the HUD be on by default | Full HUD on; `H` cycles. |

---

## Appendix A: what the default numbers mean

Computed with the default values (gravity 20 m/s^2, peak grip 1.5, slide ratio 0.78, downforce 0.6 x weight at top speed). Use these as sanity references when tuning.

| Quantity | Value |
|---|---|
| 0 to 100 km/h | about 2.15 s |
| 0 to 55 m/s (198 km/h) | about 6.7 s |
| 0 to 59 m/s | about 10.2 s |
| Peak lateral acceleration at low speed | 30 m/s^2 (about 3.06 x Earth gravity) |
| Sliding lateral acceleration | about 17 m/s^2 |
| Peak lateral acceleration at 60 m/s with downforce | about 35 m/s^2 |
| Full brake from 60 m/s | about 2.6 s, about 77 m (commanded 24 m/s^2; traction with ABS limits it slightly below about 31 m/s) |
| Full brake from 100 km/h | about 1.3 s, about 18 m |
| Launch traction check (drive bias 0.65) | rear axle needs about 9.1 m/s^2 of the roughly 11 m/s^2 it can deliver, so no wheelspin on a plain launch |
| Steering lock at 0 / 15 / 30 / 45 / 60 m/s | 32 / 18.5 / 12.9 / 8.6 / 5 degrees |
| Peak-grip corner radius (no downforce) at 20 / 30 / 40 / 50 / 60 m/s | 18 / 41 / 73 / 113 / 163 m |

## Appendix B: sources and versions

Package versions were read from the public npm registry on 2026-09-20 (`three` 0.186.0, `jolt-physics` 1.1.0, `@dimforge/rapier3d-compat` 0.20.0, `@babylonjs/havok` 1.3.14, `cannon-es` 0.20.0, `vite` 8.3.0, `typescript` 7.0.2, `vitest` 5.0.1, `@playwright/test` 1.63.0). The JoltPhysics.js README page showed an older release number (1.0.1, dated July 2026), so the team MUST confirm the exact version and flavor to install at WP1.

- JoltPhysics.js repository: https://github.com/jrouwe/JoltPhysics.js
- Jolt Physics (C++): https://github.com/jrouwe/JoltPhysics
- Rapier JavaScript determinism guide: https://rapier.rs/docs/user_guides/javascript/determinism/
- three.js WebGPURenderer manual (for a later renderer evaluation): https://threejs.org/manual/en/webgpurenderer.html

