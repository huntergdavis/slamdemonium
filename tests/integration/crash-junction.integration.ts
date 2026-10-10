import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
import { CrashMode } from '../../src/core/crashMode';
import { createPhysicsWorld } from '../../src/physics/joltWorld';
import { createCrashJunctionMap } from '../../src/world/crashJunction';
import { createSurfaceRegistry } from '../../src/world/surfaceRegistry';
import { createSurfacedBodies } from '../../src/world/surfacedBodies';
import { createTraffic, MAX_DRIVING } from '../../src/world/traffic';

const wasmPath = createRequire(import.meta.url).resolve(
  'jolt-physics/jolt-physics.wasm.wasm',
);
const DT = 1 / 120;

it('makes the twelve-car Crash Junction stream physical and replays the authored seed on retry', async () => {
  const map = createCrashJunctionMap('south');
  const world = await createPhysicsWorld({ wasmPath });
  world.setGravity(20);
  world.createStaticBox({ x: 0, y: -0.5, z: 0 }, { x: 1200, y: 0.5, z: 1200 });
  const bodies = createSurfacedBodies(world, createSurfaceRegistry());
  const traffic = createTraffic(world, bodies, map.path!, map.traffic!, {
    density: 1,
    minGap: 12,
    maxGap: 12,
  });
  const score = new CrashMode();
  const player = { x: 275, y: 1, z: 0 };
  const start = { x: map.spawn!.x, y: 1, z: map.spawn!.z };
  const hit = {
    approachSpeed: 28,
    energy: 430000,
    severity: 1,
    estimated: true,
  };
  try {
    score.step(3);
    let ambientWrecks = 0;
    for (let step = 0; step < 6 * 120; step++) {
      traffic.preStep(DT, start, 0);
      world.step(DT);
      traffic.postStep();
      ambientWrecks += traffic.newlyWrecked.length;
    }
    expect(ambientWrecks).toBe(0);
    for (let step = 0; step < 4 * 120; step++) {
      traffic.preStep(DT, player, 35);
      world.step(DT);
      traffic.postStep();
    }
    const physical = traffic.states.filter((car) => car.bodyId > 0);
    expect(physical.length).toBeLessThanOrEqual(MAX_DRIVING);
    expect(physical.length).toBeGreaterThanOrEqual(10);
    expect(
      traffic.states.every(
        (car) =>
          Math.hypot(car.position.x - player.x, car.position.z - player.z) >
            100 || car.bodyId > 0,
      ),
    ).toBe(true);
    expect(traffic.activeCount).toBe(12);
    const first = physical.find((car) => !car.wrecked)!;
    score.notePlayerContact(first.id);
    traffic.onPlayerContact(first.bodyId, hit);
    expect(first.wrecked).toBe(true);
    expect(traffic.newlyWrecked).toContain(first);
    for (const car of traffic.newlyWrecked)
      score.noteWreck({ id: car.id, modelKind: car.modelKind });
    expect(score.state.damage).toBeGreaterThanOrEqual(500);
    const oldIds = new Set(traffic.states.map((car) => car.id));
    traffic.resetForEvent();
    score.reset();
    traffic.preStep(DT, player, 0);
    world.step(DT);
    traffic.postStep();
    expect(score.state.damage).toBe(0);
    expect(traffic.states).toHaveLength(12);
    expect(
      traffic.states.every((car) => !car.wrecked && !oldIds.has(car.id)),
    ).toBe(true);
    expect(traffic.states.map((car) => car.modelKind)).toEqual(
      map.traffic!.map((car) => car.modelKind),
    );
  } finally {
    traffic.dispose();
    bodies.dispose();
    world.dispose();
  }
}, 60_000);
