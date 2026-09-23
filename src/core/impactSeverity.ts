/** The one definition of how hard something hit. Audio, haptics, the camera
 * kick, landings and phase C scoring all consume this record; none of them
 * estimates severity on its own. A landing and a prop smash are the same
 * call: pass the vehicle's pre-step velocity relative to the other body (the
 * vehicle velocity itself for static ground, walls and props) and the contact
 * normal pointing out of the other surface into the vehicle.
 *
 * Stock Jolt reports no solved contact impulse, so severity is normally
 * ESTIMATED from approach speed, and the record says so. When an engine does
 * supply an impulse, approach speed is the velocity change it implies. */
export interface V3Like {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}
export interface ImpactSeverity {
  /** Closing speed along the normal into the vehicle, m/s; 0 when separating. */
  approachSpeed: number;
  /** Kinetic energy along the normal, joules: half the mass times speed squared. */
  energy: number;
  /** Canonical 0..1 scale: 0 at or below the floor speed, 1 at the full speed. */
  severity: number;
  /** True when derived from approach speed because no solved impulse existed. */
  estimated: boolean;
}

/** Below this closing speed a contact is a scrape, not an impact. */
export const SEVERITY_FLOOR_SPEED = 0.8;
/** At this closing speed every consumer is at full scale. */
export const SEVERITY_FULL_SPEED = 18.8;

export function createImpactSeverity(): ImpactSeverity {
  return { approachSpeed: 0, energy: 0, severity: 0, estimated: false };
}

/** Allocation free: writes into `out` and returns it. Invalid mass or
 * non-finite inputs yield a zero record. */
export function estimateImpactSeverity(
  impulse: number | null,
  relativeVelocity: V3Like,
  normalIntoVehicle: V3Like,
  massKg: number,
  out: ImpactSeverity,
): ImpactSeverity {
  let approach = 0;
  let estimated = true;
  if (Number.isFinite(massKg) && massKg > 0) {
    if (impulse !== null && Number.isFinite(impulse)) {
      approach = Math.max(0, impulse) / massKg;
      estimated = false;
    } else {
      const closing = -(
        relativeVelocity.x * normalIntoVehicle.x +
        relativeVelocity.y * normalIntoVehicle.y +
        relativeVelocity.z * normalIntoVehicle.z
      );
      approach = Number.isFinite(closing) ? Math.max(0, closing) : 0;
    }
  } else massKg = 0;
  out.approachSpeed = approach;
  out.energy = 0.5 * massKg * approach * approach;
  out.severity = Math.max(
    0,
    Math.min(
      1,
      (approach - SEVERITY_FLOOR_SPEED) /
        (SEVERITY_FULL_SPEED - SEVERITY_FLOOR_SPEED),
    ),
  );
  out.estimated = estimated;
  return out;
}
