import { createRequire } from 'node:module';
import { afterEach, expect, it } from 'vitest';
import type { IPhysicsWorld } from '../../src/physics/adapter';
import { createPhysicsWorld } from '../../src/physics/joltWorld';
import { sampleRoad } from '../../src/world/roadGenerator';
import { createTraffic } from '../../src/world/traffic';

const wasmPath = createRequire(import.meta.url).resolve(
  'jolt-physics/jolt-physics.wasm.wasm',
);
const worlds: IPhysicsWorld[] = [];
afterEach(() => {
  for (const world of worlds) world.dispose();
  worlds.length = 0;
});

it('drives a pooled car, yields on a real impact, and preserves wrecks with new encounter ids', async () => {
  const world = await createPhysicsWorld({ wasmPath });
  worlds.push(world);
  world.setGravity(20);
  world.createStaticBox({ x: 0, y: -0.5, z: -250 }, { x: 300, y: 0.5, z: 400 });
  const path = sampleRoad([{ kind: 'straight', length: 500 }], {
    x: 0,
    z: 0,
    heading: 0,
  });
  const traffic = createTraffic(world, path, [
    { station: 140, laneSide: -1, speed: 19 },
  ]);
  const player = { x: 3.5, y: 0.6, z: -100 };
  traffic.preStep(1 / 120, player);
  expect(traffic.states).toHaveLength(1);
  const first = traffic.states[0]!;
  const firstEncounterId = first.id;
  expect(world.isBodyActive(first.bodyId)).toBe(true);
  const identity = traffic.states;

  for (let i = 0; i < 100; i++) {
    traffic.preStep(1 / 120, player);
    world.step(1 / 120);
    traffic.postStep();
  }
  expect(traffic.states).toBe(identity);
  expect(first.position.z).toBeLessThan(-145);
  expect(first.speed).toBeGreaterThan(10);
  expect(first.wrecked).toBe(false);

  const car = world.createDynamicBox({
    center: { x: first.position.x, y: 0.6, z: first.position.z + 14 },
    halfExtents: { x: 0.9, y: 0.5, z: 2 },
    mass: 1300,
    comOffset: { x: 0, y: 0, z: 0 },
    inertiaScale: { x: 1, y: 1, z: 1 },
    friction: 0,
    restitution: 0,
    ccd: true,
    maxAngularVelocity: 12,
    angularDamping: 0,
  });
  world.setLinearVelocity(car, { x: 0, y: 0, z: -50 });
  let contacts = 0;
  const impact = {
    approachSpeed: 30,
    energy: 585000,
    severity: 1,
    estimated: true,
  };
  world.onContact((a, b) => {
    if (
      (a === car && b === first.bodyId) ||
      (b === car && a === first.bodyId)
    ) {
      contacts++;
      traffic.onPlayerContact(first.bodyId, impact);
    }
  });
  for (let i = 0; i < 120 && !first.wrecked; i++) {
    traffic.preStep(1 / 120, player);
    world.step(1 / 120);
    traffic.postStep();
  }
  expect(contacts).toBeGreaterThan(0);
  expect(first.wrecked).toBe(true);
  traffic.preStep(1 / 120, player);
  expect(world.isBodyAwake(first.bodyId)).toBe(true);
  const wreckZ = first.position.z;
  player.x = 1000;
  player.z = 1000;
  traffic.preStep(1 / 120, player);
  expect(traffic.states).toHaveLength(0);
  expect(world.isBodyActive(first.bodyId)).toBe(false);

  player.x = first.position.x;
  player.z = wreckZ;
  traffic.preStep(1 / 120, player);
  expect(traffic.states).toHaveLength(1);
  expect(traffic.states[0]!.id).toBeGreaterThan(firstEncounterId);
  expect(traffic.states[0]!.bodyId).toBe(first.bodyId);
  expect(traffic.states[0]!.wrecked).toBe(true);
  traffic.dispose();
});
