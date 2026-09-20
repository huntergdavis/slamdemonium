import { VEHICLE_GEOMETRY } from './constants';
import { clamp } from './math';

/** Positive comLongOffset moves weight forward (PM correction to design 6.2). */
export function frontMassShare(comLongOffset: number): number {
  return 0.5 + comLongOffset / VEHICLE_GEOMETRY.wheelbase;
}
export function springRate(wheelMass: number, frequency: number): number {
  return wheelMass * (2 * Math.PI * frequency) ** 2;
}
export function suspensionForce(
  compression: number,
  compressionSpeed: number,
  wheelMass: number,
  frequency: number,
  dampingRatio: number,
  maxTravel: number,
): number {
  const k = springRate(wheelMass, frequency);
  const c = 2 * dampingRatio * Math.sqrt(k * wheelMass);
  const spring =
    k *
    (Math.min(compression, maxTravel) +
      10 * Math.max(0, compression - maxTravel));
  return Math.max(0, spring + c * compressionSpeed);
}
/** Dissipative forces only: engine force must remain able to launch at zero slip. */
export function limitDissipativeForce(
  force: number,
  slip: number,
  wheelMass: number,
  dt: number,
): number {
  if (force * slip >= 0) return 0; // Lag must never push in the current slip direction.
  const cap = (wheelMass * Math.abs(slip)) / dt;
  return clamp(force, -cap, cap);
}
