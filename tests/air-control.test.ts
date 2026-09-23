import { describe, expect, it } from 'vitest';
import {
  AIR_CONTROL_GATE_SECONDS,
  AIR_CONTROL_RAMP_SECONDS,
  airControlTorques,
  airControlWeight,
  type AirAttitude,
  type AirControlInputs,
  type AirControlTorques,
} from '../src/vehicle/airControl';
import { AirStateTracker, type AirborneState } from '../src/vehicle/airState';

const DT = 1 / 120;
const level = (): AirAttitude => ({
  pitchAngle: 0,
  rollAngle: 0,
  pitchRate: 0,
  rollRate: 0,
  inertiaPitch: 900,
  inertiaRoll: 400,
});
const inputs = (over: Partial<AirControlInputs> = {}): AirControlInputs => ({
  throttle: 1,
  brake: 0,
  steer: 0,
  throttleAtTakeoff: 1,
  ...over,
});
const OPTION_A = { authorityTurnsPerSecond: 0.25, autoLevel: 0.5 };
const OPTION_B = { authorityTurnsPerSecond: 0.25, autoLevel: 0 };
const out = (): AirControlTorques => ({ pitch: 0, roll: 0, weight: 0 });
const FULL = AIR_CONTROL_GATE_SECONDS + AIR_CONTROL_RAMP_SECONDS + 1;

describe('air control authority', () => {
  it('is zero before the gate, ramps in, and is zero the moment a wheel touches', () => {
    expect(airControlWeight(0)).toBe(0);
    expect(airControlWeight(AIR_CONTROL_GATE_SECONDS)).toBe(0);
    expect(
      airControlWeight(AIR_CONTROL_GATE_SECONDS + AIR_CONTROL_RAMP_SECONDS / 2),
    ).toBeCloseTo(0.5);
    expect(airControlWeight(FULL)).toBe(1);
    const t = airControlTorques(
      0.05,
      inputs({ brake: 1 }),
      level(),
      OPTION_A,
      out(),
    );
    expect(t).toEqual({ pitch: 0, roll: 0, weight: 0 });
  });

  it('never grants authority to a car skimming in and out of kerb contact', () => {
    // Real derived airTime from the tracker, exactly as the vehicle feeds it:
    // three steps off the ground, one step with a wheel down, repeated.
    const tracker = new AirStateTracker();
    const state: AirborneState = {
      airborne: false,
      airTime: 0,
      lastAirTime: 0,
      landingCount: 0,
    };
    tracker.reset(state);
    let maxWeight = 0;
    let torque = 0;
    for (let step = 0; step < 1200; step++) {
      tracker.step(DT, step % 4 === 3 ? 1 : 0, state);
      const airTime = state.airborne ? state.airTime : 0;
      const t = airControlTorques(
        airTime,
        inputs({ brake: 1, steer: 1 }),
        level(),
        OPTION_A,
        out(),
      );
      maxWeight = Math.max(maxWeight, t.weight);
      torque += Math.abs(t.pitch) + Math.abs(t.roll);
    }
    expect(maxWeight).toBe(0);
    expect(torque).toBe(0);
    expect(state.landingCount).toBe(0); // Hops are not landings either.
    // Two kerb hops per second, each 0.4 s, with brief contact between them:
    // still never past the gate because contact resets the clock.
    for (let step = 0; step < 1200; step++) {
      const inHop = step % 60 < 48;
      tracker.step(DT, inHop ? 0 : 4, state);
      const t = airControlTorques(
        state.airborne ? state.airTime : 0,
        inputs({ brake: 1 }),
        level(),
        OPTION_A,
        out(),
      );
      if (state.airTime <= AIR_CONTROL_GATE_SECONDS) expect(t.weight).toBe(0);
    }
  });

  it('pitches on the change in throttle since takeoff, not the raw pedal, and brakes nose-down', () => {
    // Holding full throttle through the jump is neutral.
    const held = airControlTorques(FULL, inputs(), level(), OPTION_B, out());
    expect(held.pitch).toBe(0);
    // Lifting off dips the nose; pressing beyond takeoff lifts it; brake dips it.
    const lift = airControlTorques(
      FULL,
      inputs({ throttle: 0 }),
      level(),
      OPTION_B,
      out(),
    );
    const press = airControlTorques(
      FULL,
      inputs({ throttle: 1, throttleAtTakeoff: 0.3 }),
      level(),
      OPTION_B,
      out(),
    );
    const brake = airControlTorques(
      FULL,
      inputs({ brake: 1 }),
      level(),
      OPTION_B,
      out(),
    );
    expect(lift.pitch).toBeLessThan(0);
    expect(press.pitch).toBeGreaterThan(0);
    expect(brake.pitch).toBeLessThan(0);
    expect(Math.abs(brake.pitch)).toBeGreaterThan(Math.abs(press.pitch));
    // Steer left banks left: right side up is a negative rotation about forward.
    const left = airControlTorques(
      FULL,
      inputs({ steer: 1 }),
      level(),
      OPTION_B,
      out(),
    );
    expect(left.roll).toBeLessThan(0);
    expect(left.pitch).toBe(0);
  });

  it('tracks a quarter turn per second at full input and no more', () => {
    // At the target rate the rate-tracking term vanishes.
    const atRate = level();
    atRate.pitchRate = -0.25 * 2 * Math.PI;
    const t = airControlTorques(
      FULL,
      inputs({ brake: 1 }),
      atRate,
      OPTION_B,
      out(),
    );
    expect(t.pitch).toBeCloseTo(0, 6);
    atRate.pitchRate = -0.5 * 2 * Math.PI; // Faster than authority: pushed back.
    expect(
      airControlTorques(FULL, inputs({ brake: 1 }), atRate, OPTION_B, out())
        .pitch,
    ).toBeGreaterThan(0);
  });

  it('self-levels toward wheels-down with no input (option A), yields to full input, and is off in option B', () => {
    const tilted = level();
    tilted.pitchAngle = 0.4; // Nose up: restoring torque is nose-down.
    tilted.rollAngle = 0.6; // Right side up: a positive forward-axis rotation lowers it.
    const a = airControlTorques(FULL, inputs(), tilted, OPTION_A, out());
    expect(a.pitch).toBeLessThan(0);
    expect(a.roll).toBeGreaterThan(0);
    // Damping opposes the rate on both axes regardless of angle.
    const spinning = level();
    spinning.pitchRate = 3;
    spinning.rollRate = 3;
    const d = airControlTorques(FULL, inputs(), spinning, OPTION_A, out());
    expect(d.pitch).toBeLessThan(0);
    expect(d.roll).toBeLessThan(0);
    const overridden = airControlTorques(
      FULL,
      inputs({ throttle: 1, throttleAtTakeoff: 0 }),
      tilted,
      OPTION_A,
      out(),
    );
    const pure = airControlTorques(
      FULL,
      inputs({ throttle: 1, throttleAtTakeoff: 0 }),
      level(),
      OPTION_B,
      out(),
    );
    expect(overridden.pitch).toBeCloseTo(pure.pitch, 6); // Full input overrides levelling.
    const b = airControlTorques(FULL, inputs(), tilted, OPTION_B, out());
    expect(b).toEqual({ pitch: 0, roll: 0, weight: 1 });
  });
});
