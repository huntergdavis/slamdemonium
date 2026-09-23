/** Derived airborne state for presentation, scoring and air control.
 * Computed once per physics step from the suspension's grounded count and
 * written to telemetry; never an input to forces. Landings are a monotonic
 * counter so a 30 Hz consumer polling 120 Hz physics misses none of them,
 * the same contract as the gearbox shift counters. */
export interface AirborneState {
  /** No wheel has ground contact this step. */
  airborne: boolean;
  /** Seconds since every wheel left the ground; 0 while grounded. */
  airTime: number;
  /** Duration of the most recent counted flight, kept until the next one. */
  lastAirTime: number;
  /** Counted flights that ended in ground contact; only ever increases. */
  landingCount: number;
}

/** A flight shorter than this is a kerb hop, not a jump: it neither counts a
 * landing nor updates lastAirTime, though `airborne` still reports it. */
export const MIN_COUNTED_AIR_SECONDS = 0.1;

export class AirStateTracker {
  private airTime = 0;
  private wasAirborne = false;

  reset(state: AirborneState): void {
    this.airTime = 0;
    this.wasAirborne = false;
    state.airborne = false;
    state.airTime = 0;
    state.lastAirTime = 0;
  }

  step(dt: number, groundedWheels: number, state: AirborneState): void {
    const airborne = groundedWheels === 0;
    if (airborne) this.airTime += dt;
    else if (this.wasAirborne) {
      if (this.airTime >= MIN_COUNTED_AIR_SECONDS) {
        state.lastAirTime = this.airTime;
        state.landingCount++;
      }
      this.airTime = 0;
    }
    this.wasAirborne = airborne;
    state.airborne = airborne;
    state.airTime = airborne ? this.airTime : 0;
  }
}
