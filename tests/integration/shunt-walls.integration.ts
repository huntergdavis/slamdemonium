import { createRequire } from 'node:module';
import { InstancedMesh, MeshStandardMaterial, Scene } from 'three';
import { expect, it } from 'vitest';
import type { RayHit } from '../../src/physics/adapter';
import { createPhysicsWorld } from '../../src/physics/joltWorld';
import { poseAt } from '../../src/world/roadGenerator';
import {
  createShuntWallVisual,
  installShuntWalls,
} from '../../src/world/shuntWalls';
import { createSurfaceRegistry } from '../../src/world/surfaceRegistry';
import { createSurfacedBodies } from '../../src/world/surfacedBodies';
import { createTakedownMap } from '../../src/world/takedownCourse';
import { createCityMap } from '../../src/world/cityCourse';

const wasmPath = createRequire(import.meta.url).resolve(
  'jolt-physics/jolt-physics.wasm.wasm',
);

it('covers over 90% of both roadsides with visible solid walls and clear run-offs', async () => {
  const map = createTakedownMap();
  const world = await createPhysicsWorld({ wasmPath });
  const bodies = createSurfacedBodies(world, createSurfaceRegistry());
  const scene = new Scene();
  const material = new MeshStandardMaterial();
  const visual = createShuntWallVisual(scene, material, map.shuntWalls!);
  try {
    const ids = installShuntWalls(bodies, map.shuntWalls!);
    const hit: RayHit = {
      distance: 0,
      point: { x: 0, y: 0, z: 0 },
      normal: { x: 0, y: 0, z: 0 },
      bodyId: 0,
      surfaceId: 0,
    };
    const seesWall = (station: number, side: -1 | 1): boolean => {
      const pose = poseAt(map.path!, station);
      const found = world.rayCast(
        { x: pose.x, y: 1.1, z: pose.z },
        {
          x: -Math.cos(pose.heading) * side,
          y: 0,
          z: Math.sin(pose.heading) * side,
        },
        20,
        hit,
      );
      if (found) {
        expect(ids).toContain(hit.bodyId);
        // The 28 m road stays entirely clear, including on the inside of
        // every sweeper and at the joins between adjacent static boxes.
        expect(hit.distance).toBeGreaterThan(14);
      }
      return found;
    };
    for (const side of [-1, 1] as const) {
      let covered = 0;
      let sampled = 0;
      for (let station = 0; station < map.path!.length; station += 10) {
        if (seesWall(station, side)) covered++;
        sampled++;
      }
      expect(covered / sampled).toBeGreaterThan(0.9);
      expect(seesWall(340, side)).toBe(true);
      expect(seesWall(90, side)).toBe(false); // spawn run-off
    }
    const batch = visual.root.getObjectByName('shunt-walls.concrete');
    expect(batch).toBeInstanceOf(InstancedMesh);
    expect((batch as InstancedMesh).count).toBe(map.shuntWalls!.length);
  } finally {
    visual.dispose();
    material.dispose();
    bodies.dispose();
    world.dispose();
  }
}, 60_000);

it('leaves the city junction open but stops a car shunted into its roadside walls', async () => {
  const map = createCityMap();
  const world = await createPhysicsWorld({ wasmPath });
  const bodies = createSurfacedBodies(world, createSurfaceRegistry());
  try {
    world.setGravity(0);
    const wallIds = installShuntWalls(bodies, map.shuntWalls!);
    const hit: RayHit = {
      distance: 0,
      point: { x: 0, y: 0, z: 0 },
      normal: { x: 0, y: 0, z: 0 },
      bodyId: 0,
      surfaceId: 0,
    };
    for (const z of [-110, -70, 70, 110]) {
      for (const side of [-1, 1]) {
        expect(
          world.rayCast(
            { x: 275, y: 1.1, z },
            { x: side, y: 0, z: 0 },
            20,
            hit,
          ),
        ).toBe(true);
        expect(wallIds).toContain(hit.bodyId);
        expect(hit.distance).toBeGreaterThan(12);
      }
    }
    expect(
      world.rayCast({ x: 275, y: 1.1, z: 0 }, { x: 1, y: 0, z: 0 }, 20, hit),
    ).toBe(false);
    const car = world.createDynamicBox({
      center: { x: 275, y: 1.1, z: 70 },
      halfExtents: { x: 1.08, y: 0.65, z: 2.4 },
      mass: 1300,
      comOffset: { x: 0, y: 0, z: 0 },
      inertiaScale: { x: 1, y: 1, z: 1 },
      friction: 0.2,
      restitution: 0,
      ccd: true,
      maxAngularVelocity: 12,
      angularDamping: 0,
    });
    let wallContacts = 0;
    world.onContact((a, b) => {
      if (
        (a === car && wallIds.includes(b)) ||
        (b === car && wallIds.includes(a))
      )
        wallContacts++;
    });
    world.setLinearVelocity(car, { x: 35, y: 0, z: 0 });
    for (let step = 0; step < 120; step++) world.step(1 / 120);
    const position = { x: 0, y: 0, z: 0 };
    world.getTransform(car, position, { x: 0, y: 0, z: 0, w: 1 });
    expect(wallContacts).toBeGreaterThan(0);
    expect(position.x - 275).toBeGreaterThan(9);
    expect(position.x - 275).toBeLessThan(15);
  } finally {
    bodies.dispose();
    world.dispose();
  }
}, 60_000);

it('stops a moving car-size body at the authored roadside collider', async () => {
  const map = createTakedownMap();
  const world = await createPhysicsWorld({ wasmPath });
  const bodies = createSurfacedBodies(world, createSurfaceRegistry());
  try {
    world.setGravity(0);
    const wallIds = installShuntWalls(bodies, map.shuntWalls!);
    const road = poseAt(map.path!, 340);
    const side = -1;
    const outward = {
      x: -Math.cos(road.heading) * side,
      z: Math.sin(road.heading) * side,
    };
    const car = world.createDynamicBox({
      center: { x: road.x, y: 1.1, z: road.z },
      halfExtents: { x: 1.08, y: 0.65, z: 2.4 },
      mass: 1300,
      comOffset: { x: 0, y: 0, z: 0 },
      inertiaScale: { x: 1, y: 1, z: 1 },
      friction: 0.2,
      restitution: 0,
      ccd: true,
      maxAngularVelocity: 12,
      angularDamping: 0,
    });
    let wallContacts = 0;
    world.onContact((a, b) => {
      if (
        (a === car && wallIds.includes(b)) ||
        (b === car && wallIds.includes(a))
      )
        wallContacts++;
    });
    world.setLinearVelocity(car, {
      x: outward.x * 35,
      y: 0,
      z: outward.z * 35,
    });
    for (let step = 0; step < 120; step++) world.step(1 / 120);
    const position = { x: 0, y: 0, z: 0 };
    world.getTransform(car, position, { x: 0, y: 0, z: 0, w: 1 });
    const travel =
      (position.x - road.x) * outward.x + (position.z - road.z) * outward.z;
    expect(wallContacts).toBeGreaterThan(0);
    expect(travel).toBeGreaterThan(10);
    expect(travel).toBeLessThan(18); // 35 m without the solid roadside wall.
  } finally {
    bodies.dispose();
    world.dispose();
  }
}, 60_000);
