import type { GameInput } from '../core/gameApi';
import type { TuningStore } from '../tuning/store';
import { DEG } from './constants';
import { clamp, moveToward } from './math';

export function steeringLock(
  speed: number,
  low: number,
  high: number,
  topSpeed: number,
  exponent: number,
): number {
  return (
    low +
    (high - low) * Math.pow(clamp(Math.abs(speed) / topSpeed, 0, 1), exponent)
  );
}
export function countersteerAngle(
  beta: number,
  betaFront: number,
  strength: number,
  gate: number,
): number {
  return strength > 0 && gate > 0 && Math.abs(beta) > 3 * DEG
    ? -strength * betaFront * gate
    : 0;
}
export class VehicleControls implements GameInput {
  throttle = 0;
  brake = 0;
  steer = 0;
  handbrake = false;
  boost = false;
  rearGrip = 1;
  update(
    raw: Readonly<GameInput>,
    source: 'keyboard' | 'gamepad',
    tuning: TuningStore,
    dt: number,
  ): void {
    const targetThrottle = clamp(raw.throttle, 0, 1);
    this.throttle = moveToward(
      this.throttle,
      targetThrottle,
      dt /
        tuning.get(
          targetThrottle > this.throttle
            ? 'throttleRiseTime'
            : 'throttleFallTime',
        ),
    );
    this.brake = moveToward(
      this.brake,
      clamp(raw.brake, 0, 1),
      dt / tuning.get('brakeRiseTime'),
    );
    let targetSteer = clamp(raw.steer, -1, 1);
    if (source === 'gamepad') {
      const deadzone = tuning.get('steerDeadzone');
      targetSteer =
        Math.sign(targetSteer) *
        Math.max(0, (Math.abs(targetSteer) - deadzone) / (1 - deadzone));
      const expo = tuning.get('steerExpo');
      targetSteer = (1 - expo) * targetSteer + expo * targetSteer ** 3;
      this.steer += (1 - Math.exp(-dt / 0.03)) * (targetSteer - this.steer);
    } else {
      // Reversing direction first returns through center at the return rate.
      const returning =
        this.steer * targetSteer < 0 ||
        Math.abs(targetSteer) < Math.abs(this.steer);
      this.steer = moveToward(
        this.steer,
        targetSteer,
        dt / tuning.get(returning ? 'steerReturnTime' : 'steerRiseTime'),
      );
    }
    this.handbrake = raw.handbrake;
    this.boost = raw.boost;
    const minimum = tuning.get('handbrakeRearGrip');
    this.rearGrip = moveToward(
      this.rearGrip,
      raw.handbrake ? minimum : 1,
      ((1 - minimum) * dt) /
        (raw.handbrake ? 0.05 : tuning.get('handbrakeRecoveryTime')),
    );
  }
  reset(): void {
    this.throttle = this.brake = this.steer = 0;
    this.handbrake = this.boost = false;
    this.rearGrip = 1;
  }
}
