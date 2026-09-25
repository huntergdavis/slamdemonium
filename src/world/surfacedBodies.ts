import type {
  BodyId,
  IPhysicsWorld,
  PooledBoxDesc,
  StaticMeshDesc,
  Quat,
  StaticBodyDesc,
  V3,
} from '../physics/adapter';
import type { SurfaceId } from '../content/surfaces';
import type { SurfaceRegistry } from './surfaceRegistry';

export type SurfacedStaticBodyDesc = Omit<StaticBodyDesc, 'surfaceId'> & {
  surface: SurfaceId;
};
export type SurfacedStaticMeshDesc = Omit<StaticMeshDesc, 'surfaceId'> & {
  surface: SurfaceId;
};
export type SurfacedPooledBoxDesc = PooledBoxDesc & { surface: SurfaceId };

/** The only way world code creates bodies. Every body is registered with its
 * authored surface in the same call that creates it, so an unregistered body
 * (suspension force with no tyre force) cannot be built. Activation and
 * deactivation never touch the registry and are safe on the hot path; the
 * registry changes only at boot and in scoped teardown. Serves phase B (a
 * pitched ramp is one createStaticBody) and phase C (props and debris are
 * pooled boxes activated per retry) without a second facade. */
export interface SurfacedBodies {
  createStaticBody(desc: SurfacedStaticBodyDesc): BodyId;
  createStaticMesh(desc: SurfacedStaticMeshDesc): BodyId;
  createPooledBox(desc: SurfacedPooledBoxDesc): BodyId;
  activate(id: BodyId, pos: V3, quat: Quat): void;
  deactivate(id: BodyId): void;
  isActive(id: BodyId): boolean;
  /** Scoped removal: unregisters and destroys. Not for the hot path. */
  destroy(id: BodyId): void;
  /** Destroys every body this facade created that is still alive. */
  dispose(): void;
  readonly count: number;
}

export function createSurfacedBodies(
  world: IPhysicsWorld,
  registry: SurfaceRegistry,
): SurfacedBodies {
  const owned = new Set<BodyId>();
  function own(id: BodyId, surface: SurfaceId): BodyId {
    try {
      registry.register(id, surface);
    } catch (error) {
      world.destroyBody(id);
      throw error;
    }
    owned.add(id);
    return id;
  }
  return {
    createStaticBody(desc) {
      const { surface, ...body } = desc;
      return own(
        world.createStaticBody({ ...body, surfaceId: surface }),
        surface,
      );
    },
    createStaticMesh(desc) {
      const { surface, ...mesh } = desc;
      return own(
        world.createStaticMesh({ ...mesh, surfaceId: surface }),
        surface,
      );
    },
    createPooledBox(desc) {
      const { surface, ...body } = desc;
      return own(
        world.createPooledBox({ ...body, surfaceId: surface }),
        surface,
      );
    },
    activate(id, pos, quat) {
      world.activateBody(id, pos, quat);
    },
    deactivate(id) {
      world.deactivateBody(id);
    },
    isActive(id) {
      return world.isBodyActive(id);
    },
    destroy(id) {
      if (!owned.delete(id))
        throw new Error('Body is not owned by this facade.');
      registry.unregister(id);
      world.destroyBody(id);
    },
    dispose() {
      for (const id of owned) {
        registry.unregister(id);
        world.destroyBody(id);
      }
      owned.clear();
    },
    get count() {
      return owned.size;
    },
  };
}
