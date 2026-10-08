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

async function drive(rival: boolean) {
  const world = await createPhysicsWorld({ wasmPath });
  world.setGravity(20);
  world.createStaticBox({ x: 0, y: -0.5, z: 250 }, { x: 200, y: 0.5, z: 400 });
  const bodies = createSurfacedBodies(world, createSurfaceRegistry());
  const path = sampleRoad([{ kind: 'straight', length: 500 }], {
    x: 0,
    z: 0,
    heading: Math.PI,
  });
  const traffic = createTraffic(world, bodies, path, [
    { station: 100, laneSide: -1, speed: 35, modelKind: 'sedan', rival },
  ]);
  try {
    const player = { x: -10, y: 1, z: 100 };
    let nearest = Infinity;
    for (let i = 0; i < 120; i++) {
      const car = traffic.states[0];
      if (car) player.z = car.position.z;
      traffic.preStep(1 / 120, player);
      world.step(1 / 120);
      traffic.postStep();
      nearest = Math.min(nearest, traffic.states[0]!.position.x);
    }
    return {
      nearest,
      speed: traffic.states[0]!.speed,
      state: traffic.states[0]!.rival,
    };
  } finally {
    traffic.dispose();
    bodies.dispose();
    world.dispose();
  }
}

it('lets a rival contest the line without changing an ordinary car', async () => {
  const rival = await drive(true);
  const ordinary = await drive(false);
  expect(rival.state).toBe(true);
  expect(ordinary.state).toBe(false);
  expect(rival.nearest).toBeLessThan(ordinary.nearest - 0.5);
  expect(rival.speed).toBeGreaterThan(25);
  expect(ordinary.speed).toBeGreaterThan(25);
}, 60_000);
