import type { Quat, V3 } from '../physics/adapter';
import type { CarCrushState } from '../world/carModels';
import { slamCrushChunk } from '../world/traffic';

export const PLAYER_WRECK_SECONDS = 1.5;
export const PLAYER_DAMAGE_BUDGET = 1;
const CONTACT_EPISODE_GAP = 0.18;
const SLAM_CLOSING_SPEED = 2.5;
const HARD_LANDING_SPEED = 12;
const SCRAPE_CRUSH_PER_SECOND = 0.16;
const SCRAPE_CRUSH_CAP = 0.28;
const SCRAPE_DAMAGE_PER_SECOND = 0.02;
const SIDES = ['front', 'rear', 'left', 'right'] as const;
type Side = (typeof SIDES)[number];

/** One light knock is about a tenth of a wreck; four ordinary slams or two
 * hard hits use the full budget. Repeated solver contacts count as one hit. */
export function playerDamageForClosingSpeed(speed: number): number {
  const value = Math.max(0, speed);
  if (value <= 8) return 0.1;
  if (value <= 20) return 0.1 + ((value - 8) * 0.15) / 12;
  if (value <= 40) return 0.25 + ((value - 20) * 0.25) / 20;
  return Math.min(0.75, 0.5 + ((value - 40) * 0.25) / 40);
}

/** Stable per-life damage. Contact callbacks only queue scalar damage; the
 * fixed step ages scrapes and the visible wreck pause. */
export class PlayerDamage {
  readonly crush: CarCrushState = { front: 0, rear: 0, left: 0, right: 0 };
  damage = 0;
  wrecked = false;
  wreckSecondsLeft = 0;
  private contactGap = Infinity;
  private slammedSides = 0;
  private scrapingSides = 0;

  noteContact(
    normalIntoPlayer: Readonly<V3>,
    relativeVelocity: Readonly<V3>,
    rotation: Readonly<Quat>,
  ): void {
    if (this.wrecked) return;
    const length = Math.hypot(
      normalIntoPlayer.x,
      normalIntoPlayer.y,
      normalIntoPlayer.z,
    );
    if (length < 0.5) return;
    const nx = normalIntoPlayer.x / length;
    const ny = normalIntoPlayer.y / length;
    const nz = normalIntoPlayer.z / length;
    const normalSpeed =
      relativeVelocity.x * nx +
      relativeVelocity.y * ny +
      relativeVelocity.z * nz;
    const closing = Math.max(0, -normalSpeed);
    const tangentSquared = Math.max(
      0,
      relativeVelocity.x ** 2 +
        relativeVelocity.y ** 2 +
        relativeVelocity.z ** 2 -
        normalSpeed ** 2,
    );
    if (Math.hypot(nx, nz) < 0.45) {
      if (Math.abs(ny) < 0.7 || closing < HARD_LANDING_SPEED) return;
      let newHit = false;
      for (let index = 0; index < SIDES.length; index++)
        newHit = this.slam(index, closing) || newHit;
      if (newHit) this.addDamage(playerDamageForClosingSpeed(closing));
      this.contactGap = 0;
      return;
    }
    // Inverse chassis rotation puts the inward normal in player car space.
    // The player mesh's nose is -Z, opposite the traffic catalogue's +Z.
    const qx = -rotation.x;
    const qy = -rotation.y;
    const qz = -rotation.z;
    const tx = 2 * (qy * nz - qz * ny);
    const ty = 2 * (qz * nx - qx * nz);
    const tz = 2 * (qx * ny - qy * nx);
    const localX = nx + rotation.w * tx + qy * tz - qz * ty;
    const localZ = nz + rotation.w * tz + qx * ty - qy * tx;
    const side: Side =
      Math.abs(localZ) >= Math.abs(localX)
        ? localZ >= 0
          ? 'front'
          : 'rear'
        : localX <= 0
          ? 'right'
          : 'left';
    const sideIndex = SIDES.indexOf(side);
    if (closing >= SLAM_CLOSING_SPEED) {
      if (this.slam(sideIndex, closing))
        this.addDamage(playerDamageForClosingSpeed(closing));
    } else if (tangentSquared > 0.8 ** 2) {
      this.scrapingSides |= 1 << sideIndex;
    }
    this.contactGap = 0;
  }

  private slam(index: number, speed: number): boolean {
    const bit = 1 << index;
    if (this.slammedSides & bit) return false;
    const side = SIDES[index]!;
    this.crush[side] = Math.min(1, this.crush[side] + slamCrushChunk(speed));
    this.slammedSides |= bit;
    // The vertical landing path adds one budget chunk after all faces.
    return true;
  }

  private addDamage(amount: number): void {
    this.damage = Math.min(PLAYER_DAMAGE_BUDGET, this.damage + amount);
    if (this.damage >= PLAYER_DAMAGE_BUDGET - 1e-9) {
      this.wrecked = true;
      this.wreckSecondsLeft = PLAYER_WRECK_SECONDS;
    }
  }

  /** Returns true once, when the post-wreck nearest-road respawn is due. */
  step(dt: number): boolean {
    if (this.wrecked) {
      if (this.wreckSecondsLeft <= 0) return false;
      this.wreckSecondsLeft = Math.max(0, this.wreckSecondsLeft - dt);
      return this.wreckSecondsLeft === 0;
    }
    this.contactGap += dt;
    if (this.contactGap >= CONTACT_EPISODE_GAP) this.slammedSides = 0;
    for (let index = 0; index < SIDES.length; index++) {
      if (!(this.scrapingSides & (1 << index))) continue;
      const side = SIDES[index]!;
      this.crush[side] = Math.max(
        this.crush[side],
        Math.min(
          SCRAPE_CRUSH_CAP,
          this.crush[side] + SCRAPE_CRUSH_PER_SECOND * dt,
        ),
      );
      this.addDamage(SCRAPE_DAMAGE_PER_SECOND * dt);
    }
    this.scrapingSides = 0;
    return false;
  }

  reset(): void {
    for (const side of SIDES) this.crush[side] = 0;
    this.damage = 0;
    this.wrecked = false;
    this.wreckSecondsLeft = 0;
    this.contactGap = Infinity;
    this.slammedSides = 0;
    this.scrapingSides = 0;
  }
}
