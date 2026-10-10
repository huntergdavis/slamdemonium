import { describe, expect, it } from 'vitest';
import {
  ROAD_RAGE_DURATION_SECONDS,
  RoadRage,
  roadRageMedal,
} from '../src/core/roadRage';

describe('Road Rage clock and score', () => {
  it('holds scoring and the clock through the countdown, then counts only credited events', () => {
    const event = new RoadRage();
    event.step(2, 5); // even a contact before GO cannot pay
    expect(event.state.count).toBe(0);
    expect(event.state.remaining).toBe(ROAD_RAGE_DURATION_SECONDS);
    event.step(1, 1);
    expect(event.state.phase).toBe('running');
    expect(event.state.goCue).toBeGreaterThan(0);
    expect(event.state.count).toBe(0);
    event.step(1 / 120, 1);
    expect(event.state.count).toBe(1);
    expect(event.state.remaining).toBeLessThan(ROAD_RAGE_DURATION_SECONDS);
  });

  it('awards 3/6/9 medals without ending early and freezes once at time-out', () => {
    const event = new RoadRage();
    event.step(3);
    for (const [count, medal, next] of [
      [3, 'bronze', 6],
      [6, 'silver', 9],
      [9, 'gold', null],
    ] as const) {
      event.step(0, 3);
      expect(event.state.count).toBe(count);
      expect(event.state.medal).toBe(medal);
      expect(event.state.nextTarget).toBe(next);
      expect(event.state.phase).toBe('running');
    }
    event.step(ROAD_RAGE_DURATION_SECONDS);
    expect(event.state.phase).toBe('finished');
    expect(event.state.changed).toBe(true);
    event.step(1, 1);
    expect(event.state.count).toBe(9);
    expect(event.state.remaining).toBe(0);
    expect(event.state.changed).toBe(false);
  });

  it('retries with zero credit and a new full countdown', () => {
    const event = new RoadRage();
    event.step(3);
    event.step(4, 3);
    event.reset();
    expect(event.state.phase).toBe('countdown');
    expect(event.state.count).toBe(0);
    expect(event.state.remaining).toBe(ROAD_RAGE_DURATION_SECONDS);
    expect(event.state.wrecks).toBe(0);
    expect(event.state.finishReason).toBeNull();
    expect(roadRageMedal(0)).toBe('none');
  });

  it('allows two wreck recoveries, then fails without a medal or further credit', () => {
    const event = new RoadRage();
    event.step(3);
    event.step(1, 6);
    event.notePlayerWreck();
    event.notePlayerWreck();
    expect(event.state.wrecks).toBe(2);
    expect(event.state.phase).toBe('running');
    event.notePlayerWreck();
    expect(event.state.phase).toBe('finished');
    expect(event.state.finishReason).toBe('wrecks');
    expect(event.state.medal).toBe('none');
    const count = event.state.count;
    event.notePlayerWreck();
    event.step(5, 2);
    expect(event.state.wrecks).toBe(3);
    expect(event.state.count).toBe(count);
  });
});
