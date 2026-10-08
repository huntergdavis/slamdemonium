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

const wasmPath = createRequire(import.meta.url).resolve(
  'jolt-physics/jolt-physics.wasm.wasm',
);

it('puts solid shunt walls exactly where the visible roadside blocks stand', async () => {
  const map = createTakedownMap();
  const wall = map.shuntWalls![0]!;
  const world = await createPhysicsWorld({ wasmPath });
  const bodies = createSurfacedBodies(world, createSurfaceRegistry());
  const scene = new Scene();
  const material = new MeshStandardMaterial();
  const visual = createShuntWallVisual(scene, material, map.shuntWalls!);
  try {
    const ids = installShuntWalls(bodies, [wall]);
    const pose = poseAt(map.path!, 340);
    const dx = wall.center.x - pose.x;
    const dz = wall.center.z - pose.z;
    const span = Math.hypot(dx, dz);
    const hit: RayHit = {
      distance: 0,
      point: { x: 0, y: 0, z: 0 },
      normal: { x: 0, y: 0, z: 0 },
      bodyId: 0,
      surfaceId: 0,
    };
    expect(
      world.rayCast(
        { x: pose.x, y: wall.center.y, z: pose.z },
        { x: dx / span, y: 0, z: dz / span },
        30,
        hit,
      ),
    ).toBe(true);
    expect(hit.bodyId).toBe(ids[0]);
    expect(hit.distance).toBeGreaterThan(14);
    expect(hit.distance).toBeLessThan(17);
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
