export interface RoadRageBestResult {
  readonly count: number;
  readonly wrecks: number;
}

type BestStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** A rules-versioned, reproducible identity; tuning changes cannot inherit a
 * record earned with a different car or physics setup. */
export function roadRageBestKey<T extends object>(
  map: string,
  car: string,
  tuning: Readonly<T>,
): string {
  const values = tuning as Record<string, number>;
  const canonical = JSON.stringify(
    Object.keys(values)
      .sort()
      .map((key) => [key, values[key]]),
  );
  let hash = 2166136261;
  for (let index = 0; index < canonical.length; index++) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `slamdemonium:road-rage:v1:${map}:${car}:${(hash >>> 0).toString(16)}`;
}

function validBest(value: unknown): value is RoadRageBestResult {
  if (!value || typeof value !== 'object') return false;
  const best = value as Record<string, unknown>;
  return (
    Number.isSafeInteger(best.count) &&
    (best.count as number) >= 0 &&
    Number.isSafeInteger(best.wrecks) &&
    (best.wrecks as number) >= 0 &&
    (best.wrecks as number) <= 2
  );
}

export class RoadRageBest {
  private current: RoadRageBestResult | null = null;

  constructor(
    private readonly key: string,
    private readonly storage: BestStorage | null,
  ) {
    try {
      const stored = storage?.getItem(key);
      const parsed: unknown = stored ? JSON.parse(stored) : null;
      if (validBest(parsed)) this.current = parsed;
    } catch {
      // Private browsing and corrupt data leave the session record usable.
    }
  }

  get value(): RoadRageBestResult | null {
    return this.current;
  }

  /** Call only for a completed timed run, never a third-wreck failure. */
  record(count: number, wrecks: number): RoadRageBestResult {
    if (
      !Number.isSafeInteger(count) ||
      count < 0 ||
      !Number.isSafeInteger(wrecks) ||
      wrecks < 0 ||
      wrecks > 2
    )
      throw new RangeError('Invalid completed Road Rage result');
    const old = this.current;
    if (
      old &&
      (old.count > count || (old.count === count && old.wrecks <= wrecks))
    )
      return old;
    const next = { count, wrecks };
    this.current = next;
    try {
      this.storage?.setItem(this.key, JSON.stringify(next));
    } catch {
      // A blocked write cannot interrupt play or erase the session best.
    }
    return next;
  }
}
