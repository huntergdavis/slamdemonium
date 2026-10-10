import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
import { createPhysicsWorld } from '../../src/physics/joltWorld';
import type { RayHit } from '../../src/physics/adapter';
import {
  COAST_HEAD_PATH,
  COAST_SHORE_PATH,
  COAST_HEADLAND_MAP,
} from '../../src/world/coastCourse';
import { poseAt } from '../../src/world/roadGenerator';
import { installTrackColliders } from '../../src/world/trackPhysics';
import { resolveTrackConfig } from '../../src/world/trackConfig';

const wasmPath = createRequire(import.meta.url).resolve(
  'jolt-physics/jolt-physics.wasm.wasm',
);

it('keeps both coast roads grounded through the fork and rejoin', async () => {
  const world = await createPhysicsWorld({ wasmPath });
  const { ground } = installTrackColliders(
    world,
    resolveTrackConfig(COAST_HEADLAND_MAP.track),
    [],
  );
  const hit: RayHit = {
    distance: 0,
    point: { x: 0, y: 0, z: 0 },
    normal: { x: 0, y: 0, z: 0 },
    bodyId: 0,
    surfaceId: 0,
  };
  try {
    for (const path of [COAST_SHORE_PATH, COAST_HEAD_PATH])
      for (const station of [
        0,
        450,
        500,
        550,
        1100,
        1700,
        path.length - 750,
        path.length - 700,
        path.length - 650,
        path.length,
      ]) {
        const pose = poseAt(path, station);
        expect(
          world.rayCast(
            { x: pose.x, y: 3, z: pose.z },
            { x: 0, y: -1, z: 0 },
            6,
            hit,
          ),
          `${station} m on coast road`,
        ).toBe(true);
        expect(hit.bodyId).toBe(ground);
        expect(hit.point.y).toBeCloseTo(0, 2);
      }
  } finally {
    world.dispose();
  }
}, 30_000);
