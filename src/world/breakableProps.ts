import type { BodyId, IPhysicsWorld, Quat, V3 } from '../physics/adapter';
import type { ImpactSeverity } from '../core/impactSeverity';
import type { PropPools } from './bodyPool';

/** A boot-authored pose for one breakable prop. The pool owns its body. */
export interface BreakablePlacement {
  readonly position: Readonly<V3>;
  readonly rotation: Readonly<Quat>;
}

export interface BreakablePropsOptions {
  readonly physics: IPhysicsWorld;
  readonly pools: PropPools;
  readonly placements: readonly BreakablePlacement[];
  readonly vehicleBody: BodyId;
}

export interface BreakableProps {
  /** Activates all authored props; call only during boot or reset. */
  reset(): void;
  /** Handles one already-estimated vehicle contact. */
  onContact(
    bodyA: BodyId,
    bodyB: BodyId,
    point: Readonly<V3>,
    normalIntoVehicle: Readonly<V3>,
    impact: Readonly<ImpactSeverity>,
  ): void;
  /** Retires settled or expired fragments after a physics step. */
  update(dtSeconds: number): void;
  dispose(): void;
}

const FRAGMENTS_PER_BREAK = 8;
const FRAGMENT_SETTLE_SPEED = 0.35;
const FRAGMENT_SETTLE_SECONDS = 0.75;
const FRAGMENT_TTL_SECONDS = 8;
const FRAGMENT_SPEED = 2.5;
const FRAGMENT_SPREAD = 0.9;

/**
 * Pooled breakables for the smash route. Four authored banks of eight consume
 * the full 32-prop budget; 128 debris bodies represent sixteen simultaneous
 * eight-fragment breaks. No body is created or destroyed during a run.
 */
export function createBreakableProps(
  options: BreakablePropsOptions,
): BreakableProps {
  if (options.placements.length > options.pools.breakables.capacity)
    throw new RangeError('Breakable placements exceed the pool budget.');

  const { physics, pools, vehicleBody } = options;
  const propIds = new Float64Array(pools.breakables.capacity);
  const propActive = new Uint8Array(pools.breakables.capacity);
  const fragmentIds = new Float64Array(pools.debris.capacity);
  const fragmentActive = new Uint8Array(pools.debris.capacity);
  const fragmentAge = new Float64Array(pools.debris.capacity);
  const fragmentStill = new Float64Array(pools.debris.capacity);
  const fragmentVelocity: V3 = { x: 0, y: 0, z: 0 };
  const fragmentPosition: V3 = { x: 0, y: 0, z: 0 };
  const fragmentRotation: Quat = { x: 0, y: 0, z: 0, w: 1 };
  const fragmentAngular: V3 = { x: 0, y: 0, z: 0 };
  const observedVelocity: V3 = { x: 0, y: 0, z: 0 };
  let disposed = false;

  function findProp(body: BodyId): number {
    for (let index = 0; index < propIds.length; index++) {
      if (propActive[index] !== 0 && propIds[index] === body) return index;
    }
    return -1;
  }

  function findFragment(body: BodyId): number {
    for (let index = 0; index < fragmentIds.length; index++) {
      if (fragmentActive[index] !== 0 && fragmentIds[index] === body)
        return index;
    }
    return -1;
  }

  function findFreeFragment(): number {
    for (let index = 0; index < fragmentActive.length; index++) {
      if (fragmentActive[index] === 0) return index;
    }
    return -1;
  }

  function activateProps(): void {
    for (let index = 0; index < options.placements.length; index++) {
      const placement = options.placements[index];
      if (!placement) continue;
      const id = pools.breakables.acquire(
        placement.position as V3,
        placement.rotation as Quat,
      );
      propIds[index] = id;
      propActive[index] = 1;
    }
  }

  function clearFragments(): void {
    pools.debris.releaseAll();
    fragmentActive.fill(0);
    fragmentAge.fill(0);
    fragmentStill.fill(0);
  }

  function spawnFragments(
    pointX: number,
    pointY: number,
    pointZ: number,
    normalX: number,
    normalY: number,
    normalZ: number,
    severity: number,
  ): void {
    const speed = FRAGMENT_SPEED + Math.max(0, Math.min(1, severity)) * 7;
    for (let fragment = 0; fragment < FRAGMENTS_PER_BREAK; fragment++) {
      const angle = (fragment * Math.PI * 2) / FRAGMENTS_PER_BREAK;
      const sideX = Math.cos(angle) * FRAGMENT_SPREAD;
      const sideZ = Math.sin(angle) * FRAGMENT_SPREAD;
      fragmentPosition.x = pointX + sideX * 0.15;
      fragmentPosition.y = pointY + 0.12 + (fragment % 2) * 0.08;
      fragmentPosition.z = pointZ + sideZ * 0.15;
      fragmentRotation.x = 0;
      fragmentRotation.y = 0;
      fragmentRotation.z = 0;
      fragmentRotation.w = 1;
      const id = pools.debris.acquire(fragmentPosition, fragmentRotation);
      let index = findFragment(id);
      if (index < 0) index = findFreeFragment();
      if (index < 0) continue;
      fragmentIds[index] = id;
      fragmentActive[index] = 1;
      fragmentAge[index] = 0;
      fragmentStill[index] = 0;
      fragmentVelocity.x = -normalX * speed + sideX;
      fragmentVelocity.y =
        Math.abs(normalY) * speed + 1.5 + (fragment % 3) * 0.5;
      fragmentVelocity.z = -normalZ * speed + sideZ;
      physics.setLinearVelocity(id, fragmentVelocity);
      fragmentAngular.x = sideZ * 8;
      fragmentAngular.y = (fragment % 2 === 0 ? 1 : -1) * 6;
      fragmentAngular.z = -sideX * 8;
      physics.setAngularVelocity(id, fragmentAngular);
    }
  }

  function reset(): void {
    if (disposed) return;
    pools.breakables.releaseAll();
    clearFragments();
    propActive.fill(0);
    activateProps();
  }

  function onContact(
    bodyA: BodyId,
    bodyB: BodyId,
    point: Readonly<V3>,
    normalIntoVehicle: Readonly<V3>,
    impact: Readonly<ImpactSeverity>,
  ): void {
    if (disposed) return;
    const other =
      bodyA === vehicleBody ? bodyB : bodyB === vehicleBody ? bodyA : -1;
    if (other < 0) return;
    const prop = findProp(other);
    if (prop < 0) return;
    // Copy borrowed contact scalars before the pool/physics calls below.
    const pointX = point.x;
    const pointY = point.y;
    const pointZ = point.z;
    const normalX = normalIntoVehicle.x;
    const normalY = normalIntoVehicle.y;
    const normalZ = normalIntoVehicle.z;
    const severity = impact.severity;
    propActive[prop] = 0;
    pools.breakables.release(other);
    spawnFragments(pointX, pointY, pointZ, normalX, normalY, normalZ, severity);
  }

  function update(dtSeconds: number): void {
    if (disposed) return;
    const dt = Math.max(0, Number.isFinite(dtSeconds) ? dtSeconds : 0);
    for (let index = 0; index < fragmentActive.length; index++) {
      if (fragmentActive[index] === 0) continue;
      const id = fragmentIds[index];
      if (id === undefined) continue;
      const age = Math.min(
        FRAGMENT_TTL_SECONDS,
        fragmentAge[index] + dt,
      );
      fragmentAge[index] = age;
      physics.getLinearVelocity(id, observedVelocity);
      const speedSquared =
        observedVelocity.x * observedVelocity.x +
        observedVelocity.y * observedVelocity.y +
        observedVelocity.z * observedVelocity.z;
      const still =
        speedSquared < FRAGMENT_SETTLE_SPEED * FRAGMENT_SETTLE_SPEED
          ? Math.min(FRAGMENT_SETTLE_SECONDS, fragmentStill[index] + dt)
          : 0;
      fragmentStill[index] = still;
      if (age >= FRAGMENT_TTL_SECONDS || still >= FRAGMENT_SETTLE_SECONDS) {
        pools.debris.release(id);
        fragmentActive[index] = 0;
      }
    }
  }

  activateProps();
  return {
    reset,
    onContact,
    update,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      pools.breakables.releaseAll();
      clearFragments();
      propActive.fill(0);
    },
  };
}
