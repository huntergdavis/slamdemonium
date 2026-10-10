import type { CarModelKind } from '../world/carModels';

export const CRASH_RULES_VERSION = 'east-junction-v1';
export const CRASH_BEST_KEY = `slamdemonium.crash.${CRASH_RULES_VERSION}`;
export const CRASH_PICKUP_BEST_KEY = `${CRASH_BEST_KEY}.pickup`;
export const CRASH_MEDALS = [2000, 4000, 8000] as const;
export const CRASH_CHAIN_SECONDS = 3;
export const CRASH_SETTLE_SECONDS = 2;
export const CRASH_WALL_CAP_SECONDS = 15;
export const CRASH_COUNTDOWN_SECONDS = 3;
export type CrashPhase = 'countdown' | 'running' | 'settling' | 'finished';
export type CrashMedal = 'none' | 'bronze' | 'silver' | 'gold';
export type CrashCause = 'player' | 'chain' | 'ambient';

export interface CrashAward {
  readonly id: number;
  readonly kind: 'vehicle' | 'prop';
  readonly cause: CrashCause;
  readonly base: number;
}

export interface CrashWreck {
  readonly id: number;
  readonly modelKind: CarModelKind;
}

export interface CrashStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface CrashScoring {
  readonly vehicleMultiplier?: number;
  readonly bestKey?: string;
}

export function crashVehicleValue(kind: CarModelKind): number {
  if (kind === 'bus' || kind === 'boxTruck') return 1000;
  if (kind === 'van' || kind === 'pickup') return 750;
  return 500;
}

export function crashMedal(score: number): CrashMedal {
  if (score >= CRASH_MEDALS[2]) return 'gold';
  if (score >= CRASH_MEDALS[1]) return 'silver';
  if (score >= CRASH_MEDALS[0]) return 'bronze';
  return 'none';
}

/** Score belongs to the encounter, never the pooled physics body. Contact
 * influence travels A→B→C, but ambient traffic wrecks give no player points. */
export class CrashMode {
  readonly state = {
    phase: 'countdown' as CrashPhase,
    countdown: CRASH_COUNTDOWN_SECONDS,
    damage: 0,
    best: 0,
    medal: 'none' as CrashMedal,
    wrecks: 0,
    changed: true,
  };
  readonly awards: CrashAward[] = [];
  private readonly influencedUntil = new Map<number, number>();
  private readonly directlyHit = new Set<number>();
  private readonly seenCars = new Set<number>();
  private readonly seenProps = new Set<number>();
  private seconds = 0;
  private quietSeconds = 0;
  private wallSinceWreck = 0;

  constructor(
    private readonly storage?: CrashStorage,
    private readonly scoring: CrashScoring = {},
  ) {
    try {
      const best = Number(
        storage?.getItem(this.scoring.bestKey ?? CRASH_BEST_KEY),
      );
      if (Number.isSafeInteger(best) && best >= 0) this.state.best = best;
    } catch {
      // Private browsing and full storage are still playable.
    }
  }

  step(dt: number, impactActive = false): void {
    const elapsed = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    this.state.changed = false;
    if (this.state.phase === 'countdown') {
      this.state.countdown = Math.max(0, this.state.countdown - elapsed);
      if (this.state.countdown < 1e-9) this.state.countdown = 0;
      if (this.state.countdown === 0) {
        this.state.phase = 'running';
        this.state.changed = true;
      }
      return;
    }
    if (this.state.phase === 'finished') return;
    this.seconds += elapsed;
    if (this.state.phase === 'settling' && !impactActive) {
      this.quietSeconds += elapsed;
      if (this.quietSeconds >= CRASH_SETTLE_SECONDS) this.finish();
    }
    for (const [id, until] of this.influencedUntil)
      if (until < this.seconds) this.influencedUntil.delete(id);
  }

  advanceWall(dt: number): void {
    if (this.state.phase !== 'settling') return;
    this.wallSinceWreck += Number.isFinite(dt) ? Math.max(0, dt) : 0;
    if (this.wallSinceWreck >= CRASH_WALL_CAP_SECONDS) this.finish();
  }

  notePlayerContact(id: number): void {
    if (this.state.phase !== 'running' && this.state.phase !== 'settling')
      return;
    this.influencedUntil.set(id, this.seconds + CRASH_CHAIN_SECONDS);
    this.directlyHit.add(id);
  }

  noteCarContact(a: number, b: number): void {
    const until = Math.max(
      this.influencedUntil.get(a) ?? -Infinity,
      this.influencedUntil.get(b) ?? -Infinity,
    );
    if (until < this.seconds) return;
    this.influencedUntil.set(a, until);
    this.influencedUntil.set(b, until);
  }

  noteWreck(car: CrashWreck): number {
    if (this.state.phase === 'countdown' || this.state.phase === 'finished')
      return 0;
    if (this.seenCars.has(car.id)) return 0;
    this.seenCars.add(car.id);
    const influenced =
      (this.influencedUntil.get(car.id) ?? -Infinity) >= this.seconds;
    const cause: CrashCause = !influenced
      ? 'ambient'
      : this.directlyHit.has(car.id)
        ? 'player'
        : 'chain';
    const base = influenced
      ? crashVehicleValue(car.modelKind) * (this.scoring.vehicleMultiplier ?? 1)
      : 0;
    this.awards.push({ id: car.id, kind: 'vehicle', cause, base });
    if (base) {
      this.state.damage += base;
      this.state.wrecks++;
      this.quietSeconds = 0;
      this.state.changed = true;
    }
    return base;
  }

  notePropBreak(id: number, playerChain: boolean): number {
    if (this.state.phase === 'countdown' || this.state.phase === 'finished')
      return 0;
    if (this.seenProps.has(id)) return 0;
    this.seenProps.add(id);
    const base = playerChain ? 100 : 0;
    this.awards.push({
      id,
      kind: 'prop',
      cause: playerChain ? 'chain' : 'ambient',
      base,
    });
    if (base) {
      this.state.damage += base;
      this.quietSeconds = 0;
      this.state.changed = true;
    }
    return base;
  }

  notePlayerWreck(): void {
    if (this.state.phase !== 'running') return;
    this.state.phase = 'settling';
    this.quietSeconds = 0;
    this.wallSinceWreck = 0;
    this.state.changed = true;
  }

  reset(): void {
    this.influencedUntil.clear();
    this.directlyHit.clear();
    this.seenCars.clear();
    this.seenProps.clear();
    this.awards.length = 0;
    this.seconds = 0;
    this.quietSeconds = 0;
    this.wallSinceWreck = 0;
    this.state.phase = 'countdown';
    this.state.countdown = CRASH_COUNTDOWN_SECONDS;
    this.state.damage = 0;
    this.state.medal = 'none';
    this.state.wrecks = 0;
    this.state.changed = true;
  }

  private finish(): void {
    if (this.state.phase === 'finished') return;
    this.state.phase = 'finished';
    this.state.medal = crashMedal(this.state.damage);
    this.state.changed = true;
    if (this.state.damage > this.state.best) {
      this.state.best = this.state.damage;
      try {
        this.storage?.setItem(
          this.scoring.bestKey ?? CRASH_BEST_KEY,
          String(this.state.best),
        );
      } catch {
        /* Play without storage. */
      }
    }
  }
}
