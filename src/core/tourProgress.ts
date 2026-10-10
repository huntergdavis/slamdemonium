export const TOUR_PROGRESS_KEY = 'slamdemonium.worldTour.v1';
export const TOUR_PROGRESS_VERSION = 1;

export type TourMedal = 'none' | 'bronze' | 'silver' | 'gold';

export interface TourResultIdentity {
  readonly eventId: string;
  readonly routeId: string;
  readonly carId: string;
  readonly tuningFingerprint: string;
  readonly rulesVersion: number;
}

export interface TourResult extends TourResultIdentity {
  readonly medal: TourMedal;
  /** The mode's own score, not a shared scale across formats. */
  readonly score: number;
}

export interface TourProgressSnapshot {
  readonly version: 1;
  readonly results: Readonly<Record<string, TourResult>>;
  /** Stable IDs survive a mode's tuning or scoring version change. */
  readonly rewards: readonly string[];
}

export interface TourProgressStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const MEDAL_RANK: Readonly<Record<TourMedal, number>> = {
  none: 0,
  bronze: 1,
  silver: 2,
  gold: 3,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isResult(value: unknown): value is TourResult {
  if (!isRecord(value)) return false;
  return (
    typeof value.eventId === 'string' &&
    value.eventId.length > 0 &&
    typeof value.routeId === 'string' &&
    value.routeId.length > 0 &&
    typeof value.carId === 'string' &&
    value.carId.length > 0 &&
    typeof value.tuningFingerprint === 'string' &&
    value.tuningFingerprint.length > 0 &&
    Number.isSafeInteger(value.rulesVersion) &&
    (value.rulesVersion as number) > 0 &&
    typeof value.medal === 'string' &&
    Object.hasOwn(MEDAL_RANK, value.medal) &&
    typeof value.score === 'number' &&
    Number.isFinite(value.score) &&
    value.score >= 0
  );
}

/** Result comparisons never cross a route, car, tuning or rules change. */
export function tourResultKey(identity: TourResultIdentity): string {
  return JSON.stringify([
    identity.eventId,
    identity.routeId,
    identity.carId,
    identity.tuningFingerprint,
    identity.rulesVersion,
  ]);
}

function parseSnapshot(value: unknown): TourProgressSnapshot | undefined {
  if (!isRecord(value) || value.version !== TOUR_PROGRESS_VERSION) return;
  if (!isRecord(value.results) || !Array.isArray(value.rewards)) return;
  const results: Record<string, TourResult> = {};
  for (const [key, result] of Object.entries(value.results)) {
    if (!isResult(result) || tourResultKey(result) !== key) return;
    results[key] = result;
  }
  if (
    !value.rewards.every(
      (reward): reward is string =>
        typeof reward === 'string' && reward.length > 0,
    )
  )
    return;
  return {
    version: TOUR_PROGRESS_VERSION,
    results,
    rewards: [...new Set(value.rewards as string[])],
  };
}

export class TourProgress {
  private readonly results = new Map<string, TourResult>();
  private readonly rewards = new Set<string>();

  constructor(
    private readonly storage: TourProgressStorage | null,
    saved?: unknown,
  ) {
    let source = saved;
    if (source === undefined) {
      try {
        source = JSON.parse(storage?.getItem(TOUR_PROGRESS_KEY) ?? 'null');
      } catch {
        source = null;
      }
    }
    const parsed = parseSnapshot(source);
    if (!parsed) return;
    for (const [key, result] of Object.entries(parsed.results))
      this.results.set(key, result);
    for (const reward of parsed.rewards) this.rewards.add(reward);
  }

  snapshot(): TourProgressSnapshot {
    return {
      version: TOUR_PROGRESS_VERSION,
      results: Object.fromEntries(this.results),
      rewards: [...this.rewards],
    };
  }

  hasReward(id: string): boolean {
    return this.rewards.has(id);
  }

  /** The best medal for an event, across valid cars and scoring versions. */
  bestMedal(eventId: string): TourMedal {
    let best: TourMedal = 'none';
    for (const result of this.results.values())
      if (
        result.eventId === eventId &&
        MEDAL_RANK[result.medal] > MEDAL_RANK[best]
      )
        best = result.medal;
    return best;
  }

  result(identity: TourResultIdentity): TourResult | undefined {
    return this.results.get(tourResultKey(identity));
  }

  /** Call only after the owning mode emits a final, validated player result. */
  record(result: TourResult, rewardIds: readonly string[] = []): boolean {
    if (!isResult(result)) return false;
    const key = tourResultKey(result);
    const old = this.results.get(key);
    const improved =
      !old ||
      MEDAL_RANK[result.medal] > MEDAL_RANK[old.medal] ||
      (result.medal === old.medal && result.score > old.score);
    if (improved) this.results.set(key, { ...result });
    let unlocked = false;
    if (result.medal !== 'none') {
      for (const id of rewardIds) {
        if (!id || this.rewards.has(id)) continue;
        this.rewards.add(id);
        unlocked = true;
      }
    }
    if (!improved && !unlocked) return false;
    try {
      this.storage?.setItem(TOUR_PROGRESS_KEY, JSON.stringify(this.snapshot()));
    } catch {
      // Continue in memory when private browsing denies persistence.
    }
    return true;
  }
}
