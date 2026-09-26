import { Mesh, Quaternion, Scene, Vector3 } from 'three';
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
  type LoopSpec,
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

describe('loop shoulders', () => {
  const banked: LoopSpec = {
    ...loop,
    width: 20,
    shift: 22,
    surface: SURFACE_IDS.stickyAsphalt,
    shoulder: { width: 2, bank: Math.PI / 6 },
  };
  it('adds one banked strip per edge whose inner edge meets the lane and whose outer edge rises, all on the chosen surface', () => {
    const slabs = loopSlabDescriptors(banked);
    expect(slabs).toHaveLength(banked.segments * 3);
    const plain = loopSlabDescriptors({ ...loop, width: 20, shift: 22 });
    for (let i = 0; i < banked.segments; i++) {
      const lane = slabs[3 * i]!;
      expect(lane.center).toEqual(plain[i]!.center);
      const q = lane.rotation!;
      const laneQ = new Quaternion(q.x, q.y, q.z, q.w);
      const right = new Vector3(1, 0, 0).applyQuaternion(laneQ);
      const up = new Vector3(0, 1, 0).applyQuaternion(laneQ);
      const laneTop = new Vector3(
        lane.center.x,
        lane.center.y,
        lane.center.z,
      ).addScaledVector(up, LOOP_THICKNESS / 2);
      for (const [k, side] of [
        [1, -1],
        [2, 1],
      ] as const) {
        const shoulder = slabs[3 * i + k]!;
        expect(shoulder.surface).toBe(SURFACE_IDS.stickyAsphalt);
        expect(shoulder.halfExtents.x).toBe(1);
        const sq = shoulder.rotation!;
        const sQ = new Quaternion(sq.x, sq.y, sq.z, sq.w);
        const sRight = new Vector3(1, 0, 0).applyQuaternion(sQ);
        const sUp = new Vector3(0, 1, 0).applyQuaternion(sQ);
        // Banked 30 degrees about the tangent: normal tilts toward the lane.
        expect(sUp.angleTo(up)).toBeCloseTo(Math.PI / 6, 6);
        expect(sUp.dot(right) * side).toBeLessThan(0);
        // Its inner top edge is the lane's outer top edge.
        const centre = new Vector3(
          shoulder.center.x,
          shoulder.center.y,
          shoulder.center.z,
        );
        const innerTop = centre
          .clone()
          .addScaledVector(sUp, LOOP_THICKNESS / 2)
          .addScaledVector(sRight, -side * 1);
        const laneEdgeTop = laneTop.clone().addScaledVector(right, side * 10);
        expect(innerTop.distanceTo(laneEdgeTop)).toBeLessThan(1e-6);
        // Its outer edge stands above the lane plane by width * sin(bank).
        const outerTop = centre
          .clone()
          .addScaledVector(sUp, LOOP_THICKNESS / 2)
          .addScaledVector(sRight, side * 1);
        expect(outerTop.clone().sub(laneTop).dot(up)).toBeCloseTo(
          2 * Math.sin(Math.PI / 6),
          6,
        );
      }
    }
    // The footprint grows by the shoulder width.
    expect(loopFootprint(banked).radius).toBeGreaterThan(
      loopFootprint({ ...loop, width: 20, shift: 22 }).radius,
    );
  });
});

describe('loop through the facade', () => {
  it('registers every slab as asphalt so the wheels keep grip all the way round', () => {
    let next = 700;
    const world = {
      createStaticBox: vi.fn(() => next++),
      createStaticBody: vi.fn(() => next++),
      createStaticMesh: vi.fn(() => next++),
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
    expect(ids).toHaveLength(1);
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

  it('builds one mesh from the same tessellation as the collider', () => {
    const scene = new Scene();
    const dispose = vi.fn();
    const material = { dispose } as unknown as Material;
    const visual = createLoopVisual(scene, material, [loop]);
    expect(visual.root.children).toHaveLength(1);
    expect(visual.root.children[0]!.position.length()).toBe(0);
    visual.dispose();
    expect(scene.children).toHaveLength(0);
    expect(dispose).not.toHaveBeenCalled();
    void Vector3;
  });

  it('gives each slab the material of its own surface, so a loop with its own surface is visibly its own', () => {
    const scene = new Scene();
    const plain = { name: 'asphalt' } as unknown as Material;
    const sticky = { name: 'sticky' } as unknown as Material;
    const materialFor = vi.fn((surface: number) =>
      surface === SURFACE_IDS.stickyAsphalt ? sticky : plain,
    );
    const east: LoopSpec = {
      ...loop,
      x: 60,
      surface: SURFACE_IDS.stickyAsphalt,
      shoulder: { width: 3, bank: Math.PI / 15 },
    };
    const visual = createLoopVisual(scene, materialFor, [loop, east]);
    const meshes = visual.root.children as Mesh[];
    expect(meshes).toHaveLength(2);
    expect(meshes[0]!.material).toBe(plain);
    expect(meshes[1]!.material).toBe(sticky);
    expect(materialFor).toHaveBeenCalledTimes(2);
    visual.dispose();
  });
});
