import { describe, expect, it } from 'vitest';
import {
  AirStateTracker,
  MIN_COUNTED_AIR_SECONDS,
  type AirborneState,
} from '../src/vehicle/airState';

const DT = 1 / 120;
function fresh() {
  const tracker = new AirStateTracker();
  const state: AirborneState = {
    airborne: true,
    airTime: 5,
    lastAirTime: 5,
    landingCount: 3,
  };
  tracker.reset(state);
  return { tracker, state };
}
const run = (
  tracker: AirStateTracker,
  state: AirborneState,
  grounded: number,
  steps: number,
  chassisContact = false,
) => {
  for (let i = 0; i < steps; i++)
    tracker.step(DT, grounded, chassisContact, state);
};

describe('airborne state', () => {
  it('resets flags and timers but never the monotonic landing counter', () => {
    const { state } = fresh();
    expect(state).toEqual({
      airborne: false,
      airTime: 0,
      lastAirTime: 0,
      landingCount: 3,
    });
  });
  it('reports airborne only with no wheel grounded, accumulates air time, and counts one landing per flight', () => {
    const { tracker, state } = fresh();
    run(tracker, state, 4, 10);
    run(tracker, state, 1, 10); // Three wheels up is not airborne.
    expect(state.airborne).toBe(false);
    expect(state.airTime).toBe(0);
    run(tracker, state, 0, 60); // Half a second of flight.
    expect(state.airborne).toBe(true);
    expect(state.airTime).toBeCloseTo(0.5, 6);
    expect(state.landingCount).toBe(3);
    run(tracker, state, 2, 1); // Touchdown on two wheels.
    expect(state.airborne).toBe(false);
    expect(state.airTime).toBe(0);
    expect(state.lastAirTime).toBeCloseTo(0.5, 6);
    expect(state.landingCount).toBe(4);
    run(tracker, state, 4, 100);
    expect(state.landingCount).toBe(4); // No second landing without a flight.
  });
  it('treats a flight shorter than the minimum as a kerb hop: airborne shows, nothing is counted', () => {
    const { tracker, state } = fresh();
    const hop = Math.floor((MIN_COUNTED_AIR_SECONDS * 120) / 2);
    run(tracker, state, 0, hop);
    expect(state.airborne).toBe(true);
    run(tracker, state, 4, 1);
    expect(state.landingCount).toBe(3);
    expect(state.lastAirTime).toBe(0);
  });
  it('ends a flight on static chassis contact: a car on its side is not flying, and the touchdown counts', () => {
    const { tracker, state } = fresh();
    run(tracker, state, 4, 10);
    run(tracker, state, 0, 60); // Half a second of real flight.
    expect(state.airborne).toBe(true);
    run(tracker, state, 0, 1, true); // Comes down on the chassis, wheels up.
    expect(state.airborne).toBe(false);
    expect(state.airTime).toBe(0);
    expect(state.lastAirTime).toBeCloseTo(0.5, 6);
    expect(state.landingCount).toBe(4);
    run(tracker, state, 0, 600, true); // Five seconds sliding on its side.
    expect(state.airborne).toBe(false);
    expect(state.airTime).toBe(0);
    expect(state.landingCount).toBe(4);
    run(tracker, state, 0, 5); // A bounce on its side: airborne again, a hop.
    expect(state.airborne).toBe(true);
    run(tracker, state, 0, 1, true);
    expect(state.landingCount).toBe(4);
  });
});
