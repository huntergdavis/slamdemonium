import { Quaternion, Scene, Vector3 } from 'three';
import type { Material } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { SURFACE_IDS } from '../src/content/surfaces';
import type { IPhysicsWorld } from '../src/physics/adapter';
import {
  DEEP_HALF_PIPE_RADIUS,
  HALF_PIPE_EXIT_ANGLE,
  HALF_PIPE_RAIL,
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
  x: -150,
  z: 0,
  heading: -Math.PI / 2, // Axis along +X.
  radius: DEEP_HALF_PIPE_RADIUS,
  deck: 45,
  width: 16,
};

describe('half-pipe geometry', () => {
  it('is a spine: two 30 degree quarter-pipe walls symmetric about a deck at lip height, rails outside the lane', () => {
    expect(HALF_PIPE_EXIT_ANGLE).toBeCloseTo(Math.PI / 6, 12);
    expect(halfPipeLipHeight(pipe)).toBeCloseTo(
      40 * (1 - Math.cos(Math.PI / 6)),
      9,
    ); // 5.36 m
    expect(halfPipeWallRun(pipe)).toBeCloseTo(20, 9);
    expect(halfPipeHalfLength(pipe)).toBeCloseTo(42.5, 9);
    const slabs = halfPipeSlabDescriptors(pipe);
    const H = halfPipeLipHeight(pipe);
    const walls = slabs.filter(
      (s) => s.halfExtents.x === 8 && s.halfExtents.z < 2,
    );
    const deck = slabs.find(
      (s) => s.halfExtents.z > 20 && s.halfExtents.x === 8,
    )!;
    const rails = slabs.filter((s) => s.surface === SURFACE_IDS.concrete);
    expect(walls.length % 2).toBe(0);
    expect(walls.length).toBeGreaterThanOrEqual(24);
    expect(rails).toHaveLength(2);
    expect(slabs).toHaveLength(walls.length + 1 + 2);
    // Deck top surface at lip height, spanning the gap.
    expect(deck.center.y + HALF_PIPE_THICKNESS / 2).toBeCloseTo(H, 9);
    expect(deck.center.x).toBeCloseTo(pipe.x, 9);
    // Walls: each slab's normal points at its arc centre, which sits R above
    // the wall's ground edge; the two walls mirror about the deck centre.
    const up = new Vector3();
    for (const slab of walls) {
      const q = slab.rotation!;
      up.set(0, 1, 0).applyQuaternion(new Quaternion(q.x, q.y, q.z, q.w));
      const side = Math.sign(slab.center.x - pipe.x);
      const arcCentreX =
        pipe.x + side * (pipe.deck / 2 + halfPipeWallRun(pipe));
      const toCentre = new Vector3(
        arcCentreX - slab.center.x,
        pipe.radius - slab.center.y,
        0,
      ).normalize();
      expect(up.angleTo(toCentre)).toBeLessThan(0.02);
      expect(Math.abs(slab.center.z)).toBeLessThan(1e-9);
      expect(slab.surface).toBe(SURFACE_IDS.asphalt);
    }
    const xs = walls.map((s) => s.center.x - pipe.x).sort((a, b) => a - b);
    for (let i = 0; i < xs.length / 2; i++)
      expect(xs[i]!).toBeCloseTo(-xs[xs.length - 1 - i]!, 6);
    // Ground edge of each wall lies 42.5 m out; the lips at 22.5 m, 5.4 m up.
    const lowest = walls.reduce((a, b) => (a.center.y < b.center.y ? a : b));
    const highest = walls.reduce((a, b) => (a.center.y > b.center.y ? a : b));
    expect(Math.abs(lowest.center.x - pipe.x)).toBeGreaterThan(41);
    expect(Math.abs(highest.center.x - pipe.x)).toBeLessThan(24);
    expect(highest.center.y).toBeGreaterThan(H - 1);
    // Rails ride the deck edges just outside the 16 m lane.
    for (const rail of rails) {
      expect(Math.abs(rail.center.z)).toBeCloseTo(
        8 + HALF_PIPE_RAIL.width / 2,
        9,
      );
      expect(rail.center.y).toBeCloseTo(H + HALF_PIPE_RAIL.height / 2, 9);
      expect(rail.halfExtents.z).toBeCloseTo(pipe.deck / 2, 9);
    }
    // The footprint disc covers every slab centre.
    const fp = halfPipeFootprint(pipe);
    for (const slab of slabs)
      expect(
        Math.hypot(slab.center.x - fp.x, slab.center.z - fp.z),
      ).toBeLessThanOrEqual(fp.radius);
  });

  it('states the recipe: exit fixed at 30 degrees, radius floor 16, range v^2 sin 60 / g', () => {
    expect(MIN_HALF_PIPE_RADIUS).toBe(16);
    expect(DEEP_HALF_PIPE_RADIUS).toBe(40);
    expect(halfPipeRange(30, 14.7)).toBeCloseTo(
      (900 * Math.sin(Math.PI / 3)) / 14.7,
      9,
    ); // 53 m
    expect(halfPipeRange(30, 14.7)).toBeGreaterThan(pipe.deck); // A 30 m/s launch clears the deck.
    expect(halfPipeRange(25, 14.7)).toBeLessThan(
      pipe.deck + halfPipeWallRun(pipe),
    ); // And 25 still lands on the far wall or deck.
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
