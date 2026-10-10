import { describe, expect, it } from 'vitest';
import {
  ImpactTime,
  IMPACT_AUTO_SECONDS,
  IMPACT_MAX_ADDED_LATERAL_SPEED,
  IMPACT_MAX_SIM_SECONDS,
  IMPACT_MAX_WALL_SECONDS,
  IMPACT_TIME_SCALE,
} from '../src/core/impactTime';

describe('player Impact Time', () => {
  it('gives a short automatic beat and then returns the player without input', () => {
    const episode = new ImpactTime();
    episode.start();
    expect(episode.timeScale).toBe(IMPACT_TIME_SCALE);
    episode.advanceWall(IMPACT_AUTO_SECONDS - 0.01, false);
    expect(episode.active).toBe(true);
    episode.advanceWall(0.01, false);
    expect(episode.consumeRecovery()).toBe(true);
    expect(episode.consumeRecovery()).toBe(false);
    expect(episode.timeScale).toBe(1);
  });

  it('extends while held, but neither wall time nor simulation time can run forever', () => {
    const episode = new ImpactTime();
    episode.start();
    episode.advanceWall(IMPACT_MAX_WALL_SECONDS - 0.01, true);
    expect(episode.active).toBe(true);
    episode.advanceWall(0.01, true);
    expect(episode.consumeRecovery()).toBe(true);

    episode.start();
    episode.advanceSimulation(IMPACT_MAX_SIM_SECONDS);
    expect(episode.consumeRecovery()).toBe(true);
    episode.reset();
    expect(episode.consumeRecovery()).toBe(false);
  });

  it('bounds held steering across the entire wreck episode', () => {
    const episode = new ImpactTime();
    episode.start();
    let added = 0;
    for (let step = 0; step < 3 * 120; step++) {
      added += episode.steerDeltaVelocity(1, 1 / 120);
      expect(episode.consumeRecovery()).toBe(false);
    }
    expect(added).toBeCloseTo(IMPACT_MAX_ADDED_LATERAL_SPEED);
    expect(episode.steerDeltaVelocity(1, 1 / 120)).toBe(0);
    episode.reset();
    expect(episode.steerDeltaVelocity(1, 1 / 120)).toBe(0);
  });
});
