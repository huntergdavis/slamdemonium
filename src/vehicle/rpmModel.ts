import { gearSpacingCap, type EngineProfile } from './engineProfile';

/** The authoritative engine state every consumer reads. Derived after
 * physics from speed, throttle and boost; nothing here feeds back into the
 * drivetrain, input or tuning. Shift counters are monotonic so a consumer
 * polling at any rate detects every shift by diffing against its last read. */
export interface EngineState {
  rpm: number;
  /** 1-based, always 1..gearCount: 1 at rest and in reverse. */
  gear: number;
  gearCount: number;
  idleRpm: number;
  redlineRpm: number;
  upshiftCount: number;
  downshiftCount: number;
}

const approach = (
  value: number,
  target: number,
  dt: number,
  attack: number,
  release: number,
): number =>
  value +
  (target - value) * (1 - Math.exp(-dt / (target > value ? attack : release)));

/** Audio-free, physics-free virtual gearbox and rpm follower. Speed maps to
 * rpm within the current gear; the box shifts up past a speed threshold and
 * down with hysteresis; each shift cuts the throttle briefly so rpm drops to
 * the next gear's entry point and recovers. Throttle lifts rpm on its own
 * with a fast attack so the engine revs before the car has moved, and boost
 * spins rpm beyond the redline. Allocation free after construction. */
export class RpmModel {
  private gear = 0;
  private shiftCut = 0;
  private shiftCooldown = 0;
  private revLift = 0;
  private rpm: number;

  constructor(readonly profile: EngineProfile) {
    this.rpm = profile.idleRpm;
  }

  /** Speed at which the 0-based gear shifts up; the top gear never does. */
  private upSpeed(gear: number, ratio: number): number {
    return this.profile.firstGearSpeed * ratio ** gear;
  }

  reset(state: EngineState): void {
    this.gear = 0;
    this.shiftCut = this.shiftCooldown = this.revLift = 0;
    this.rpm = this.profile.idleRpm;
    state.rpm = this.rpm;
    state.gear = 1;
    state.gearCount = this.profile.gearCount;
    state.idleRpm = this.profile.idleRpm;
    state.redlineRpm = this.profile.redlineRpm;
  }

  /** speed in m/s (sign ignored: reverse keeps first gear), throttle and
   * boost 0..1, revLiftRpm the tunable throttle lift in rpm, gearRatio the
   * tunable spacing between virtual gears and gearCount the presentation-only
   * virtual gear count (both fall back to the profile). */
  step(
    dt: number,
    speed: number,
    throttle: number,
    boost: number,
    revLiftRpm: number,
    state: EngineState,
    gearRatio = this.profile.gearRatio,
    gearCount = this.profile.gearCount,
    topSpeed = Infinity,
    rampExponent = 1,
  ): void {
    const p = this.profile;
    const count = Number.isFinite(gearCount)
      ? Math.max(3, Math.min(8, Math.trunc(gearCount)))
      : p.gearCount;
    const requestedRatio = Number.isFinite(gearRatio)
      ? Math.max(1.01, gearRatio)
      : p.gearRatio;
    const ratio = Math.min(
      requestedRatio,
      gearSpacingCap(count, p.firstGearSpeed, topSpeed) * (1 - 1e-9),
    );
    const v = Math.abs(speed);
    this.gear = Math.min(this.gear, count - 1);
    this.shiftCut = Math.max(0, this.shiftCut - dt);
    this.shiftCooldown = Math.max(0, this.shiftCooldown - dt);
    if (this.shiftCooldown === 0) {
      const top = count - 1;
      if (this.gear < top && v >= this.upSpeed(this.gear, ratio)) {
        this.gear++;
        state.upshiftCount++;
        this.beginShift();
      } else if (
        this.gear > 0 &&
        v < this.upSpeed(this.gear - 1, ratio) * p.downshiftHysteresis
      ) {
        this.gear--;
        state.downshiftCount++;
        this.beginShift();
      }
    }
    const pedal = this.shiftCut > 0 ? 0 : Math.max(0, Math.min(1, throttle));
    const gearSpan = p.firstGearSpeed * ratio ** this.gear;
    const normalizedSpeed = Math.max(0, Math.min(1, v / gearSpan));
    const curve = Number.isFinite(rampExponent)
      ? Math.max(0.01, rampExponent)
      : 1;
    const gearRpm =
      p.idleRpm + Math.pow(normalizedSpeed, curve) * (p.shiftRpm - p.idleRpm);
    this.revLift = approach(
      this.revLift,
      pedal * revLiftRpm,
      dt,
      p.revLiftAttack,
      p.revLiftRelease,
    );
    const target = Math.min(
      p.boostRpm,
      Math.min(p.redlineRpm, gearRpm + this.revLift) +
        Math.max(0, Math.min(1, boost)) * (p.boostRpm - p.redlineRpm),
    );
    this.rpm = approach(this.rpm, target, dt, p.rpmAttack, p.rpmRelease);
    state.rpm = this.rpm;
    state.gear = this.gear + 1;
    // Identity is republished every step so a consumer never reads zeros
    // before the first respawn.
    state.gearCount = count;
    state.idleRpm = p.idleRpm;
    state.redlineRpm = p.redlineRpm;
  }

  private beginShift(): void {
    this.shiftCut = this.profile.shiftCutSeconds;
    this.shiftCooldown = this.profile.shiftCooldownSeconds;
  }
}
