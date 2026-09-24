import { describe, expect, it, vi } from 'vitest';
import type { IPhysicsWorld } from '../src/physics/adapter';
import { createImpactSeverity } from '../src/core/impactSeverity';
import { createSurfaceRegistry } from '../src/world/surfaceRegistry';
import { createSurfacedBodies } from '../src/world/surfacedBodies';
import { createPropPools } from '../src/world/bodyPool';
import { createBreakableProps } from '../src/world/breakableProps';

function fakeWorld() {
  let next = 100;
  const active = new Map<number, boolean>();
  const velocity = new Map<number, { x: number; y: number; z: number }>();
  const activated: number[] = [];
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
      active.set(id, true);
      activated.push(id);
    }),
    deactivateBody: vi.fn((id: number) => active.set(id, false)),
    isBodyActive: (id: number) => active.get(id) ?? false,
    destroyBody: vi.fn((id: number) => active.delete(id)),
    getLinearVelocity: vi.fn(
      (id: number, out: { x: number; y: number; z: number }) => {
        const value = velocity.get(id) ?? { x: 0, y: 0, z: 0 };
        out.x = value.x;
        out.y = value.y;
        out.z = value.z;
      },
    ),
    setLinearVelocity: vi.fn(
      (id: number, value: { x: number; y: number; z: number }) =>
        velocity.set(id, { x: value.x, y: value.y, z: value.z }),
    ),
    setAngularVelocity: vi.fn(),
  } as unknown as IPhysicsWorld;
  return { world, active, activated, velocity };
}

describe('breakable props', () => {
  it('breaks once into pooled debris, retires settled fragments, and resets without body churn', () => {
    const { world, active, activated, velocity } = fakeWorld();
    const bodies = createSurfacedBodies(world, createSurfaceRegistry());
    const pools = createPropPools(bodies);
    const firstPropDescriptor = (
      world.createPooledBox as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0] as {
      motion: string;
      mass?: number;
      restitution?: number;
    };
    expect(firstPropDescriptor.motion).toBe('dynamic');
    expect(firstPropDescriptor.mass).toBe(15);
    expect(firstPropDescriptor.restitution).toBe(0.2);
    const breaks: number[] = [];
    const props = createBreakableProps({
      physics: world,
      pools,
      vehicleBody: 1,
      onBreak: (severity) => breaks.push(severity),
      placements: [
        {
          position: { x: 0, y: 0.5, z: -10 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
        },
        {
          position: { x: 1, y: 0.5, z: -10 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
        },
      ],
    });
    const creates = (world.createPooledBox as ReturnType<typeof vi.fn>).mock
      .calls.length;
    const prop = activated[0]!;
    const impact = createImpactSeverity();
    impact.severity = 0.5;
    impact.approachSpeed = 5;
    const point = { x: 0, y: 0.5, z: -10 };
    const normal = { x: 0, y: 0, z: 1 };
    const vehicleVelocity = { x: 0, y: 0, z: -10 };
    props.onContact(1, prop, point, normal, vehicleVelocity, impact);
    expect(active.get(prop)).toBe(true);
    expect(pools.debris.liveCount).toBe(0);
    props.onContact(1, prop, point, normal, vehicleVelocity, impact);
    props.update(0);
    expect(active.get(prop)).toBe(false);
    expect(pools.debris.liveCount).toBe(8);
    expect(breaks).toEqual([0.5]);
    expect(
      (world.createPooledBox as ReturnType<typeof vi.fn>).mock.calls.length,
    ).toBe(creates);

    for (const id of activated.slice(2)) velocity.set(id, { x: 0, y: 0, z: 0 });
    props.update(0.75);
    expect(pools.debris.liveCount).toBe(0);
    props.reset();
    impact.approachSpeed = 1;
    vehicleVelocity.z = -1;
    props.onContact(1, activated[0]!, point, normal, vehicleVelocity, impact);
    props.update(0);
    expect(active.get(activated[0]!)).toBe(true);
    expect(breaks).toEqual([0.5]);

    props.reset();
    impact.approachSpeed = 0.5;
    vehicleVelocity.z = -10;
    props.onContact(1, activated[0]!, point, normal, vehicleVelocity, impact);
    props.update(0);
    expect(pools.debris.liveCount).toBe(8);

    props.reset();
    expect(pools.breakables.liveCount).toBe(2);
    expect(pools.debris.liveCount).toBe(0);
    expect(
      (world.createPooledBox as ReturnType<typeof vi.fn>).mock.calls.length,
    ).toBe(creates);
    props.dispose();
    pools.dispose();
    expect(active.size).toBe(0);
  });

  it('maps large authored sets onto a bounded non-evicting active pool', () => {
    const { world } = fakeWorld();
    const bodies = createSurfacedBodies(world, createSurfaceRegistry());
    const pools = createPropPools(bodies);
    const placements = Array.from({ length: 8 }, (_, index) => ({
      position: { x: index, y: 0.5, z: -10 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    }));
    const props = createBreakableProps({
      physics: world,
      pools,
      placements,
      vehicleBody: 1,
      maxActiveProps: 4,
    });
    expect(
      placements.slice(0, 4).every((_, index) => props.isActive(index)),
    ).toBe(true);
    expect(props.isActive(4)).toBe(false);
    props.activate(4);
    expect(props.isActive(0)).toBe(true);
    expect(props.isActive(4)).toBe(false);
    props.deactivate(0);
    expect(props.activate(4)).toBe(true);
    expect(props.isActive(0)).toBe(false);
    expect(props.isActive(4)).toBe(true);
  });
});
