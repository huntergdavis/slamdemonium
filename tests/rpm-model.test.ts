import { describe, expect, it } from 'vitest';
import { DEFAULT_ENGINE } from '../src/vehicle/engineProfile';
import { RpmModel, type EngineState } from '../src/vehicle/rpmModel';

function fresh(): { model: RpmModel; state: EngineState } {
  const model = new RpmModel(DEFAULT_ENGINE);
  const state: EngineState = {
    rpm: 0,
    gear: 0,
    gearCount: 0,
    idleRpm: 0,
    redlineRpm: 0,
    upshiftCount: 0,
    downshiftCount: 0,
  };
  model.reset(state);
  return { model, state };
}
const DT = 1 / 120;
const LIFT = 1740;

describe('derived rpm model', () => {
  it('publishes engine identity on reset and idles in first gear at rest', () => {
    const { state } = fresh();
    expect(state).toMatchObject({
      rpm: DEFAULT_ENGINE.idleRpm,
      gear: 1,
      gearCount: DEFAULT_ENGINE.gearCount,
      idleRpm: DEFAULT_ENGINE.idleRpm,
      redlineRpm: DEFAULT_ENGINE.redlineRpm,
      upshiftCount: 0,
      downshiftCount: 0,
    });
  });
  it('publishes identity on the very first step without a reset', () => {
    const model = new RpmModel(DEFAULT_ENGINE);
    const state: EngineState = {
      rpm: 0,
      gear: 0,
      gearCount: 0,
      idleRpm: 0,
      redlineRpm: 0,
      upshiftCount: 0,
      downshiftCount: 0,
    };
    model.step(DT, 0, 0, 0, LIFT, state);
    expect(state.gearCount).toBe(DEFAULT_ENGINE.gearCount);
    expect(state.idleRpm).toBe(DEFAULT_ENGINE.idleRpm);
    expect(state.redlineRpm).toBe(DEFAULT_ENGINE.redlineRpm);
    expect(state.gear).toBe(1);
  });
  it('shifts up through every gear on a speed ramp, counts each shift once, and never exceeds the redline without boost', () => {
    const { model, state } = fresh();
    let peak = 0;
    let drops = 0;
    let previous = 0;
    for (let step = 1; step <= 1200; step++) {
      model.step(DT, (step / 1200) * 60, 1, 0, LIFT, state);
      peak = Math.max(peak, state.rpm);
      if (previous - state.rpm > 10) drops++;
      previous = state.rpm;
    }
    expect(state.gear).toBe(DEFAULT_ENGINE.gearCount);
    expect(state.upshiftCount).toBe(DEFAULT_ENGINE.gearCount - 1);
    expect(state.downshiftCount).toBe(0);
    expect(peak).toBeLessThanOrEqual(DEFAULT_ENGINE.redlineRpm + 1e-6);
    expect(drops).toBeGreaterThan(20); // Each shift is a run of falling steps.
    for (let step = 1; step <= 1200; step++)
      model.step(DT, ((1200 - step) / 1200) * 60, 0, 0, LIFT, state);
    expect(state.gear).toBe(1);
    expect(state.downshiftCount).toBe(DEFAULT_ENGINE.gearCount - 1);
    expect(state.upshiftCount).toBe(DEFAULT_ENGINE.gearCount - 1); // Monotonic.
  });
  it('revs on the pedal before the car moves, and boost spins past the redline', () => {
    const { model, state } = fresh();
    for (let step = 0; step < 60; step++) model.step(DT, 0, 0, 0, LIFT, state);
    const idle = state.rpm;
    for (let step = 0; step < 6; step++) model.step(DT, 0, 1, 0, LIFT, state);
    expect(state.rpm - idle).toBeGreaterThan(400); // Within 50 ms.
    for (let step = 0; step < 240; step++)
      model.step(DT, 60, 1, 1, LIFT, state);
    expect(state.rpm).toBeGreaterThan(DEFAULT_ENGINE.redlineRpm);
    expect(state.rpm).toBeLessThanOrEqual(DEFAULT_ENGINE.boostRpm + 1e-6);
  });
  it('keeps first gear in reverse and follows speed magnitude', () => {
    const { model, state } = fresh();
    for (let step = 0; step < 240; step++)
      model.step(DT, -6, 0.5, 0, LIFT, state);
    expect(state.gear).toBe(1);
    expect(state.upshiftCount).toBe(0);
    expect(state.rpm).toBeGreaterThan(DEFAULT_ENGINE.idleRpm + 1000);
  });

  it('shifts sooner with tighter live gear spacing and later with wider, on the same speed ramp', () => {
    const shiftSpeed = (ratio: number): number => {
      const { model, state } = fresh();
      for (let step = 1; step <= 2400; step++) {
        const speed = (step / 2400) * 60;
        model.step(DT, speed, 1, 0, LIFT, state, ratio);
        if (state.upshiftCount === 2) return speed;
      }
      return Infinity;
    };
    const tight = shiftSpeed(1.3);
    const shipped = shiftSpeed(DEFAULT_ENGINE.gearRatio);
    const wide = shiftSpeed(2.5);
    expect(tight).toBeLessThan(shipped);
    expect(shipped).toBeLessThan(wide);
    expect(shipped).toBeCloseTo(12 * DEFAULT_ENGINE.gearRatio, 0);
  });
});
