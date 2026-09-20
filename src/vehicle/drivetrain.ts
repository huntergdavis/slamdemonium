import { clamp } from './math';

/** SI units. Full throttle deliberately has no extra coast/drag subtraction. */
export function engineAcceleration(
  speed: number,
  accel0: number,
  topSpeed: number,
  exponent: number,
  boostEnvelope = 0,
  boostAccelMult = 1,
  boostTopSpeedAdd = 0,
): number {
  const limit = topSpeed + boostTopSpeedAdd * boostEnvelope;
  const multiplier = 1 + (boostAccelMult - 1) * boostEnvelope;
  return (
    accel0 *
    multiplier *
    Math.max(0, 1 - Math.pow(Math.abs(speed) / limit, exponent))
  );
}
export function reverseAcceleration(
  speed: number,
  accel0: number,
  reverseSpeed: number,
  exponent: number,
): number {
  return reverseSpeed > 0
    ? 0.6 * engineAcceleration(speed, accel0, reverseSpeed, exponent)
    : 0;
}
export function coastAcceleration(speed: number, coastDecel: number): number {
  return (coastDecel * speed) / 30;
}
export function brakeForce(
  command: number,
  vx: number,
  capacity: number,
  slideGripRatio: number,
  absStrength: number,
  wheelMass: number,
  dt: number,
): number {
  const grip = capacity * (slideGripRatio + (1 - slideGripRatio) * absStrength);
  const magnitude = Math.min(command, grip, (wheelMass * Math.abs(vx)) / dt);
  return -clamp(vx / 0.5, -1, 1) * magnitude;
}
