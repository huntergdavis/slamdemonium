import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
import { createPhysicsWorld } from '../../src/physics/joltWorld';
import { createSurfaceRegistry } from '../../src/world/surfaceRegistry';
import { createSurfacedBodies } from '../../src/world/surfacedBodies';
import { createTraffic } from '../../src/world/traffic';
import { MAPS } from '../../src/world/maps';

const wasmPath = createRequire(import.meta.url).resolve(
  'jolt-physics/jolt-physics.wasm.wasm',
);

it('holds a physical six-car grid, releases at GO and restores it on retry', async () => {
  const world = await createPhysicsWorld({ wasmPath });
  world.setGravity(20);
  const map = MAPS['circuit-race'];
  const spawn = map.spawn!;
  world.createStaticBox(
    { x: spawn.x, y: -0.5, z: spawn.z },
    { x: 300, y: 0.5, z: 300 },
  );
  const player = world.createStaticBox(
    { x: spawn.x, y: 0.65, z: spawn.z },
    { x: 1.08, y: 0.65, z: 2.4 },
  );
  const bodies = createSurfacedBodies(world, createSurfaceRegistry());
  const traffic = createTraffic(world, bodies, map.path!, map.traffic!, {
    density: 0.7,
    minGap: 12,
    maxGap: 36,
  });
  const playerPose = { x: spawn.x, y: 1, z: spawn.z };
  let gridContacts = 0;
  world.onContact((a, b) => {
    if (
      (a === player && traffic.stateForBody(b)?.raceEntrant) ||
      (b === player && traffic.stateForBody(a)?.raceEntrant)
    )
      gridContacts++;
  });
  try {
    const ids = traffic.raceStates.map((car) => car.id);
    expect(new Set(ids).size).toBe(5);
    for (let step = 0; step < 120; step++) {
      traffic.preStep(1 / 120, playerPose, 0);
      world.step(1 / 120);
      traffic.postStep();
    }
    expect(traffic.raceStates.every((car) => car.bodyId > 0)).toBe(true);
    expect(traffic.raceStates.every((car) => car.speed < 1)).toBe(true);
    expect(gridContacts).toBe(0);

    traffic.setRaceRunning(true);
    for (let step = 0; step < 240; step++) {
      traffic.preStep(1 / 120, playerPose, 35);
      world.step(1 / 120);
      traffic.postStep();
    }
    expect(traffic.raceStates.some((car) => car.speed > 15)).toBe(true);
    traffic.resetRaceGrid();
    expect(traffic.raceStates.map((car) => car.id)).toEqual(ids);
    expect(traffic.raceStates.every((car) => car.speed === 0)).toBe(true);
    traffic.preStep(1 / 120, playerPose, 0);
    world.step(1 / 120);
    traffic.postStep();
    expect(traffic.raceStates.every((car) => car.bodyId > 0)).toBe(true);
    expect(gridContacts).toBe(0);
  } finally {
    traffic.dispose();
    bodies.dispose();
    world.dispose();
  }
}, 60_000);
