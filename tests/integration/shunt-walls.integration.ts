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
