import { expect, it } from 'vitest';
import {
  GARAGE_REWARDS_KEY,
  GarageRewards,
  garageRewardRequirement,
} from '../src/core/garageRewards';
import { readGarageClass } from '../src/vehicle/garageClasses';

it('awards bronze, silver and gold once and keeps earned classes after reload', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  const rewards = new GarageRewards(storage);
  expect(rewards.canSelect('pickup', 'crash-south')).toBe(false);
  expect(rewards.awardCrashMedal('bronze')).toEqual(['pickup']);
  expect(rewards.awardCrashMedal('bronze')).toEqual([]);
  expect(rewards.resultText('bronze')).toContain('NEW GARAGE PICKUP');
  rewards.beginCrashRun();
  expect(rewards.awardCrashMedal('silver')).toEqual(['suv']);
  expect(rewards.awardCrashMedal('bronze')).toEqual([]);
  rewards.beginCrashRun();
  expect(rewards.awardCrashMedal('gold')).toEqual(['bus']);
  expect(values.get(GARAGE_REWARDS_KEY)).toBe('["pickup","suv","bus"]');
  const restored = new GarageRewards(storage);
  for (const id of ['pickup', 'suv', 'bus'] as const) {
    expect(restored.canSelect(id, 'crash-west')).toBe(true);
    expect(restored.canSelect(id, 'circuit-race')).toBe(false);
  }
  expect(restored.awardCrashMedal('bronze')).toEqual([]);
  expect(garageRewardRequirement('pickup')).toBe('Crash bronze');
  expect(garageRewardRequirement('suv')).toBe('Crash silver');
  expect(garageRewardRequirement('bus')).toBe('Crash gold');
});

it('rejects a locked pasted URL and keeps session awards if storage fails', () => {
  const storage = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
  };
  const rewards = new GarageRewards(storage);
  const requested = readGarageClass(null, '?car=bus');
  expect(requested).toBe('bus');
  expect(rewards.canSelect(requested, 'crash-south')).toBe(false);
  expect(rewards.canSelect('sports', 'crash-south')).toBe(true);
  expect(rewards.awardCrashMedal('none')).toEqual([]);
  expect(rewards.resultText('none')).toBe('BRONZE UNLOCKS PICKUP');
  expect(rewards.awardCrashMedal('gold')).toEqual(['pickup', 'suv', 'bus']);
  expect(rewards.canSelect('bus', 'crash-south')).toBe(true);
  expect(rewards.canSelect('bus', 'circuit-race')).toBe(false);
});
