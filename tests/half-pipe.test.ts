import { Scene, Vector3 } from 'three';
import type { Material } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { SURFACE_IDS } from '../src/content/surfaces';
import type { IPhysicsWorld } from '../src/physics/adapter';
import {
  DEEP_HALF_PIPE_RADIUS,
  HALF_PIPE_EXIT_ANGLE,
  HALF_PIPE_THICKNESS,
  MIN_HALF_PIPE_RADIUS,
  createHalfPipeVisual,
  halfPipeFootprint,
  halfPipeHalfLength,
  halfPipeLipHeight,
  halfPipeRange,
  halfPipeSlabDescriptors,
  halfPipeWallRun,
  installHalfPipes,
  type HalfPipeSpec,
} from '../src/world/halfPipe';
import { createSurfaceRegistry } from '../src/world/surfaceRegistry';
import { createSurfacedBodies } from '../src/world/surfacedBodies';
import { createTrackSurfaceResolver } from '../src/world/trackSurfaces';

const pipe: HalfPipeSpec = {
  x: -220,
  z: 0,
  heading: -Math.PI / 2, // Axis along +X.
  radius: DEEP_HALF_PIPE_RADIUS,
  deck: 360,
  width: 60,
};

describe('half-pipe geometry', () => {
  it('is a ground-level U channel with near-vertical walls and coping rails', () => {
    expect(HALF_PIPE_EXIT_ANGLE).toBeCloseTo((85 * Math.PI) / 180, 12);
    expect(halfPipeLipHeight(pipe)).toBeCloseTo(
      16 * (1 - Math.cos(HALF_PIPE_EXIT_ANGLE)),
      9,
    );
    expect(halfPipeWallRun(pipe)).toBeCloseTo(
      16 * Math.sin(HALF_PIPE_EXIT_ANGLE),
      9,
    );
    expect(halfPipeHalfLength(pipe)).toBeCloseTo(180, 9);
    const slabs = halfPipeSlabDescriptors(pipe);
    const floor = slabs.find((s) => s.halfExtents.x === pipe.width / 2)!;
    const walls = slabs.filter(
      (s) =>
        s.surface === SURFACE_IDS.asphalt && s.halfExtents.x < pipe.width / 2,
    );
    const rails = slabs.filter((s) => s.surface === SURFACE_IDS.concrete);
    expect(walls.length).toBeGreaterThanOrEqual(32);
    expect(rails).toHaveLength(2);
    expect(floor.center.y + HALF_PIPE_THICKNESS / 2).toBeCloseTo(0, 9);
    expect(floor.halfExtents.z).toBeCloseTo(pipe.deck / 2, 9);
    expect(
      walls.every((s) => Math.abs(s.center.z - pipe.z) > pipe.width / 2),
    ).toBe(true);
    expect(walls.some((s) => s.center.z < pipe.z)).toBe(true);
    expect(walls.some((s) => s.center.z > pipe.z)).toBe(true);
    const fp = halfPipeFootprint(pipe);
    for (const slab of slabs)
      expect(
        Math.hypot(slab.center.x - fp.x, slab.center.z - fp.z),
      ).toBeLessThanOrEqual(fp.radius);
  });

  it('records the aquifer recipe and retains the launch estimate for placement checks', () => {
    expect(MIN_HALF_PIPE_RADIUS).toBe(16);
    expect(DEEP_HALF_PIPE_RADIUS).toBe(16);
    expect(halfPipeRange(30, 20)).toBeCloseTo(
      (900 * Math.sin(2 * HALF_PIPE_EXIT_ANGLE)) / 20,
      9,
    );
  });
});

describe('half-pipe through the facade', () => {
  it('registers every slab with its surface and builds one mesh per slab in that surface material', () => {
    let next = 900;
    const world = {
      createStaticBox: vi.fn(() => next++),
      createStaticBody: vi.fn(() => next++),
      destroyBody: vi.fn(),
    } as unknown as IPhysicsWorld;
    const registry = createSurfaceRegistry();
    const ground = {
      center: { x: 0, y: -0.5, z: 0 },
      halfExtents: { x: 500, y: 0.5, z: 500 },
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
    const ids = installHalfPipes(bodies, [pipe]);
    const slabs = halfPipeSlabDescriptors(pipe);
    expect(ids).toHaveLength(slabs.length);
    ids.forEach((id, i) => {
      const hit = {
        distance: 0.3,
        point: { x: 0, y: 3, z: 0 },
        normal: { x: 0, y: 1, z: 0 },
        bodyId: id,
        surfaceId: 99,
      };
      // The registry reports the authored surface; the rails are concrete
      // (a contact surface the tyre model then treats as no grip).
      expect(resolve(true, hit)).toBe(slabs[i]!.surface);
    });
    const scene = new Scene();
    const asphalt = { name: 'a' } as unknown as Material;
    const concrete = { name: 'c' } as unknown as Material;
    const visual = createHalfPipeVisual(
      scene,
      (s) => (s === SURFACE_IDS.concrete ? concrete : asphalt),
      [pipe],
    );
    expect(visual.root.children).toHaveLength(slabs.length);
    slabs.forEach((slab, i) => {
      const mesh = visual.root.children[i] as unknown as {
        material: Material;
        position: Vector3;
      };
      expect(mesh.material).toBe(
        slab.surface === SURFACE_IDS.concrete ? concrete : asphalt,
      );
      expect(mesh.position.y).toBeCloseTo(slab.center.y, 9);
    });
    visual.dispose();
    expect(scene.children).toHaveLength(0);
  });
});
