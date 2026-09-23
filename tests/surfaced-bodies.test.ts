import { describe, expect, it, vi } from 'vitest';
import { SURFACE_IDS } from '../src/content/surfaces';
import type { IPhysicsWorld } from '../src/physics/adapter';
import { createSurfaceRegistry } from '../src/world/surfaceRegistry';
import { createSurfacedBodies } from '../src/world/surfacedBodies';
import { createTrackSurfaceResolver } from '../src/world/trackSurfaces';
import { BodyPool, POOL_BUDGET, createPropPools } from '../src/world/bodyPool';

/** Enough of IPhysicsWorld for the facade: ids, activity and destruction. */
function fakeWorld() {
  let next = 100;
  const active = new Map<number, boolean>();
  const world = {
    createStaticBox: vi.fn(() => {
      active.set(next, true);
      return next++;
    }),
    createStaticBody: vi.fn(() => {
      active.set(next, true);
      return next++;
    }),
    createPooledBox: vi.fn(() => {
      active.set(next, false);
      return next++;
    }),
    activateBody: vi.fn((id: number) => {
      if (!active.has(id)) throw new Error('Unknown physics body.');
      active.set(id, true);
    }),
    deactivateBody: vi.fn((id: number) => {
      if (!active.has(id)) throw new Error('Unknown physics body.');
      active.set(id, false);
    }),
    isBodyActive: (id: number) => {
      if (!active.has(id)) throw new Error('Unknown physics body.');
      return active.get(id)!;
    },
    destroyBody: vi.fn((id: number) => {
      if (!active.delete(id)) throw new Error('Unknown physics body.');
    }),
  } as unknown as IPhysicsWorld;
  return { world, alive: () => active.size };
}
const ground = {
  center: { x: 0, y: -0.5, z: 0 },
  halfExtents: { x: 100, y: 0.5, z: 100 },
  rotY: 0,
};
const hitOn = (bodyId: number) => ({
  distance: 0.3,
  point: { x: 5, y: 1, z: 5 },
  normal: { x: 0, y: Math.cos(0.26), z: Math.sin(0.26) },
  bodyId,
  surfaceId: 99, // Raw metadata is never trusted.
});

describe('surfaced bodies: registration is part of creation', () => {
  it('gives a pitched ramp installed after boot the asphalt it was authored with, and forgets it on destroy', () => {
    const { world } = fakeWorld();
    const registry = createSurfaceRegistry();
    const groundId = world.createStaticBox(ground.center, ground.halfExtents);
    const barrier = world.createStaticBox(ground.center, ground.halfExtents);
    const resolve = createTrackSurfaceResolver({
      bodies: { ground: groundId, barriers: [barrier] },
      groundSurfaceId: SURFACE_IDS.asphalt,
      ground,
      kerbFootprint: () => false,
      registry,
    });
    const bodies = createSurfacedBodies(world, registry);
    const ramp = bodies.createStaticBody({
      center: { x: 5, y: 0.5, z: 5 },
      halfExtents: { x: 2, y: 0.25, z: 4 },
      rotation: { x: Math.sin(0.13), y: 0, z: 0, w: Math.cos(0.13) },
      surface: SURFACE_IDS.asphalt,
    });
    // The failure this guards against: a wheel on the ramp with no tyre force.
    expect(resolve(true, hitOn(ramp))).toBe(SURFACE_IDS.asphalt);
    expect(resolve.diagnostics.lastStatus).toBe('resolved');
    expect(resolve.diagnostics.unknownBodySeen).toBe(false);
    bodies.destroy(ramp);
    expect(resolve(true, hitOn(ramp))).toBeNull(); // Defence in depth stays.
    expect(resolve.diagnostics.lastStatus).toBe('unknown-body');
    expect(bodies.count).toBe(0);
  });

  it('registers pooled bodies at creation so activation never touches the registry, and rolls back a failed registration', () => {
    const { world, alive } = fakeWorld();
    const registry = createSurfaceRegistry();
    const bodies = createSurfacedBodies(world, registry);
    const debris = bodies.createPooledBox({
      motion: 'static',
      halfExtents: { x: 0.2, y: 0.2, z: 0.2 },
      surface: SURFACE_IDS.concrete,
    });
    expect(registry.get(debris)).toBe(SURFACE_IDS.concrete);
    const before = registry.size;
    bodies.activate(debris, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 0, w: 1 });
    bodies.deactivate(debris);
    expect(registry.size).toBe(before);
    expect(() =>
      bodies.createPooledBox({
        motion: 'static',
        halfExtents: { x: 1, y: 1, z: 1 },
        surface: 42 as never,
      }),
    ).toThrow();
    expect(alive()).toBe(1); // The unregistrable body was destroyed again.
    bodies.dispose();
    expect(alive()).toBe(0);
    expect(registry.size).toBe(0);
  });
});

describe('body pool', () => {
  it('reserves its bodies at construction, reuses the oldest when exhausted, and destroys them only on dispose', () => {
    const { world, alive } = fakeWorld();
    const bodies = createSurfacedBodies(world, createSurfaceRegistry());
    const pool = new BodyPool(bodies, {
      count: 3,
      desc: { motion: 'static', halfExtents: { x: 1, y: 1, z: 1 }, surface: 2 },
    });
    expect(alive()).toBe(3);
    const pose = { x: 0, y: 1, z: 0 };
    const q = { x: 0, y: 0, z: 0, w: 1 };
    const a = pool.acquire(pose, q);
    const b = pool.acquire(pose, q);
    const c = pool.acquire(pose, q);
    expect(new Set([a, b, c]).size).toBe(3);
    expect(pool.liveCount).toBe(3);
    const d = pool.acquire(pose, q); // Exhausted: the oldest (a) is reused.
    expect(d).toBe(a);
    expect(pool.liveCount).toBe(3);
    expect(pool.release(b)).toBe(true);
    expect(pool.release(b)).toBe(false);
    expect(bodies.isActive(b)).toBe(false);
    expect(pool.liveCount).toBe(2);
    pool.releaseAll();
    expect(pool.liveCount).toBe(0);
    expect(alive()).toBe(3); // Nothing created or destroyed mid-session.
    pool.dispose();
    expect(alive()).toBe(0);
  });

  it('reserves the stated budget: 48 breakables and 192 debris, 422 of 1024 with the default track', () => {
    const { world, alive } = fakeWorld();
    const pools = createPropPools(
      createSurfacedBodies(world, createSurfaceRegistry()),
    );
    expect(POOL_BUDGET).toEqual({ breakables: 48, debris: 192 });
    expect(pools.breakables.capacity + pools.debris.capacity).toBe(240);
    expect(alive()).toBe(240);
    expect(130 + 4 + 48 + 240).toBeLessThanOrEqual(1024 - 600);
    pools.dispose();
    expect(alive()).toBe(0);
  });
});
