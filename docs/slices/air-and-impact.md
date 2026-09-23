# Slice design: air and impact

Status: proposed, 2026-09-22. Owner: PM. Supersedes nothing.

The CTO agreed to a smashing slice and added ramps and jumping, because air
time is a core arcade-racer pleasure. This document is the readiness
assessment and the work breakdown. Every claim below was verified against the
code, not assumed; file references are given so they can be re-checked when
they rot.

## 1. What already exists

- Per-wheel ground contact (`WheelState.grounded`, `VehicleTelemetry.groundedWheels`)
  derived from four suspension raycasts. There is **no** airborne flag, no air
  timer and no landing edge; `wasGrounded` is a per-wheel local that is not retained.
- Hardcoded flight stabilisation: pitch and roll damping of `-0.8 * I * omega`
  whenever fewer than two wheels are grounded. The `0.8` is a literal with no
  tuning key. The roll-righting assist is deliberately gated off while moving
  fast off the ground.
- A contact listener, wired to camera, haptics and audio, with a per-body
  cooldown and a bounded event queue.
- Surfaces are a shared, dense, append-only catalogue resolved per ray hit.

## 2. What blocks ramps and jumping

These are the findings that change the plan. They are ordered by how much
they cost if discovered late.

1. **A pitched ramp cannot be expressed.** The physics adapter's only static
   factory is `createStaticBox`, whose rotation is yaw-only. There is no wedge,
   convex hull, mesh or heightfield. Either the adapter gains a quaternion shape
   descriptor, or a ramp becomes a staircase of yaw-only boxes, which would be
   audible through the suspension and is not acceptable.
2. **An unregistered body has zero grip.** The surface resolver is a closed
   snapshot registered at boot with exactly the ground and the barriers. A hit on
   any other body resolves to `null`, and a `null` surface makes the tyre model
   skip the wheel entirely. A ramp added without a registered surface would give
   suspension spring force and **no tyre force at all**: the car would ride up it
   with no grip, no braking and no steering. This is the single easiest way to
   lose a week to a confusing bug.
3. **Downforce is applied unconditionally along the body's down axis**, outside
   the grounded loop. A fast airborne car therefore carries a body-relative force
   in flight, and an inverted one gets pushed *upward* in world space. This is a
   latent bug today because nothing launches the car; ramps will expose it.
4. **There is no runtime body removal**, and debris needs one.
5. **The heap regression asserts exact equality** of the WebAssembly heap after a
   60 second baseline. Creating and destroying bodies at runtime will fail it.
   The answer is a pool allocated during boot, with bodies activated and
   deactivated rather than created and destroyed. That also gives instant retry
   for free, which the run loop needs anyway.
6. **A big jump can leave the world.** The barrier ring sits at 152 m and the
   ground *collider* stops near 154 m, while the visual ground runs to 1000 m.
   A ramp that clears the barrier drops the car past the kill plane and respawns
   it. Ramps must either aim inward or the ground collider must grow.

## 3. Fixtures and gates this work will trip

Named here so nobody is surprised by a red build they did not cause.

- Adding colliders to the default track breaks two unit tests that pin the
  static-body count at 129, and invalidates the replay fixtures for the three
  scripted-input examples, which run on the default ring.
- `grounded`, `compression` and `suspensionLength` are all inside the
  determinism hash, so any change to the airborne reset block changes the digest.
- A per-run assertion measures peak angular speed against the 12 rad/s clamp, so
  a big flip is already bounded.
- The allocation test forbids new per-frame materials and any growth of the
  WebAssembly heap.
- The acceleration and braking regressions run on a flat plane, so track geometry
  does not affect them. Vehicle-model changes do.

## 4. Work breakdown

Phase A is shared: both ramps and smashing need all of it.

**Phase A, foundations.**
- A1 Quaternion shape descriptors for static bodies, so a ramp is one body.
- A2 A pooled body lifecycle: allocate at boot, activate and deactivate at
  runtime, never create or destroy mid-session. Add scoped removal to the
  adapter for teardown correctness, but do not use it on the hot path.
- A3 Surface registration for bodies added after boot, so new geometry has grip.

**Phase B, air.**
- B1 Airborne state in telemetry: an airborne flag, air time, and a landing
  event as a monotonic counter rather than a one-step flag, matching how shift
  events already cross the rate boundary.
- B2 Fix downforce so it does not act on an airborne car.
- B3 Air control: player pitch and roll authority while off the ground, with the
  existing hardcoded damping promoted to a tuning key.
- B4 Camera and landing feel, including reviving the camera impact kick, which is
  dead today because it ignores a null impulse.
- B5 Ramp geometry in the track layout, sharing the one descriptor array that
  keeps collision and visuals in sync.

**Phase C, impact.**
- C1 One shared impact severity estimator. Contact impulse is null on our engine,
  so severity must be estimated from approach speed and mass. Haptics and audio
  already estimate it separately; fold those into one definition rather than
  adding a third.
- C2 Breakable props on pooled bodies.
- C3 Scoring from severity, with chaining.
- C4 Run loop: countdown, timed run, score, instant retry.

## 5. Recommended sequencing

Phase A then B then C, and ship air before impact. Jumping is self-contained and
immediately enjoyable, it forces the adapter work that props need anyway, and it
gives the smash loop its best setups. Shipping impact first would mean building
scoring against a car that cannot yet leave the ground.

## 6. Open question for the CTO

Air first, or impact first? Phase A is the same either way and can start now.
