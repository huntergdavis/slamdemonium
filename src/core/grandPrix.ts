export const GRAND_PRIX_HEATS = [
  { map: 'city', label: 'City Sprint' },
  { map: 'coast-shoreline', label: 'Coast Shoreline' },
  { map: 'highway-express', label: 'Highway Express' },
] as const;
export const GRAND_PRIX_MAPS = [
  'grand-prix-city',
  'grand-prix-coast',
  'grand-prix-highway',
] as const;

export type GrandPrixMedal = 'none' | 'bronze' | 'silver' | 'gold';
export type GrandPrixPhase = 'racing' | 'between' | 'finished';

/** Slots, not Jolt or encounter IDs, persist across venue reloads. Slot zero
 * is the player; slots one through five keep the same rival names. */
export interface GrandPrixSnapshot {
  readonly version: 1;
  readonly heat: number;
  readonly phase: GrandPrixPhase;
  readonly points: readonly number[];
  readonly wins: readonly number[];
  readonly finalTimes: readonly number[];
  readonly lastOrder: readonly number[];
}

const POINTS = [10, 6, 4, 2, 1, 0] as const;
const ENTRANTS = POINTS.length;
const NO_TIME = Number.MAX_SAFE_INTEGER;
const fresh = (): GrandPrixSnapshot => ({
  version: 1,
  heat: 0,
  phase: 'racing',
  points: Array(ENTRANTS).fill(0),
  wins: Array(ENTRANTS).fill(0),
  finalTimes: Array(ENTRANTS).fill(NO_TIME),
  lastOrder: [],
});

function validOrder(order: readonly number[]): boolean {
  return (
    order.length === ENTRANTS &&
    new Set(order).size === ENTRANTS &&
    order.every(
      (slot) => Number.isInteger(slot) && slot >= 0 && slot < ENTRANTS,
    )
  );
}

function validSnapshot(value: unknown): value is GrandPrixSnapshot {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<GrandPrixSnapshot>;
  const heat = state.heat;
  const phase = state.phase;
  const scored =
    Number.isInteger(heat) && heat! >= 0 && heat! < GRAND_PRIX_HEATS.length
      ? heat! + (phase === 'racing' ? 0 : 1)
      : -1;
  return (
    state.version === 1 &&
    scored >= 0 &&
    (phase === 'racing' || phase === 'between' || phase === 'finished') &&
    (phase !== 'finished' || heat === GRAND_PRIX_HEATS.length - 1) &&
    (phase !== 'between' || heat! < GRAND_PRIX_HEATS.length - 1) &&
    Array.isArray(state.points) &&
    state.points.length === ENTRANTS &&
    state.points.every((n) => Number.isInteger(n) && n >= 0 && n <= 30) &&
    state.points.reduce((sum, n) => sum + n, 0) === scored * 23 &&
    Array.isArray(state.wins) &&
    state.wins.length === ENTRANTS &&
    state.wins.every((n) => Number.isInteger(n) && n >= 0 && n <= 3) &&
    state.wins.reduce((sum, n) => sum + n, 0) === scored &&
    Array.isArray(state.finalTimes) &&
    state.finalTimes.length === ENTRANTS &&
    state.finalTimes.every(
      (n) => Number.isFinite(n) && n >= 0 && n <= NO_TIME,
    ) &&
    (phase === 'finished' || state.finalTimes.every((n) => n === NO_TIME)) &&
    Array.isArray(state.lastOrder) &&
    (phase === 'racing'
      ? state.lastOrder.length === 0
      : validOrder(state.lastOrder))
  );
}

export function createGrandPrix(saved?: unknown) {
  // Storage is untrusted, and a partial or old run is never a medal claim.
  let value: GrandPrixSnapshot = validSnapshot(saved) ? saved : fresh();

  function ranking(): number[] {
    return Array.from({ length: ENTRANTS }, (_, slot) => slot).sort(
      (a, b) =>
        value.points[b]! - value.points[a]! ||
        value.wins[b]! - value.wins[a]! ||
        value.finalTimes[a]! - value.finalTimes[b]! ||
        a - b,
    );
  }

  function recordHeat(
    order: readonly number[],
    times: readonly number[],
  ): boolean {
    if (
      value.phase !== 'racing' ||
      !validOrder(order) ||
      times.length !== ENTRANTS
    )
      return false;
    if (!times.every((t) => t === Infinity || (Number.isFinite(t) && t >= 0)))
      return false;
    const points = [...value.points];
    const wins = [...value.wins];
    for (let place = 0; place < ENTRANTS; place++)
      points[order[place]!]! += POINTS[place]!;
    wins[order[0]!]!++;
    const final = value.heat === GRAND_PRIX_HEATS.length - 1;
    value = {
      ...value,
      phase: final ? 'finished' : 'between',
      points,
      wins,
      finalTimes: final
        ? times.map((time) => (time === Infinity ? NO_TIME : time))
        : value.finalTimes,
      lastOrder: [...order],
    };
    return true;
  }

  function nextHeat(): boolean {
    if (value.phase !== 'between') return false;
    value = { ...value, heat: value.heat + 1, phase: 'racing', lastOrder: [] };
    return true;
  }

  function medal(): GrandPrixMedal {
    if (value.phase !== 'finished') return 'none';
    const place = ranking().indexOf(0);
    return place === 0
      ? 'gold'
      : place === 1
        ? 'silver'
        : place === 2
          ? 'bronze'
          : 'none';
  }

  return {
    get state(): GrandPrixSnapshot {
      return value;
    },
    get order(): readonly number[] {
      return ranking();
    },
    recordHeat,
    nextHeat,
    medal,
    reset(): void {
      value = fresh();
    },
    snapshot(): GrandPrixSnapshot {
      return {
        ...value,
        points: [...value.points],
        wins: [...value.wins],
        finalTimes: [...value.finalTimes],
        lastOrder: [...value.lastOrder],
      };
    },
  };
}
