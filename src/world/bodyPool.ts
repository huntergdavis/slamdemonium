import type { BodyId, Quat, V3 } from '../physics/adapter';
import { SURFACE_IDS } from '../content/surfaces';
import type { SurfacedBodies, SurfacedPooledBoxDesc } from './surfacedBodies';

/** Pool sizing, stated so it can be argued with rather than inherited.
 *
 * Body budget: Jolt is initialised with 1024 bodies. The default track uses
 * 130 (one ground, 128 barrier segments, one car), four ramps and 48 loop
 * slabs. This pool adds 240 (48 breakables and 192 debris), for 422 bodies
 * total and about 600 spare. A denser smash route is a change to these two
 * numbers, not to the lifecycle mechanism.
 *
 * Debris: 192 fragments is 24 smashed props with 8 fragments each alive at
 * the same time. When the pool is exhausted the oldest active fragment is
 * retired and reused, so a long chain degrades gracefully instead of failing.
 * Breakables: 48 intact props placed per run: 32 infield boxes and 16 gate
 * panels. Phase C decides shapes and
 * masses; the placeholders below only reserve the bodies at boot so that no
 * body is ever created or destroyed mid-session, which is what keeps the
 * WebAssembly heap regression exactly equal to its 60 second baseline. */
export const POOL_BUDGET = Object.freeze({ breakables: 48, debris: 192 });

export interface BodyPoolSpec {
  readonly count: number;
  readonly desc: SurfacedPooledBoxDesc;
}

/** Fixed-capacity pool over pre-created bodies. acquire/release allocate
 * nothing: slots are typed arrays sized once at construction. */
export class BodyPool {
  private readonly ids: Float64Array;
  private readonly active: Uint8Array;
  private readonly stamps: Float64Array;
  private stamp = 0;
  private activeCount = 0;
  private disposed = false;

  constructor(
    private readonly bodies: SurfacedBodies,
    private readonly spec: BodyPoolSpec,
  ) {
    if (!Number.isSafeInteger(spec.count) || spec.count <= 0)
      throw new RangeError('Pool size must be a positive integer.');
    this.ids = new Float64Array(spec.count);
    this.active = new Uint8Array(spec.count);
    this.stamps = new Float64Array(spec.count);
    for (let slot = 0; slot < spec.count; slot++)
      this.ids[slot] = bodies.createPooledBox(spec.desc);
  }

  get capacity(): number {
    return this.ids.length;
  }

  get halfExtents(): Readonly<V3> {
    return this.spec.desc.halfExtents;
  }
  get liveCount(): number {
    return this.activeCount;
  }

  /** Activates a free body at the pose; when none is free, retires the
   * oldest active body and reuses it. Returns the body id. */
  acquire(pos: V3, quat: Quat): BodyId {
    if (this.disposed) throw new Error('Body pool is disposed.');
    let slot = -1;
    let oldest = Infinity;
    for (let index = 0; index < this.ids.length; index++) {
      if (this.active[index] === 0) {
        slot = index;
        break;
      }
      if (this.stamps[index]! < oldest) {
        oldest = this.stamps[index]!;
        slot = index;
      }
    }
    const id = this.ids[slot]!;
    if (this.active[slot] === 0) {
      this.active[slot] = 1;
      this.activeCount++;
    }
    this.stamps[slot] = ++this.stamp;
    this.bodies.activate(id, pos, quat);
    return id;
  }

  /** Deactivates the body; false if it is not an active member. */
  release(id: BodyId): boolean {
    if (this.disposed) return false;
    for (let slot = 0; slot < this.ids.length; slot++) {
      if (this.ids[slot] !== id || this.active[slot] === 0) continue;
      this.active[slot] = 0;
      this.activeCount--;
      this.bodies.deactivate(id);
      return true;
    }
    return false;
  }

  releaseAll(): void {
    if (this.disposed) return;
    for (let slot = 0; slot < this.ids.length; slot++) {
      if (this.active[slot] === 0) continue;
      this.active[slot] = 0;
      this.bodies.deactivate(this.ids[slot]!);
    }
    this.activeCount = 0;
  }

  /** Scoped teardown: destroys every pooled body. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (let slot = 0; slot < this.ids.length; slot++)
      this.bodies.destroy(this.ids[slot]!);
    this.activeCount = 0;
  }
}

export interface PropPools {
  readonly breakables: BodyPool;
  readonly debris: BodyPool;
  dispose(): void;
}

/** Boot-time reservation of the phase C prop bodies. Shapes are placeholders
 * until phase C authors props; only the counts are decisions here. */
export function createPropPools(bodies: SurfacedBodies): PropPools {
  const breakables = new BodyPool(bodies, {
    count: POOL_BUDGET.breakables,
    desc: {
      // Small scenery must give way to the car. Keeping these pooled bodies
      // dynamic avoids an immovable-wall response before deferred breakage
      // runs after the physics step; the low mass makes the hit feel like
      // destruction while preserving the pooled, allocation-free lifecycle.
      motion: 'dynamic',
      halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
      mass: 15,
      comOffset: { x: 0, y: 0, z: 0 },
      inertiaScale: { x: 1, y: 1, z: 1 },
      friction: 0.6,
      restitution: 0.2,
      ccd: false,
      maxAngularVelocity: 30,
      angularDamping: 0.1,
      surface: SURFACE_IDS.concrete,
    },
  });
  const debris = new BodyPool(bodies, {
    count: POOL_BUDGET.debris,
    desc: {
      motion: 'dynamic',
      halfExtents: { x: 0.2, y: 0.2, z: 0.2 },
      mass: 4,
      comOffset: { x: 0, y: 0, z: 0 },
      inertiaScale: { x: 1, y: 1, z: 1 },
      friction: 0.6,
      restitution: 0.2,
      ccd: false,
      maxAngularVelocity: 30,
      angularDamping: 0.1,
      surface: SURFACE_IDS.concrete,
    },
  });
  return {
    breakables,
    debris,
    dispose() {
      breakables.dispose();
      debris.dispose();
    },
  };
}
