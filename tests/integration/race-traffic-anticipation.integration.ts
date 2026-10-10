import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
import { createPhysicsWorld } from '../../src/physics/joltWorld';
import { sampleRoad } from '../../src/world/roadGenerator';
import { createSurfaceRegistry } from '../../src/world/surfaceRegistry';
import { createSurfacedBodies } from '../../src/world/surfacedBodies';
import { createTraffic } from '../../src/world/traffic';

const wasmPath = createRequire(import.meta.url).resolve(
  'jolt-physics/jolt-physics.wasm.wasm',
);
const path = sampleRoad([{ kind: 'straight', length: 1000 }], {
  x: 0,
  z: 0,
  heading: 0,
});

it('brakes a physical racer for a slower visual-only car before its collider arrives', async () => {
  const world = await createPhysicsWorld({ wasmPath });
  world.setGravity(20);
  world.createStaticBox({ x: 0, y: -0.5, z: -500 }, { x: 100, y: 0.5, z: 600 });
  const bodies = createSurfacedBodies(world, createSurfaceRegistry());
  const traffic = createTraffic(world, bodies, path, [
    {
      station: 130,
      laneSide: -1,
      laneOffset: 0,
      speed: 20,
      modelKind: 'sedan',
    },
    {
      station: 0,
      laneSide: -1,
      laneOffset: 0,
      speed: 50,
      rival: true,
      raceEntrant: true,
      modelKind: 'hatch',
    },
  ]);
  const player = { x: 10, y: 1, z: 50 };
  try {
    traffic.setRaceRunning(true);
    traffic.preStep(1 / 120, player, 42);
    const civilian = traffic.states.find((car) => !car.rival)!;
    const racer = traffic.raceStates[0]!;
    for (let step = 0; step < 300; step++) {
      traffic.preStep(1 / 120, player, 42);
      world.step(1 / 120);
      traffic.postStep();
    }
    expect(civilian.bodyId).toBe(-1);
    expect(racer.bodyId).toBeGreaterThan(0);
    expect(racer.speed).toBeLessThan(49);
    expect(racer.wrecked).toBe(false);
    player.z = -100;
    for (let step = 0; step < 120; step++) {
      traffic.preStep(1 / 120, player, 42);
      world.step(1 / 120);
      traffic.postStep();
    }
    expect(civilian.bodyId).toBeGreaterThan(0);
    expect(civilian.wrecked).toBe(false);
    expect(racer.wrecked).toBe(false);
  } finally {
    traffic.dispose();
    bodies.dispose();
    world.dispose();
  }
});

it('delays an overlapping body promotion until the physical car moves clear', async () => {
  const world = await createPhysicsWorld({ wasmPath });
  world.setGravity(20);
  world.createStaticBox({ x: 0, y: -0.5, z: -250 }, { x: 100, y: 0.5, z: 300 });
  const bodies = createSurfacedBodies(world, createSurfaceRegistry());
  const traffic = createTraffic(world, bodies, path, [
    {
      station: 30,
      laneSide: -1,
      laneOffset: 0,
      speed: 50,
      rival: true,
      raceEntrant: true,
    },
    {
      station: 30,
      laneSide: -1,
      laneOffset: 0,
      speed: 20,
      rival: true,
      raceEntrant: true,
    },
  ]);
  const player = { x: 10, y: 1, z: -30 };
  try {
    traffic.preStep(1 / 120, player, 0);
    const [first, second] = traffic.raceStates;
    expect(first!.bodyId).toBeGreaterThan(0);
    expect(second!.bodyId).toBe(-1);
    traffic.setRaceRunning(true);
    for (let step = 0; step < 300; step++) {
      traffic.preStep(1 / 120, player, 42);
      world.step(1 / 120);
      traffic.postStep();
    }
    expect(second!.bodyId).toBeGreaterThan(0);
    expect(first!.wrecked).toBe(false);
    expect(second!.wrecked).toBe(false);
  } finally {
    traffic.dispose();
    bodies.dispose();
    world.dispose();
  }
});
