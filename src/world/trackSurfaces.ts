import {
  SURFACE_IDS,
  getSurfaceDefinition,
  getKnownSurfaceDefinition,
  validateSurfaceCatalog,
} from '../content/surfaces';
import type {
  SurfaceId,
  SurfaceHit,
  SurfaceResolver,
  SurfaceResolutionStatus,
  ContactSurfaceDefinition,
  ContactSurfaceResolutionStatus,
} from '../content/surfaces';
import type { InstalledTrackBodies, StaticBoxDescriptor } from './trackPhysics';

/** 0.1 mm absorbs float32 ray/plane roundoff, not the visual kerb's 6 cm height. */
export const GROUND_HIT_EPSILON = 1e-4;
const NORMAL_EPSILON = 1e-5;

export interface TrackSurfaceResolverOptions {
  bodies: InstalledTrackBodies;
  groundSurfaceId: number;
  /** Actual installed axis-aligned box; Y-up, metres. No implicit infinite plane. */
  ground: Readonly<StaticBoxDescriptor>;
  kerbFootprint: (x: number, z: number) => boolean;
}

/**
 * SETUP: bind bodies returned by installTrackColliders for THIS track/world.
 * Snapshot registrations, validate every ID and configured material, then derive
 * all resolved IDs from this registry. Raw hit.surfaceId is never trusted/read.
 * The ground and kerb query must share the rendered track's identity transform.
 */
export function createTrackSurfaceResolver(
  options: TrackSurfaceResolverOptions,
): SurfaceResolver {
  validateSurfaceCatalog();
  const { bodies, ground, kerbFootprint } = options;
  const base = getSurfaceDefinition(options.groundSurfaceId);
  if (base.context !== 'ground')
    throw new RangeError('Track ground requires a ground-context surface');
  if (
    ground.rotY !== 0 ||
    !Number.isFinite(ground.center.x) ||
    !Number.isFinite(ground.center.y) ||
    !Number.isFinite(ground.center.z) ||
    !Number.isFinite(ground.halfExtents.x) ||
    ground.halfExtents.x <= 0 ||
    !Number.isFinite(ground.halfExtents.y) ||
    ground.halfExtents.y <= 0 ||
    !Number.isFinite(ground.halfExtents.z) ||
    ground.halfExtents.z <= 0
  )
    throw new RangeError(
      'Surface ground must be a finite, positive, axis-aligned box',
    );
  const centerX = ground.center.x,
    centerZ = ground.center.z;
  const halfX = ground.halfExtents.x,
    halfZ = ground.halfExtents.z;
  const top = ground.center.y + ground.halfExtents.y;
  const bottom = ground.center.y - ground.halfExtents.y;
  if (!Number.isFinite(top) || !Number.isFinite(bottom))
    throw new RangeError('Ground bounds must be finite');
  const registry = new Map<number, SurfaceId>();
  function register(bodyId: number, surfaceId: SurfaceId): void {
    if (!Number.isSafeInteger(bodyId) || bodyId < 0 || registry.has(bodyId))
      throw new RangeError(
        'Track body IDs must be unique nonnegative safe integers',
      );
    getSurfaceDefinition(surfaceId); // Strict setup validation, never in resolve().
    registry.set(bodyId, surfaceId);
  }
  register(bodies.ground, base.id);
  for (const body of bodies.barriers) register(body, SURFACE_IDS.concrete);
  const groundBody = bodies.ground;
  let disposed = false;
  const diagnostics = {
    lastStatus: 'airborne' as SurfaceResolutionStatus,
    lastContactStatus: null as ContactSurfaceResolutionStatus | null,
    unknownBodySeen: false,
    firstUnknownBodyId: null as number | null,
    invalidHitSeen: false,
  };
  function noteUnknown(bodyId: number): void {
    if (!diagnostics.unknownBodySeen) {
      diagnostics.unknownBodySeen = true;
      diagnostics.firstUnknownBodyId = bodyId;
    }
  }
  function invalid(): null {
    diagnostics.lastStatus = 'invalid-hit';
    diagnostics.invalidHitSeen = true;
    return null;
  }
  function resolve(
    grounded: boolean,
    hit: Readonly<SurfaceHit>,
  ): SurfaceId | null {
    if (disposed) return null; // dispose() already made old diagnostics explicit.
    if (!grounded) {
      diagnostics.lastStatus = 'airborne';
      return null; // Do not even read the borrowed/stale ray record.
    }
    if (
      !hit ||
      !hit.point ||
      !hit.normal ||
      !Number.isSafeInteger(hit.bodyId) ||
      hit.bodyId < 0 ||
      !Number.isFinite(hit.distance) ||
      hit.distance < 0 ||
      !Number.isFinite(hit.point.x) ||
      !Number.isFinite(hit.point.y) ||
      !Number.isFinite(hit.point.z) ||
      !Number.isFinite(hit.normal.x) ||
      !Number.isFinite(hit.normal.y) ||
      !Number.isFinite(hit.normal.z)
    )
      return invalid();
    const normalLengthSquared =
      hit.normal.x * hit.normal.x +
      hit.normal.y * hit.normal.y +
      hit.normal.z * hit.normal.z;
    if (Math.abs(normalLengthSquared - 1) > 1e-3) return invalid();
    const surface = registry.get(hit.bodyId);
    if (surface === undefined) {
      diagnostics.lastStatus = 'unknown-body';
      noteUnknown(hit.bodyId);
      return null;
    }
    if (hit.bodyId !== groundBody) {
      diagnostics.lastStatus = 'resolved';
      return surface; // Registered concrete, NOT unvalidated hit.surfaceId.
    }
    if (
      Math.abs(hit.point.x - centerX) > halfX + GROUND_HIT_EPSILON ||
      Math.abs(hit.point.z - centerZ) > halfZ + GROUND_HIT_EPSILON ||
      hit.point.y > top + GROUND_HIT_EPSILON ||
      hit.point.y < bottom - GROUND_HIT_EPSILON
    )
      return invalid();
    diagnostics.lastStatus = 'resolved';
    // Only the installed ground's upward top face can carry painted-on kerbs.
    // Side/bottom ground hits retain their base material; a wall never gets here.
    if (
      Math.abs(hit.point.y - top) <= GROUND_HIT_EPSILON &&
      Math.abs(hit.normal.x) <= NORMAL_EPSILON &&
      Math.abs(hit.normal.y - 1) <= NORMAL_EPSILON &&
      Math.abs(hit.normal.z) <= NORMAL_EPSILON &&
      kerbFootprint(hit.point.x, hit.point.z)
    )
      return SURFACE_IDS.kerb;
    return surface;
  }
  // New resolver/world => new zeroed latches. Respawn does not reset evidence.
  resolve.diagnostics = diagnostics;
  resolve.resolveContactSurface = (
    bodyId: number,
  ): ContactSurfaceDefinition | null => {
    if (disposed) return null;
    if (!Number.isSafeInteger(bodyId) || bodyId < 0) {
      diagnostics.lastContactStatus = 'invalid-hit';
      diagnostics.invalidHitSeen = true;
      return null;
    }
    const id = registry.get(bodyId);
    if (id === undefined) {
      diagnostics.lastContactStatus = 'unknown-body';
      noteUnknown(bodyId);
      return null;
    }
    const definition = getKnownSurfaceDefinition(id);
    if (definition.context !== 'contact') {
      diagnostics.lastContactStatus = 'not-contact';
      return null;
    }
    diagnostics.lastContactStatus = 'resolved';
    return definition;
  };
  resolve.dispose = (): void => {
    disposed = true;
    diagnostics.lastStatus = 'disposed';
    diagnostics.lastContactStatus = 'disposed';
  };
  return resolve;
}
