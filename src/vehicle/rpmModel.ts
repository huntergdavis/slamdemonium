import type { EngineProfile } from './engineProfile';

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
  private readonly upSpeeds: Float64Array;

  constructor(readonly profile: EngineProfile) {
    this.rpm = profile.idleRpm;
    this.upSpeeds = new Float64Array(profile.gearCount - 1);
    for (let gear = 0; gear < this.upSpeeds.length; gear++)
      this.upSpeeds[gear] = profile.firstGearSpeed * profile.gearRatio ** gear;
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
   * boost 0..1, revLiftRpm the tunable throttle lift in rpm. */
  step(
    dt: number,
    speed: number,
    throttle: number,
    boost: number,
    revLiftRpm: number,
    state: EngineState,
  ): void {
    const p = this.profile;
    const v = Math.abs(speed);
    this.shiftCut = Math.max(0, this.shiftCut - dt);
    this.shiftCooldown = Math.max(0, this.shiftCooldown - dt);
    if (this.shiftCooldown === 0) {
      const up = this.upSpeeds[this.gear];
      if (up !== undefined && v > up) {
        this.gear++;
        state.upshiftCount++;
        this.beginShift();
      } else if (
        this.gear > 0 &&
        v < this.upSpeeds[this.gear - 1]! * p.downshiftHysteresis
      ) {
        this.gear--;
        state.downshiftCount++;
        this.beginShift();
      }
    }
    const pedal = this.shiftCut > 0 ? 0 : Math.max(0, Math.min(1, throttle));
    const gearRpm =
      p.idleRpm +
      (v * (p.shiftRpm - p.idleRpm)) /
        (p.firstGearSpeed * p.gearRatio ** this.gear);
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
  }

  private beginShift(): void {
    this.shiftCut = this.profile.shiftCutSeconds;
    this.shiftCooldown = this.profile.shiftCooldownSeconds;
  }
}
