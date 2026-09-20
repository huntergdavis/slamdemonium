import { describe, expect, it } from 'vitest';
import { DEG } from '../src/vehicle/constants';
import {
  slipCurve,
  longitudinalCapacity,
  lateralForce,
} from '../src/vehicle/tire';
import {
  engineAcceleration,
  reverseAcceleration,
  brakeForce,
} from '../src/vehicle/drivetrain';
import {
  countersteerAngle,
  steeringLock,
  VehicleControls,
} from '../src/vehicle/controls';
import {
  frontMassShare,
  limitDissipativeForce,
  suspensionForce,
} from '../src/vehicle/suspension';
import { DriftAssist, gripYawTorque } from '../src/vehicle/assists';
import { TuningStore } from '../src/tuning/store';

describe('tire curve and the approved forgiving ellipse', () => {
  it('peaks at one, is continuous, decays monotonically to sliding grip', () => {
    expect(slipCurve(0, 0.78, 1.5)).toBe(0);
    expect(slipCurve(1, 0.78, 1.5)).toBe(1);
    expect(slipCurve(1 - 1e-8, 0.78, 1.5)).toBeCloseTo(
      slipCurve(1 + 1e-8, 0.78, 1.5),
      7,
    );
    let previous = 1;
    for (let x = 1; x < 100; x += 0.01) {
      const grip = slipCurve(x, 0.78, 1.5);
      expect(grip).toBeLessThanOrEqual(previous);
      expect(grip).toBeGreaterThanOrEqual(0.78);
      previous = grip;
    }
    expect(previous).toBeCloseTo(0.78, 12);
  });
  it('respects the configured ellipse; the strict circle applies only at coupling one', () => {
    for (const coupling of [0, 0.2, 0.85, 1]) {
      for (let fy = 0; fy <= 1000; fy += 10) {
        const fx = longitudinalCapacity(1000, fy, coupling);
        expect(fx ** 2 + coupling * fy ** 2).toBeLessThanOrEqual(1e6 + 1e-8);
        if (coupling === 1)
          expect(Math.hypot(fx, fy)).toBeLessThanOrEqual(1000 + 1e-8);
      }
    }
    expect(longitudinalCapacity(1000, 1000, 0)).toBe(1000);
    expect(Math.hypot(1000, 1000)).toBeCloseTo(Math.SQRT2 * 1000);
    expect(longitudinalCapacity(0, 0, 1)).toBe(0);
  });
  it('opposes lateral slip at low speed and caps dissipative impulse without blocking launch', () => {
    expect(lateralForce(0, 0.2, 0.78, 1.5, 1000, 0, 0.1, 3)).toBe(-200);
    expect(limitDissipativeForce(-1000, 0.01, 325, 1 / 60)).toBeCloseTo(-195);
    expect(limitDissipativeForce(1000, 0.01, 325, 1 / 60)).toBe(0);
    expect(engineAcceleration(0, 14, 60, 2)).toBe(14);
  });
});
describe('engine and braking', () => {
  it('has literal endpoints and monotone acceleration', () => {
    let previous = 14;
    for (let v = 0; v <= 65; v += 0.1) {
      const acceleration = engineAcceleration(v, 14, 60, 2);
      expect(acceleration).toBeLessThanOrEqual(previous);
      expect(acceleration).toBeGreaterThanOrEqual(0);
      previous = acceleration;
    }
    expect(engineAcceleration(60, 14, 60, 2)).toBe(0);
    expect(reverseAcceleration(0, 14, 0, 2)).toBe(0);
    expect(reverseAcceleration(15, 14, 15, 2)).toBe(0);
  });
  it('hits the specified headless 0-100 km/h and 0-55 m/s times', () => {
    let speed = 0,
      time = 0,
      to100 = 0;
    while (speed < 55) {
      speed += engineAcceleration(speed, 14, 60, 2) / 120;
      time += 1 / 120;
      if (!to100 && speed >= 100 / 3.6) to100 = time;
    }
    expect(to100).toBeGreaterThanOrEqual(2);
    expect(to100).toBeLessThanOrEqual(2.3);
    expect(time).toBeGreaterThanOrEqual(6.3);
    expect(time).toBeLessThanOrEqual(7.1);
  });
  it('braking cannot reverse wheel speed and ABS zero delivers sliding friction', () => {
    expect(brakeForce(10000, 20, 1000, 0.78, 0, 325, 1 / 120)).toBe(-780);
    expect(brakeForce(10000, 20, 1000, 0.78, 1, 325, 1 / 120)).toBe(-1000);
    const force = brakeForce(10000, 0.1, 1000, 0.78, 1, 325, 1 / 60);
    expect(0.1 + force / 325 / 60).toBeGreaterThanOrEqual(0);
  });
});
describe('steering and suspension signs', () => {
  it('moves front static weight forward with a positive COM offset', () => {
    expect(frontMassShare(0)).toBe(0.5);
    expect(frontMassShare(0.4)).toBeGreaterThan(0.5);
    expect(frontMassShare(-0.4)).toBeLessThan(0.5);
    expect(suspensionForce(0.08, 0, 325, 2.2, 0.55, 0.25)).toBeGreaterThan(0);
  });
  it('shrinks lock monotonically and countersteers a rightward slide to the right', () => {
    let previous = 32;
    for (let speed = 0; speed <= 60; speed++) {
      const lock = steeringLock(speed, 32, 5, 60, 0.5);
      expect(lock).toBeLessThanOrEqual(previous);
      previous = lock;
    }
    expect(previous).toBe(5);
    expect(countersteerAngle(0.2, 0.2, 0.6, 1)).toBeLessThan(0);
    expect(countersteerAngle(0.2, 0.2, 0, 1)).toBe(0);
    expect(
      gripYawTorque(1, 0.2, 20, 20, 0, 0, 17, 4, 0.4, 2000),
    ).toBeGreaterThan(0);
  });
  it('filters gamepad deadzone, keyboard ramps, and handbrake recovery in seconds', () => {
    const tuning = new TuningStore();
    for (const hz of [60, 120, 240]) {
      const controls = new VehicleControls();
      const raw = {
        throttle: 1,
        brake: 0,
        steer: 1,
        handbrake: true,
        boost: false,
      };
      for (let i = 0; i < hz; i++)
        controls.update(raw, 'keyboard', tuning, 1 / hz);
      expect(controls.throttle).toBe(1);
      expect(controls.steer).toBe(1);
      expect(controls.rearGrip).toBeCloseTo(0.35);
      raw.handbrake = false;
      raw.steer = 0.04;
      for (let i = 0; i < hz; i++)
        controls.update(raw, 'gamepad', tuning, 1 / hz);
      expect(controls.steer).toBeCloseTo(0);
      expect(controls.rearGrip).toBe(1);
    }
  });
});
describe('approved stateful drift control', () => {
  it('captures neutral, requests a true zero exit, and mirrors torque signs', () => {
    for (const sign of [-1, 1]) {
      const drift = new DriftAssist();
      drift.torque(
        1 / 120,
        sign * 20 * DEG,
        30,
        4,
        sign * 0.2,
        1,
        false,
        55 * DEG,
        0.4,
        2000,
      );
      for (let i = 0; i < 120; i++)
        drift.torque(
          1 / 120,
          sign * 20 * DEG,
          30,
          4,
          0,
          1,
          false,
          55 * DEG,
          0.4,
          2000,
        );
      expect(drift.target).toBeCloseTo(sign * 20 * DEG);
      let torque = 0;
      for (let i = 0; i < 120; i++)
        torque = drift.torque(
          1 / 120,
          sign * 20 * DEG,
          30,
          4,
          -sign,
          1,
          false,
          55 * DEG,
          0.4,
          2000,
        );
      expect(drift.target).toBe(0);
      expect(Math.sign(torque)).toBe(-sign);
    }
  });
  it('gates every tracking/limiter term at zero assist and resets airborne/reverse state', () => {
    const drift = new DriftAssist();
    for (const strength of [0.4, 0]) {
      const torque = drift.torque(
        1 / 120,
        80 * DEG,
        30,
        4,
        1,
        1,
        true,
        55 * DEG,
        strength,
        2000,
      );
      if (!strength) expect(torque).toBe(0);
      else expect(torque).toBeLessThan(0);
    }
    drift.torque(1 / 120, 20 * DEG, 30, 4, 1, 1, false, 55 * DEG, 0.4, 2000);
    expect(drift.side).toBe(1);
    expect(
      drift.torque(1 / 120, 20 * DEG, -10, 4, 1, 1, false, 55 * DEG, 0.4, 2000),
    ).toBe(0);
    expect(drift.side).toBe(0);
  });
  it('exits only after hysteresis, resets on sign crossing, and slews equally at 60/120/240 Hz', () => {
    for (const hz of [60, 120, 240]) {
      const drift = new DriftAssist();
      drift.torque(1 / hz, 20 * DEG, 30, 4, 0, 1, true, 55 * DEG, 0.4, 2000);
      for (let i = 0; i < hz / 4; i++)
        drift.torque(1 / hz, 20 * DEG, 30, 4, 1, 1, false, 55 * DEG, 0.4, 2000);
      expect(drift.target / DEG).toBeCloseTo(42.5, 8);
      drift.torque(1 / hz, 5 * DEG, 30, 4, 0, 1, false, 55 * DEG, 0.4, 2000);
      expect(drift.side).toBe(1);
      for (let i = 1; i < hz / 10; i++)
        drift.torque(1 / hz, 5 * DEG, 30, 4, 0, 1, false, 55 * DEG, 0.4, 2000);
      expect(drift.side).toBe(0);
      drift.torque(1 / hz, 20 * DEG, 30, 4, 1, 1, true, 55 * DEG, 0.4, 2000);
      drift.torque(1 / hz, -20 * DEG, 30, 4, 1, 1, true, 55 * DEG, 0.4, 2000);
      expect(drift.side).toBe(0);
    }
  });
});
