import { getSurfaceDefinition } from '../content/surfaces';
import type { SurfaceId } from '../content/surfaces';

/** The one map from physics body to authored surface. Registration is strict
 * and happens at boot or scoped teardown, never per frame; `get` is the hot
 * path the resolver reads for every wheel and contact. A body absent here
 * resolves to null and the tyre model skips that wheel, so every creation
 * path goes through SurfacedBodies, which registers atomically. */
export interface SurfaceRegistry {
  register(bodyId: number, surfaceId: SurfaceId): void;
  unregister(bodyId: number): void;
  get(bodyId: number): SurfaceId | undefined;
  has(bodyId: number): boolean;
  readonly size: number;
}

export function createSurfaceRegistry(): SurfaceRegistry {
  const map = new Map<number, SurfaceId>();
  return {
    register(bodyId, surfaceId) {
      if (!Number.isSafeInteger(bodyId) || bodyId < 0 || map.has(bodyId))
        throw new RangeError(
          'Track body IDs must be unique nonnegative safe integers',
        );
      getSurfaceDefinition(surfaceId); // Strict setup validation, never in resolve().
      map.set(bodyId, surfaceId);
    },
    unregister(bodyId) {
      map.delete(bodyId);
    },
    get(bodyId) {
      return map.get(bodyId);
    },
    has(bodyId) {
      return map.has(bodyId);
    },
    get size() {
      return map.size;
    },
  };
}
