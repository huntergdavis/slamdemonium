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
  readonly propCapacity: number;
  readonly fragmentCapacity: number;
  readonly propHalfExtents: Readonly<V3>;
  readonly fragmentHalfExtents: Readonly<V3>;
  /** Copies active body IDs into caller-owned fixed buffers; no allocation. */
  copyActivePropIds(out: Float64Array): number;
  copyActiveFragmentIds(out: Float64Array): number;
  /** Activates all authored props; call only during boot or reset. */
  reset(): void;
  /** Handles one already-estimated vehicle contact. */
  onContact(
    bodyA: BodyId,
    bodyB: BodyId,
    point: Readonly<V3>,
    normalIntoVehicle: Readonly<V3>,
    vehicleVelocity: Readonly<V3>,
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
// A fast, wide burst makes the replacement read as destruction rather than a
// pile being nudged. The prop remains pooled and the contact stays deferred.
const FRAGMENT_SPEED = 4.5;
const FRAGMENT_SPREAD = 2.4;
const FRAGMENT_SPACING = 0.25;
const BREAK_APPROACH_SPEED = 3;
const BREAK_TOTAL_SPEED_FRACTION = 0.5;

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
  const contactQueueCapacity = pools.breakables.capacity;
  const contactProp = new Int32Array(contactQueueCapacity);
  const contactPointX = new Float64Array(contactQueueCapacity);
  const contactPointY = new Float64Array(contactQueueCapacity);
  const contactPointZ = new Float64Array(contactQueueCapacity);
  const contactNormalX = new Float64Array(contactQueueCapacity);
  const contactNormalY = new Float64Array(contactQueueCapacity);
  const contactNormalZ = new Float64Array(contactQueueCapacity);
  const contactVelocityX = new Float64Array(contactQueueCapacity);
  const contactVelocityY = new Float64Array(contactQueueCapacity);
  const contactVelocityZ = new Float64Array(contactQueueCapacity);
  const contactSeverity = new Float64Array(contactQueueCapacity);
  const propQueued = new Uint8Array(pools.breakables.capacity);
  let contactQueueHead = 0;
  let contactQueueTail = 0;
  let contactQueueCount = 0;
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
    velocityX: number,
    velocityY: number,
    velocityZ: number,
    severity: number,
  ): void {
    const speed = FRAGMENT_SPEED + Math.max(0, Math.min(1, severity)) * 7;
    for (let fragment = 0; fragment < FRAGMENTS_PER_BREAK; fragment++) {
      const angle = (fragment * Math.PI * 2) / FRAGMENTS_PER_BREAK;
      const sideX = Math.cos(angle) * FRAGMENT_SPREAD;
      const sideZ = Math.sin(angle) * FRAGMENT_SPREAD;
      fragmentPosition.x = pointX + sideX * FRAGMENT_SPACING;
      fragmentPosition.y = pointY + 0.12 + (fragment % 2) * 0.08;
      fragmentPosition.z = pointZ + sideZ * FRAGMENT_SPACING;
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
      const alongNormal =
        velocityX * -normalX + velocityY * -normalY + velocityZ * -normalZ;
      const carriedSpeed = Math.max(0, alongNormal);
      fragmentVelocity.x = -normalX * (speed + carriedSpeed) + sideX;
      fragmentVelocity.y =
        velocityY + Math.abs(normalY) * speed + 1.5 + (fragment % 3) * 0.5;
      fragmentVelocity.z = -normalZ * (speed + carriedSpeed) + sideZ;
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
    propQueued.fill(0);
    contactQueueHead = 0;
    contactQueueTail = 0;
    contactQueueCount = 0;
    activateProps();
  }

  function onContact(
    bodyA: BodyId,
    bodyB: BodyId,
    point: Readonly<V3>,
    normalIntoVehicle: Readonly<V3>,
    vehicleVelocity: Readonly<V3>,
    impact: Readonly<ImpactSeverity>,
  ): void {
    if (disposed) return;
    const other =
      bodyA === vehicleBody ? bodyB : bodyB === vehicleBody ? bodyA : -1;
    if (other < 0) return;
    const prop = findProp(other);
    if (prop < 0) return;
    // A shallow sideswipe can have low normal closing speed despite being a
    // fast hit. Keep genuinely slow nudges intact, but let a fast contact
    // break based on half the vehicle's total speed as well.
    const totalSpeed = Math.sqrt(
      vehicleVelocity.x * vehicleVelocity.x +
        vehicleVelocity.y * vehicleVelocity.y +
        vehicleVelocity.z * vehicleVelocity.z,
    );
    const breakSpeed = Math.max(
      impact.approachSpeed,
      totalSpeed * BREAK_TOTAL_SPEED_FRACTION,
    );
    if (breakSpeed < BREAK_APPROACH_SPEED) return;
    // Jolt invokes this callback during Step; defer all body mutations until
    // update() after Step has returned. One queued entry per prop also drops
    // repeated contact points from the same physics step.
    if (propQueued[prop] !== 0 || contactQueueCount >= contactQueueCapacity)
      return;
    const slot = contactQueueTail;
    contactProp[slot] = prop;
    contactPointX[slot] = point.x;
    contactPointY[slot] = point.y;
    contactPointZ[slot] = point.z;
    contactNormalX[slot] = normalIntoVehicle.x;
    contactNormalY[slot] = normalIntoVehicle.y;
    contactNormalZ[slot] = normalIntoVehicle.z;
    contactVelocityX[slot] = vehicleVelocity.x;
    contactVelocityY[slot] = vehicleVelocity.y;
    contactVelocityZ[slot] = vehicleVelocity.z;
    contactSeverity[slot] = impact.severity;
    propQueued[prop] = 1;
    contactQueueTail = (slot + 1) % contactQueueCapacity;
    contactQueueCount++;
  }

  function processContacts(): void {
    while (contactQueueCount > 0) {
      const slot = contactQueueHead;
      const prop = contactProp[slot];
      contactQueueHead = (slot + 1) % contactQueueCapacity;
      contactQueueCount--;
      if (prop === undefined) continue;
      if (prop < 0 || prop >= propActive.length) continue;
      propQueued[prop] = 0;
      if (propActive[prop] === 0) continue;
      const id = propIds[prop];
      if (id === undefined) continue;
      propActive[prop] = 0;
      pools.breakables.release(id);
      spawnFragments(
        contactPointX[slot] ?? 0,
        contactPointY[slot] ?? 0,
        contactPointZ[slot] ?? 0,
        contactNormalX[slot] ?? 0,
        contactNormalY[slot] ?? 0,
        contactNormalZ[slot] ?? 0,
        contactVelocityX[slot] ?? 0,
        contactVelocityY[slot] ?? 0,
        contactVelocityZ[slot] ?? 0,
        contactSeverity[slot] ?? 0,
      );
    }
  }

  function update(dtSeconds: number): void {
    if (disposed) return;
    processContacts();
    const dt = Math.max(0, Number.isFinite(dtSeconds) ? dtSeconds : 0);
    for (let index = 0; index < fragmentActive.length; index++) {
      if (fragmentActive[index] === 0) continue;
      const id = fragmentIds[index];
      if (id === undefined) continue;
      const ageBefore = fragmentAge[index];
      const stillBefore = fragmentStill[index];
      if (ageBefore === undefined || stillBefore === undefined) continue;
      // noUncheckedIndexedAccess widens even typed-array reads to include undefined.
      const age = Math.min(FRAGMENT_TTL_SECONDS, (ageBefore ?? 0) + dt);
      fragmentAge[index] = age;
      physics.getLinearVelocity(id, observedVelocity);
      const speedSquared =
        observedVelocity.x * observedVelocity.x +
        observedVelocity.y * observedVelocity.y +
        observedVelocity.z * observedVelocity.z;
      const still =
        speedSquared < FRAGMENT_SETTLE_SPEED * FRAGMENT_SETTLE_SPEED
          ? Math.min(FRAGMENT_SETTLE_SECONDS, (stillBefore ?? 0) + dt)
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
    propCapacity: propIds.length,
    fragmentCapacity: fragmentIds.length,
    propHalfExtents: pools.breakables.halfExtents,
    fragmentHalfExtents: pools.debris.halfExtents,
    copyActivePropIds(out: Float64Array): number {
      let count = 0;
      for (let index = 0; index < propActive.length; index++) {
        if (propActive[index] === 0 || count >= out.length) continue;
        const id = propIds[index];
        if (id === undefined) continue;
        out[count++] = id;
      }
      return count;
    },
    copyActiveFragmentIds(out: Float64Array): number {
      let count = 0;
      for (let index = 0; index < fragmentActive.length; index++) {
        if (fragmentActive[index] === 0 || count >= out.length) continue;
        const id = fragmentIds[index];
        if (id === undefined) continue;
        out[count++] = id;
      }
      return count;
    },
    reset,
    onContact,
    update,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      pools.breakables.releaseAll();
      clearFragments();
      propActive.fill(0);
      propQueued.fill(0);
      contactQueueHead = 0;
      contactQueueTail = 0;
      contactQueueCount = 0;
    },
  };
}
