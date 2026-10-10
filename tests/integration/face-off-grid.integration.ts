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

it('holds one physical rival beside the player and resets the grid without contact', async () => {
  const world = await createPhysicsWorld({ wasmPath });
  world.setGravity(20);
  const map = MAPS['face-off'];
  const spawn = map.spawn!;
  world.createStaticBox({ x: 0, y: -0.5, z: 0 }, { x: 3200, y: 0.5, z: 3200 });
  const player = world.createStaticBox(
    { x: spawn.x, y: 0.65, z: spawn.z },
    { x: 1.08, y: 0.65, z: 2.4 },
  );
  const bodies = createSurfacedBodies(world, createSurfaceRegistry());
  const traffic = createTraffic(world, bodies, map.path!, map.traffic!, {
    density: 0.85,
    minGap: 12,
    maxGap: 36,
  });
  let contacts = 0;
  world.onContact((a, b) => {
    if (
      (a === player && traffic.stateForBody(b)?.raceEntrant) ||
      (b === player && traffic.stateForBody(a)?.raceEntrant)
    )
      contacts++;
  });
  try {
    expect(traffic.raceStates).toHaveLength(1);
    for (let step = 0; step < 120; step++) {
      traffic.preStep(1 / 120, { x: spawn.x, y: 1, z: spawn.z }, 0);
      world.step(1 / 120);
      traffic.postStep();
    }
    expect(traffic.raceStates[0]!.bodyId).toBeGreaterThan(0);
    expect(traffic.raceStates[0]!.speed).toBeLessThan(1);
    expect(contacts).toBe(0);
    traffic.setRaceRunning(true);
    for (let step = 0; step < 240; step++) {
      traffic.preStep(1 / 120, { x: spawn.x, y: 1, z: spawn.z }, 0);
      world.step(1 / 120);
      traffic.postStep();
    }
    expect(traffic.raceStates[0]!.speed).toBeGreaterThan(5);
    traffic.resetRaceGrid();
    expect(traffic.raceStates[0]!.speed).toBe(0);
    expect(traffic.raceStates[0]!.wrecked).toBe(false);
  } finally {
    traffic.dispose();
    bodies.dispose();
    world.dispose();
  }
}, 30_000);
