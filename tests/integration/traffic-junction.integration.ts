import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
import { createPhysicsWorld } from '../../src/physics/joltWorld';
import { sampleRoad } from '../../src/world/roadGenerator';
import { createSurfacedBodies } from '../../src/world/surfacedBodies';
import { createSurfaceRegistry } from '../../src/world/surfaceRegistry';
import { createTraffic } from '../../src/world/traffic';

const wasmPath = createRequire(import.meta.url).resolve(
  'jolt-physics/jolt-physics.wasm.wasm',
);
const DT = 1 / 120;

it('gives a crossing car a green gap after the arterial car passes', async () => {
  const world = await createPhysicsWorld({ wasmPath });
  world.setGravity(20);
  world.createStaticBox({ x: 0, y: -0.5, z: 0 }, { x: 500, y: 0.5, z: 500 });
  const bodies = createSurfacedBodies(world, createSurfaceRegistry());
  const junction = [{ x: -3.5, z: 3.5 }];
  const arterialPath = sampleRoad([{ kind: 'straight', length: 800 }], {
    x: 0,
    z: -400,
    heading: Math.PI,
  });
  const crossPath = sampleRoad([{ kind: 'straight', length: 800 }], {
    x: -400,
    z: 0,
    heading: -Math.PI / 2,
  });
  const arterial = createTraffic(world, bodies, arterialPath, [
    {
      station: 300,
      laneSide: -1,
      speed: 25,
      signalStream: 'arterial',
      signalJunctions: junction,
    },
  ]);
  const cross = createTraffic(world, bodies, crossPath, [
    {
      station: 300,
      laneSide: -1,
      speed: 22,
      signalStream: 'cross',
      signalJunctions: junction,
    },
  ]);
  world.onContact((a, b, _impulse, _point, normal, velocities) => {
    arterial.onWorldContact(a, b, normal, velocities);
    cross.onWorldContact(a, b, normal, velocities);
  });
  try {
    const player = { x: junction[0]!.x, y: 1, z: junction[0]!.z };
    let crossPaused = false;
    let crossPassed = false;
    let arterialPassed = false;
    for (let step = 0; step < 20 * 120; step++) {
      arterial.preStep(DT, player);
      cross.preStep(DT, player);
      world.step(DT);
      arterial.postStep();
      cross.postStep();
      const main = arterial.states[0]!;
      const side = cross.states[0]!;
      if (side.position.x > -35 && side.position.x < junction[0]!.x)
        crossPaused ||= side.speed < 3;
      arterialPassed ||= main.position.z > junction[0]!.z + 10;
      crossPassed ||= side.position.x > junction[0]!.x + 10;
      expect(main.wrecked).toBe(false);
      expect(side.wrecked).toBe(false);
    }
    expect(crossPaused, 'cross car must yield on red').toBe(true);
    expect(arterialPassed).toBe(true);
    expect(crossPassed, 'cross car must clear during the all-red gap').toBe(
      true,
    );
  } finally {
    cross.dispose();
    arterial.dispose();
    bodies.dispose();
    world.dispose();
  }
}, 45_000);
