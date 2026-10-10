import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
import { createPhysicsWorld } from '../../src/physics/joltWorld';
import type { RayHit } from '../../src/physics/adapter';
import {
  HIGHWAY_EXPRESS_MAP,
  HIGHWAY_EXPRESS_PATH,
  HIGHWAY_INTERCHANGE_MAP,
  HIGHWAY_INTERCHANGE_PATH,
} from '../../src/world/highwayCourse';
import { poseAt } from '../../src/world/roadGenerator';
import { installTrackColliders } from '../../src/world/trackPhysics';
import { resolveTrackConfig } from '../../src/world/trackConfig';
import { scriptVehicleHarness } from '../scriptVehicleHarness';
import { createTraffic } from '../../src/world/traffic';
import { createSurfacedBodies } from '../../src/world/surfacedBodies';
import { createSurfaceRegistry } from '../../src/world/surfaceRegistry';

const wasmPath = createRequire(import.meta.url).resolve(
  'jolt-physics/jolt-physics.wasm.wasm',
);

it.each([HIGHWAY_EXPRESS_MAP, HIGHWAY_INTERCHANGE_MAP])(
  'keeps the opening %s traffic stream intact while the player is parked',
  async (map) => {
    const world = await createPhysicsWorld({ wasmPath });
    world.setGravity(20);
    world.createStaticBox(
      { x: 0, y: -0.5, z: 0 },
      { x: 3200, y: 0.5, z: 3200 },
    );
    const bodies = createSurfacedBodies(world, createSurfaceRegistry());
    const traffic = createTraffic(world, bodies, map.path!, map.traffic!, {
      density: 0.85,
      minGap: 12,
      maxGap: 36,
    });
    world.onContact((a, b, _impulse, _point, normal, velocities) => {
      traffic.onWorldContact(a, b, normal, velocities);
    });
    try {
      const player = { x: map.spawn!.x, y: 1, z: map.spawn!.z };
      const wrecked = new Set<number>();
      for (let step = 0; step < 20 * 120; step++) {
        traffic.preStep(1 / 120, player);
        world.step(1 / 120);
        traffic.postStep();
        for (const car of traffic.states) if (car.wrecked) wrecked.add(car.id);
      }
      expect([...wrecked], 'ambient traffic wrecks near spawn').toEqual([]);
    } finally {
      traffic.dispose();
      bodies.dispose();
      world.dispose();
    }
  },
  60_000,
);

it('brings intact physical contraflow to the interchange during a natural approach', async () => {
  const map = HIGHWAY_INTERCHANGE_MAP;
  const world = await createPhysicsWorld({ wasmPath });
  world.setGravity(20);
  world.createStaticBox({ x: 0, y: -0.5, z: 0 }, { x: 3200, y: 0.5, z: 3200 });
  const bodies = createSurfacedBodies(world, createSurfaceRegistry());
  const traffic = createTraffic(world, bodies, map.path!, map.traffic!, {
    density: 0.85,
    minGap: 12,
    maxGap: 36,
  });
  world.onContact((a, b, _impulse, _point, normal, velocities) => {
    traffic.onWorldContact(a, b, normal, velocities);
  });
  try {
    let physicalOpposing = 0;
    const wrecked = new Set<number>();
    for (let step = 0; step < 57 * 120; step++) {
      const station =
        (map.path!.length - 48 + (step * 35) / 120) % map.path!.length;
      const pose = poseAt(map.path!, station);
      traffic.preStep(1 / 120, { x: pose.x, y: 1, z: pose.z }, 35);
      world.step(1 / 120);
      traffic.postStep();
      for (const car of traffic.states) {
        if (car.wrecked) wrecked.add(car.id);
        if (step >= 48 * 120 && car.direction === -1 && car.bodyId > 0)
          physicalOpposing++;
      }
    }
    expect([...wrecked], 'ambient wrecks during interchange approach').toEqual(
      [],
    );
    expect(physicalOpposing).toBeGreaterThan(0);
  } finally {
    traffic.dispose();
    bodies.dispose();
    world.dispose();
  }
}, 90_000);

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
