/** A self-contained timed takedown event. Its clock advances only in physics
 * steps, so pause, render rate and the takedown camera cannot change the score. */
export const ROAD_RAGE_COUNTDOWN_SECONDS = 3;
export const ROAD_RAGE_DURATION_SECONDS = 180;
export const ROAD_RAGE_MEDALS = [3, 6, 9] as const;

export type RoadRagePhase = 'countdown' | 'running' | 'finished';
export type RoadRageMedal = 'none' | 'bronze' | 'silver' | 'gold';

export interface RoadRageState {
  readonly phase: RoadRagePhase;
  readonly countdown: number;
  readonly goCue: number;
  readonly remaining: number;
  readonly count: number;
  readonly nextTarget: number | null;
  readonly medal: RoadRageMedal;
  /** True on the physics step when GO or the result first appears. */
  readonly changed: boolean;
}

export function roadRageMedal(count: number): RoadRageMedal {
  if (count >= ROAD_RAGE_MEDALS[2]) return 'gold';
  if (count >= ROAD_RAGE_MEDALS[1]) return 'silver';
  if (count >= ROAD_RAGE_MEDALS[0]) return 'bronze';
  return 'none';
}

export class RoadRage {
  readonly state: RoadRageState & {
    phase: RoadRagePhase;
    countdown: number;
    goCue: number;
    remaining: number;
    count: number;
    nextTarget: number | null;
    medal: RoadRageMedal;
    changed: boolean;
  } = {
    phase: 'countdown',
    countdown: ROAD_RAGE_COUNTDOWN_SECONDS,
    goCue: 0,
    remaining: ROAD_RAGE_DURATION_SECONDS,
    count: 0,
    nextTarget: ROAD_RAGE_MEDALS[0],
    medal: 'none',
    changed: true,
  };

  step(dt: number, creditedTakedowns = 0): void {
    const state = this.state;
    state.changed = false;
    if (state.phase === 'finished') return;
    const elapsed = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    if (state.phase === 'countdown') {
      state.countdown = Math.max(0, state.countdown - elapsed);
      if (state.countdown < 1e-9) state.countdown = 0;
      if (state.countdown === 0) {
        state.phase = 'running';
        state.goCue = 0.8;
        state.changed = true;
      }
      return;
    }
    state.goCue = Math.max(0, state.goCue - elapsed);
    state.count += Math.max(0, Math.floor(creditedTakedowns));
    state.medal = roadRageMedal(state.count);
    state.nextTarget =
      ROAD_RAGE_MEDALS.find((target) => target > state.count) ?? null;
    state.remaining = Math.max(0, state.remaining - elapsed);
    if (state.remaining < 1e-9) state.remaining = 0;
    if (state.remaining === 0) {
      state.phase = 'finished';
      state.changed = true;
    }
  }

  reset(): void {
    const state = this.state;
    state.phase = 'countdown';
    state.countdown = ROAD_RAGE_COUNTDOWN_SECONDS;
    state.goCue = 0;
    state.remaining = ROAD_RAGE_DURATION_SECONDS;
    state.count = 0;
    state.nextTarget = ROAD_RAGE_MEDALS[0];
    state.medal = 'none';
    state.changed = true;
  }
}
