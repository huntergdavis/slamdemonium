import { describe, expect, it } from 'vitest';
import { RoadRageBest, roadRageBestKey } from '../src/core/roadRageBest';

describe('Road Rage personal best', () => {
  it('uses event, car and a stable tuning fingerprint in the key', () => {
    const a = roadRageBestKey('road-rage', 'player-1.2', {
      grip: 1,
      gravity: 20,
    });
    expect(a).toBe(
      roadRageBestKey('road-rage', 'player-1.2', { gravity: 20, grip: 1 }),
    );
    expect(a).not.toBe(
      roadRageBestKey('road-rage', 'player-1.2', { grip: 1.1, gravity: 20 }),
    );
    expect(a).not.toBe(roadRageBestKey('other', 'player-1.2', {}));
  });

  it('keeps a completed best across reload and breaks ties on fewer wrecks', () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value);
      },
    };
    const best = new RoadRageBest('event', storage);
    best.record(6, 2);
    best.record(6, 1);
    best.record(5, 0);
    expect(new RoadRageBest('event', storage).value).toEqual({
      count: 6,
      wrecks: 1,
    });
  });

  it('survives blocked and corrupt storage without losing its session best', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    const best = new RoadRageBest('event', blocked);
    expect(best.record(3, 1)).toEqual({ count: 3, wrecks: 1 });
    expect(best.value).toEqual({ count: 3, wrecks: 1 });
    const corrupt = new RoadRageBest('event', {
      getItem: () => '{bad',
      setItem: () => {},
    });
    expect(corrupt.value).toBeNull();
  });
});
