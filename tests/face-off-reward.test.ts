import { describe, expect, it } from 'vitest';
import {
  awardFaceOffWin,
  createFaceOffReward,
  FACE_OFF_REWARD_KEY,
} from '../src/core/faceOffReward';
import type { RaceState } from '../src/core/raceEvent';

describe('Face Off prize', () => {
  it('stays locked on a loss or retry, then persists only an earned livery', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
    const reward = createFaceOffReward(storage);
    expect(reward.select('vesper-gold')).toBe(false);
    expect(reward.unlocked).toBe(false);
    expect(values.has(FACE_OFF_REWARD_KEY)).toBe(false);
    expect(reward.unlock()).toBe(true);
    expect(reward.select('vesper-gold')).toBe(true);
    const reloaded = createFaceOffReward(storage);
    expect(reloaded.unlocked).toBe(true);
    expect(reloaded.selected).toBe('vesper-gold');
    expect(reloaded.unlock()).toBe(false);
  });

  it('keeps the won prize in session if storage is blocked', () => {
    const blocked = {
      getItem: (): string | null => {
        throw new Error('blocked');
      },
      setItem: (): void => {
        throw new Error('blocked');
      },
    };
    const reward = createFaceOffReward(blocked);
    reward.unlock();
    expect(reward.select('vesper-gold')).toBe(true);
    expect(reward.selected).toBe('vesper-gold');
  });

  it('awards only a validated two-car first-place finish', () => {
    const reward = createFaceOffReward(null);
    const state = { phase: 'running', position: 1, fieldSize: 2 } as RaceState;
    expect(awardFaceOffWin(state, reward)).toBe(false);
    expect(
      awardFaceOffWin({ ...state, phase: 'finished', position: 2 }, reward),
    ).toBe(false);
    expect(
      awardFaceOffWin({ ...state, phase: 'finished', fieldSize: 6 }, reward),
    ).toBe(false);
    expect(reward.unlocked).toBe(false);
    expect(awardFaceOffWin({ ...state, phase: 'finished' }, reward)).toBe(true);
  });
});
