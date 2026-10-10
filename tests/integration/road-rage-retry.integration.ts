import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
import { createPhysicsWorld } from '../../src/physics/joltWorld';
import { createSurfaceRegistry } from '../../src/world/surfaceRegistry';
import { createSurfacedBodies } from '../../src/world/surfacedBodies';
import { createTakedownMap } from '../../src/world/takedownCourse';
import { poseAt } from '../../src/world/roadGenerator';
import { createTraffic } from '../../src/world/traffic';

const wasmPath = createRequire(import.meta.url).resolve(
  'jolt-physics/jolt-physics.wasm.wasm',
);
const DT = 1 / 120;

it('retry restores intact reachable rivals without allocating new Jolt bodies', async () => {
  const world = await createPhysicsWorld({ wasmPath });
  const bodies = createSurfacedBodies(world, createSurfaceRegistry());
  const map = createTakedownMap();
  const traffic = createTraffic(world, bodies, map.path!, map.traffic!, {
    density: 0.85,
    minGap: 12,
    maxGap: 36,
  });
  const player = { x: map.spawn!.x, y: 1, z: map.spawn!.z };
  try {
    const stats = { heapBytes: 0, freeBytes: 0 };
    let warmFreeBytes = 0;
    const seen = new Set<number>();
    for (let run = 0; run < 3; run++) {
      traffic.preStep(DT, player, 0);
      world.step(DT);
      traffic.postStep();
      const rivals = traffic.states.filter((car) => car.rival);
      expect(rivals.length).toBe(4);
      expect(rivals.every((car) => !car.wrecked)).toBe(true);
      expect(rivals.some((car) => car.bodyId > 0)).toBe(true);
      for (const car of rivals) {
        expect(seen.has(car.id)).toBe(false);
        seen.add(car.id);
      }
      if (run === 0) {
        const victim = rivals.find((car) => car.bodyId > 0)!;
        traffic.onPlayerContact(
          victim.bodyId,
          { approachSpeed: 30, energy: 585000, severity: 1, estimated: true },
          { x: 0, y: 0, z: 1 },
          { x: 0, y: 0, z: -30 },
        );
        expect(victim.wrecked).toBe(true);
        expect(traffic.newlyWrecked).toContain(victim);
      }
      traffic.resetForEvent();
      expect(traffic.newlyWrecked).toHaveLength(0);
      expect(traffic.states).toHaveLength(0);
      world.getMemoryStats(stats);
      if (run === 1) warmFreeBytes = stats.freeBytes;
      if (run === 2) expect(stats.freeBytes).toBe(warmFreeBytes);
    }
  } finally {
    traffic.dispose();
    bodies.dispose();
    world.dispose();
  }
}, 120_000);

it('keeps at least three rivals reachable for a full 180-second run', async () => {
  const world = await createPhysicsWorld({ wasmPath });
  const bodies = createSurfacedBodies(world, createSurfaceRegistry());
  const map = createTakedownMap();
  const path = map.path!;
  const traffic = createTraffic(world, bodies, path, map.traffic!, {
    density: 0.85,
    minGap: 12,
    maxGap: 36,
  });
  const player = { x: 0, y: 1, z: 0 };
  const dt = 1 / 60;
  let minReachable = 4;
  try {
    for (let step = 0; step < 180 * 60; step++) {
      const station =
        (((step * dt * 35) % path.length) + path.length) % path.length;
      const pose = poseAt(path, station);
      player.x = pose.x;
      player.z = pose.z;
      traffic.preStep(dt, player, 35);
      world.step(dt);
      traffic.postStep();
      if (step > 0 && step % 600 === 0) {
        const reachable = traffic.states.filter(
          (car) =>
            car.rival &&
            !car.wrecked &&
            Math.hypot(car.x - player.x, car.z - player.z) < 180,
        ).length;
        minReachable = Math.min(minReachable, reachable);
      }
    }
    expect(minReachable).toBeGreaterThanOrEqual(3);
  } finally {
    traffic.dispose();
    bodies.dispose();
    world.dispose();
  }
}, 120_000);
