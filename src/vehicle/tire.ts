import { clamp, smoothstep } from './math';

/** Normalized slip magnitude -> normalized lateral grip (design 6.5.2). */
export function slipCurve(
  x: number,
  slideGripRatio: number,
  falloffRate: number,
): number {
  x = Math.max(0, x);
  return x <= 1
    ? 2 * x - x * x
    : slideGripRatio + (1 - slideGripRatio) * Math.exp(-falloffRate * (x - 1));
}
export function effectiveFriction(
  mu: number,
  surfaceGrip: number,
  handbrake: number,
  load: number,
  referenceLoad: number,
  loadSensitivity: number,
): number {
  return load > 0
    ? mu *
        surfaceGrip *
        handbrake *
        Math.pow(load / referenceLoad, -loadSensitivity)
    : 0;
}
export function relaxedSlip(
  previous: number,
  alpha: number,
  vx: number,
  dt: number,
  length: number,
): number {
  return (
    previous + clamp((Math.abs(vx) * dt) / length, 0, 1) * (alpha - previous)
  );
}
export function lateralForce(
  alpha: number,
  peakAngle: number,
  slideGripRatio: number,
  falloff: number,
  capacity: number,
  vx: number,
  vy: number,
  lowSpeedBlend: number,
): number {
  const slip =
    -Math.sign(alpha) *
    capacity *
    slipCurve(Math.abs(alpha) / peakAngle, slideGripRatio, falloff);
  const viscous = clamp((-capacity * vy) / 0.5, -capacity, capacity);
  const weight = smoothstep(0, lowSpeedBlend, Math.abs(vx));
  return weight * slip + (1 - weight) * viscous;
}
export function longitudinalCapacity(
  capacity: number,
  lateral: number,
  coupling: number,
): number {
  if (capacity <= 0) return 0;
  const normalized = lateral / capacity;
  return (
    capacity * Math.sqrt(Math.max(0, 1 - coupling * normalized * normalized))
  );
}
