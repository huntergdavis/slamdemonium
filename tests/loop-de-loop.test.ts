import { Quaternion, Scene, Vector3 } from 'three';
import type { Material } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { SURFACE_IDS } from '../src/content/surfaces';
import type { IPhysicsWorld } from '../src/physics/adapter';
import {
  LOOP_LAYOUT,
  LOOP_THICKNESS,
  createLoopVisual,
  installLoops,
  loopExit,
  loopFootprint,
  loopSlabDescriptors,
} from '../src/world/loopDeLoop';
import { createSurfaceRegistry } from '../src/world/surfaceRegistry';
import { createSurfacedBodies } from '../src/world/surfacedBodies';
import { createTrackSurfaceResolver } from '../src/world/trackSurfaces';

const loop = LOOP_LAYOUT[0]!;

describe('loop-de-loop geometry', () => {
  it('starts flush with the ground, reaches two radii high, and exits one lane inward with the same heading', () => {
    const slabs = loopSlabDescriptors(loop);
    expect(slabs).toHaveLength(loop.segments);
    // Top surface of the first slab is at the ground; its centre is half a
    // thickness below.
    const first = slabs[0]!;
    expect(first.center.y).toBeLessThan(LOOP_THICKNESS);
    expect(first.center.y).toBeGreaterThan(-LOOP_THICKNESS);
    const top = Math.max(...slabs.map((slab) => slab.center.y));
    expect(top).toBeCloseTo(2 * loop.radius - LOOP_THICKNESS / 2, 0);
    for (const slab of slabs) {
      const q = slab.rotation!;
      expect(Math.hypot(q.x, q.y, q.z, q.w)).toBeCloseTo(1, 6);
      expect(slab.surface).toBe(SURFACE_IDS.asphalt);
    }
    const exit = loopExit(loop);
    const entryRadius = Math.hypot(loop.x, loop.z);
    const exitRadius = Math.hypot(exit.x, exit.z);
    expect(entryRadius - exitRadius).toBeGreaterThan(8); // Inward, toward the centre.
    expect(Math.hypot(exit.x - loop.x, exit.z - loop.z)).toBeCloseTo(
      Math.abs(loop.shift),
      6,
    );
    // The exit lane must not overlap the entry lane.
    expect(Math.abs(loop.shift)).toBeGreaterThan(loop.width);
  });

  it('sits inside the barrier and clear of the racing line, in the north-west quadrant', () => {
    const footprint = loopFootprint(loop);
    const centreRadius = Math.hypot(footprint.x, footprint.z);
    expect(centreRadius + footprint.radius).toBeLessThan(127); // Route line and barrier both clear.
    expect(loop.x).toBeLessThan(0);
    expect(loop.z).toBeGreaterThan(0);
    // Every slab's ground footprint stays inside 120 m.
    for (const slab of loopSlabDescriptors(loop)) {
      const r = Math.hypot(slab.center.x, slab.center.z);
      expect(
        r + Math.hypot(slab.halfExtents.x, slab.halfExtents.z),
      ).toBeLessThan(121);
    }
  });
});

describe('loop through the facade', () => {
  it('registers every slab as asphalt so the wheels keep grip all the way round', () => {
    let next = 700;
    const world = {
      createStaticBox: vi.fn(() => next++),
      createStaticBody: vi.fn(() => next++),
      destroyBody: vi.fn(),
    } as unknown as IPhysicsWorld;
    const registry = createSurfaceRegistry();
    const ground = {
      center: { x: 0, y: -0.5, z: 0 },
      halfExtents: { x: 200, y: 0.5, z: 200 },
      rotY: 0,
    };
    const groundId = world.createStaticBox(ground.center, ground.halfExtents);
    const resolve = createTrackSurfaceResolver({
      bodies: { ground: groundId, barriers: [] },
      groundSurfaceId: SURFACE_IDS.asphalt,
      ground,
      kerbFootprint: () => false,
      registry,
    });
    const bodies = createSurfacedBodies(world, registry);
    const ids = installLoops(bodies, [loop]);
    expect(ids).toHaveLength(loop.segments);
    for (const id of ids) {
      expect(
        resolve(true, {
          distance: 0.3,
          point: { x: 0, y: 5, z: 0 },
          normal: { x: 0, y: -1, z: 0 }, // Inverted at the top.
          bodyId: id,
          surfaceId: 99,
        }),
      ).toBe(SURFACE_IDS.asphalt);
    }
  });

  it('builds one mesh per slab from the same descriptors as the colliders', () => {
    const scene = new Scene();
    const dispose = vi.fn();
    const material = { dispose } as unknown as Material;
    const visual = createLoopVisual(scene, material, [loop]);
    const slabs = loopSlabDescriptors(loop);
    expect(visual.root.children).toHaveLength(slabs.length);
    slabs.forEach((slab, index) => {
      const mesh = visual.root.children[index]!;
      expect(mesh.position.y).toBeCloseTo(slab.center.y, 9);
      const q = slab.rotation!;
      expect(
        mesh.quaternion.angleTo(new Quaternion(q.x, q.y, q.z, q.w)),
      ).toBeCloseTo(0, 6);
    });
    visual.dispose();
    expect(scene.children).toHaveLength(0);
    expect(dispose).not.toHaveBeenCalled();
    void Vector3;
  });
});
