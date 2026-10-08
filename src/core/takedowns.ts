import type { TrafficCarState } from '../world/traffic';

/** Time after the player's last shove in which a resulting wreck is theirs. */
export const TAKEDOWN_CHAIN_SECONDS = 3;

/** Attribution is keyed by encounter id, never by a recycled pooled body. */
export class Takedowns {
  private seconds = 0;
  private nextPruneSeconds = 1;
  private readonly influencedUntil = new Map<number, number>();
  private readonly counted = new Set<number>();
  count = 0;
  lastVictimId = -1;

  notePlayerContact(
    car: Readonly<TrafficCarState> | undefined,
    severity: number,
  ): void {
    if (!car || car.wrecked || severity < 0.05) return;
    this.influencedUntil.set(car.id, this.seconds + TAKEDOWN_CHAIN_SECONDS);
  }

  /** A shunted car can shove the next car; a wall contact needs no transfer. */
  noteCarContact(
    a: Readonly<TrafficCarState> | undefined,
    b: Readonly<TrafficCarState> | undefined,
  ): void {
    if (!a || !b) return;
    const until = Math.max(
      this.influencedUntil.get(a.id) ?? -Infinity,
      this.influencedUntil.get(b.id) ?? -Infinity,
    );
    if (until < this.seconds) return;
    this.influencedUntil.set(a.id, until);
    this.influencedUntil.set(b.id, until);
  }

  /** Return the newly credited rival, if any, after traffic has settled. */
  update(
    dt: number,
    cars: readonly TrafficCarState[],
  ): TrafficCarState | undefined {
    this.seconds += dt;
    let victim: TrafficCarState | undefined;
    for (const car of cars) {
      if (!car.rival || !car.wrecked || this.counted.has(car.id)) continue;
      if ((this.influencedUntil.get(car.id) ?? -Infinity) < this.seconds)
        continue;
      this.counted.add(car.id);
      this.count++;
      this.lastVictimId = car.id;
      victim = car;
    }
    if (this.seconds >= this.nextPruneSeconds) {
      this.nextPruneSeconds = this.seconds + 1;
      for (const [id, until] of this.influencedUntil)
        if (until < this.seconds) this.influencedUntil.delete(id);
    }
    return victim;
  }

  reset(): void {
    this.seconds = 0;
    this.nextPruneSeconds = 1;
    this.influencedUntil.clear();
    this.counted.clear();
    this.count = 0;
    this.lastVictimId = -1;
  }
}
