import { describe, expect, it } from 'vitest';
import { Takedowns } from '../src/core/takedowns';
import type { TrafficCarState } from '../src/world/traffic';

function car(id: number, rival = false): TrafficCarState {
  return {
    id,
    bodyId: id,
    position: { x: 0, y: 1, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    forward: { x: 0, y: 0, z: -1 },
    velocity: { x: 0, y: 0, z: -20 },
    laneSide: 1,
    direction: 1,
    speed: 20,
    wrecked: false,
    rival,
    modelKind: 'sedan',
    crush: { front: 0, rear: 0, left: 0, right: 0 },
  };
}

describe('takedown attribution', () => {
  it('credits a direct rival wreck once using the encounter id', () => {
    const tracker = new Takedowns();
    const rival = car(7, true);
    tracker.notePlayerContact(rival, 0.4);
    rival.wrecked = true;
    expect(tracker.update(1 / 120, [rival])).toBe(rival);
    expect(tracker.update(1 / 120, [rival])).toBeUndefined();
    expect(tracker.count).toBe(1);
  });

  it('carries a player shove through multiple car contacts to a wall wreck', () => {
    const tracker = new Takedowns();
    const a = car(1);
    const b = car(2);
    const rival = car(3, true);
    tracker.notePlayerContact(a, 0.2);
    tracker.noteCarContact(a, b);
    tracker.noteCarContact(b, rival);
    rival.wrecked = true;
    expect(tracker.update(1, [a, b, rival])).toBe(rival);
  });

  it('ignores unrelated and expired wrecks', () => {
    const tracker = new Takedowns();
    const unrelated = car(1, true);
    unrelated.wrecked = true;
    expect(tracker.update(0.1, [unrelated])).toBeUndefined();
    expect(tracker.lastObservedVictim).toBe(unrelated);
    expect(tracker.update(0.1, [unrelated])).toBeUndefined();
    expect(tracker.lastObservedVictim).toBeUndefined();
    const late = car(2, true);
    tracker.notePlayerContact(late, 0.1);
    tracker.update(3.1, [late]);
    late.wrecked = true;
    expect(tracker.update(1 / 120, [late])).toBeUndefined();
    expect(tracker.count).toBe(0);
  });

  it('shows an AI wreck without giving the player a takedown or boost credit', () => {
    const tracker = new Takedowns();
    const rival = car(11, true);
    rival.wrecked = true;
    expect(tracker.update(1 / 120, [rival])).toBeUndefined();
    expect(tracker.lastObservedVictim).toBe(rival);
    expect(tracker.count).toBe(0);
    expect(tracker.update(1 / 120, [rival])).toBeUndefined();
    expect(tracker.lastObservedVictim).toBeUndefined();
  });
});
