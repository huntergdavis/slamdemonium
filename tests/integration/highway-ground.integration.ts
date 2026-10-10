import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
import { createPhysicsWorld } from '../../src/physics/joltWorld';
import type { RayHit } from '../../src/physics/adapter';
import {
  HIGHWAY_EXPRESS_MAP,
  HIGHWAY_EXPRESS_PATH,
  HIGHWAY_INTERCHANGE_PATH,
} from '../../src/world/highwayCourse';
import { poseAt } from '../../src/world/roadGenerator';
import { installTrackColliders } from '../../src/world/trackPhysics';
import { resolveTrackConfig } from '../../src/world/trackConfig';
import { scriptVehicleHarness } from '../scriptVehicleHarness';

const wasmPath = createRequire(import.meta.url).resolve(
  'jolt-physics/jolt-physics.wasm.wasm',
);

it('supports the express bypass and interchange through the merge', async () => {
  const world = await createPhysicsWorld({ wasmPath });
  const { ground } = installTrackColliders(
    world,
    resolveTrackConfig(HIGHWAY_EXPRESS_MAP.track),
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
    for (const path of [HIGHWAY_EXPRESS_PATH, HIGHWAY_INTERCHANGE_PATH])
      for (const station of [
        650,
        700,
        750,
        1200,
        1750,
        1890,
        1920,
        2000,
        path.length - 25,
      ]) {
        const pose = poseAt(path, station);
        expect(
          world.rayCast(
            { x: pose.x, y: 3, z: pose.z },
            { x: 0, y: -1, z: 0 },
            6,
            hit,
          ),
        ).toBe(true);
        expect(hit.bodyId).toBe(ground);
        expect(hit.point.y).toBeCloseTo(0, 2);
      }
  } finally {
    world.dispose();
  }
}, 30_000);

it.each([35, 60, 85])(
  'drives the express merge cleanly at %i m/s',
  async (speed) => {
    const rig = await scriptVehicleHarness({ flatPlane: true });
    try {
      const { vehicle, world, loop, setPad } = rig;
      const start = poseAt(HIGHWAY_EXPRESS_PATH, 1750);
      vehicle.respawn(
        { x: start.x, y: 1, z: start.z },
        {
          x: 0,
          y: Math.sin(start.heading / 2),
          z: 0,
          w: Math.cos(start.heading / 2),
        },
      );
      world.setLinearVelocity(vehicle.body, {
        x: -Math.sin(start.heading) * speed,
        y: 0,
        z: -Math.cos(start.heading) * speed,
      });
      setPad({
        source: 'gamepad',
        throttle: 1,
        brake: 0,
        steer: 0,
        handbrake: false,
        boost: false,
      });
      let maxAirTime = 0;
      for (let step = 0; step < 10 * 120; step++) {
        loop.stepMany(1);
        maxAirTime = Math.max(maxAirTime, vehicle.telemetry.airTime);
        if (vehicle.telemetry.position.z > poseAt(HIGHWAY_EXPRESS_PATH, 2050).z)
          break;
      }
      expect(vehicle.telemetry.position.z).toBeGreaterThan(
        poseAt(HIGHWAY_EXPRESS_PATH, 2050).z,
      );
      expect(vehicle.telemetry.recoveryCount).toBe(0);
      expect(maxAirTime).toBeLessThan(0.2);
    } finally {
      rig.dispose();
    }
  },
  30_000,
);
