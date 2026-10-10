import type { CrashMedal } from './crashMode';
import {
  garageClassAllowedOnMap,
  type GarageClassId,
} from '../vehicle/garageClasses';

export const GARAGE_REWARDS_KEY = 'slamdemonium.garageRewards.v1';
export type HeavyRewardId = 'pickup' | 'suv' | 'bus';
const HEAVY_REWARDS = ['pickup', 'suv', 'bus'] as const;
const MEDAL_RANK: Readonly<Record<CrashMedal, number>> = {
  none: 0,
  bronze: 1,
  silver: 2,
  gold: 3,
};

export function garageRewardRequirement(id: GarageClassId): string | undefined {
  if (id === 'pickup') return 'Crash bronze';
  if (id === 'suv') return 'Crash silver';
  if (id === 'bus') return 'Crash gold';
  return undefined;
}

/** Reward IDs outlive a score, retry and pooled vehicle body. */
export class GarageRewards {
  private readonly unlocked = new Set<HeavyRewardId>();
  private earnedThisRun: HeavyRewardId[] = [];

  constructor(
    private readonly storage?: Pick<Storage, 'getItem' | 'setItem'> | null,
  ) {
    try {
      const parsed: unknown = JSON.parse(
        storage?.getItem(GARAGE_REWARDS_KEY) ?? 'null',
      );
      if (!Array.isArray(parsed)) return;
      for (const id of parsed)
        if (HEAVY_REWARDS.includes(id as HeavyRewardId))
          this.unlocked.add(id as HeavyRewardId);
    } catch {
      // A blocked or stale store still allows awards for this session.
    }
  }

  isUnlocked(id: GarageClassId): boolean {
    if (id !== 'pickup' && id !== 'suv' && id !== 'bus') return true;
    return this.unlocked.has(id);
  }

  canSelect(id: GarageClassId, mapName: string): boolean {
    return garageClassAllowedOnMap(id, mapName) && this.isUnlocked(id);
  }

  awardCrashMedal(medal: CrashMedal): readonly HeavyRewardId[] {
    const newlyEarned: HeavyRewardId[] = [];
    for (const id of HEAVY_REWARDS.slice(0, MEDAL_RANK[medal])) {
      if (this.unlocked.has(id)) continue;
      this.unlocked.add(id);
      newlyEarned.push(id);
    }
    if (newlyEarned.length) {
      this.earnedThisRun.push(...newlyEarned);
      try {
        this.storage?.setItem(
          GARAGE_REWARDS_KEY,
          JSON.stringify(HEAVY_REWARDS.filter((id) => this.unlocked.has(id))),
        );
      } catch {
        // Preserve the reward in memory if storage is blocked.
      }
    }
    return newlyEarned;
  }

  beginCrashRun(): void {
    this.earnedThisRun = [];
  }

  resultText(medal: CrashMedal): string {
    if (this.earnedThisRun.length)
      return `NEW GARAGE ${this.earnedThisRun.join(' + ').toUpperCase()}`;
    if (medal === 'none') return 'BRONZE UNLOCKS PICKUP';
    return `${HEAVY_REWARDS.slice(0, MEDAL_RANK[medal]).join(' + ').toUpperCase()} OWNED`;
  }
}
