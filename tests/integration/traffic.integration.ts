import { createRequire } from 'node:module';
import { afterEach, expect, it } from 'vitest';
import type { IPhysicsWorld } from '../../src/physics/adapter';
import { createPhysicsWorld } from '../../src/physics/joltWorld';
import { sampleRoad } from '../../src/world/roadGenerator';
import { createTraffic, MAX_DRIVING } from '../../src/world/traffic';
import { createSurfacedBodies } from '../../src/world/surfacedBodies';
import { createSurfaceRegistry } from '../../src/world/surfaceRegistry';

const wasmPath = createRequire(import.meta.url).resolve(
  'jolt-physics/jolt-physics.wasm.wasm',
);
const worlds: IPhysicsWorld[] = [];
afterEach(() => {
  for (const world of worlds) world.dispose();
  worlds.length = 0;
});

it('holds authored traffic speed for ten seconds inside the drive radius', async () => {
  const world = await createPhysicsWorld({ wasmPath });
  worlds.push(world);
  world.setGravity(20);
  world.createStaticBox({ x: 0, y: -0.5, z: -250 }, { x: 300, y: 0.5, z: 400 });
  const path = sampleRoad([{ kind: 'straight', length: 500 }], {
    x: 0,
    z: 0,
    heading: 0,
  });
  const bodies = createSurfacedBodies(world, createSurfaceRegistry());
  const traffic = createTraffic(world, bodies, path, [
    { station: 140, laneSide: -1, speed: 19 },
  ]);
  try {
    const player = { x: 3.5, y: 0.6, z: -40 };
    let lowestCruiseSpeed = Infinity;
    for (let step = 0; step < 10 * 120; step++) {
      const car = traffic.states[0];
      if (car) player.z = car.position.z + 100;
      traffic.preStep(1 / 120, player);
      world.step(1 / 120);
      traffic.postStep();
      if (step >= 5 * 120)
        lowestCruiseSpeed = Math.min(
          lowestCruiseSpeed,
          traffic.states[0]!.speed,
        );
    }
    expect(traffic.states).toHaveLength(1);
    expect(lowestCruiseSpeed).toBeGreaterThan(18);
    expect(traffic.states[0]!.speed).toBeGreaterThan(18);
    expect(traffic.states[0]!.speed).toBeLessThan(20);
  } finally {
    traffic.dispose();
    bodies.dispose();
  }
});

it('keeps twenty distant cars moving and promotes one without a pose or speed jump', async () => {
  const world = await createPhysicsWorld({ wasmPath });
  worlds.push(world);
  world.setGravity(20);
  world.createStaticBox(
    { x: 0, y: -0.5, z: -1000 },
    { x: 300, y: 0.5, z: 1200 },
  );
  const path = sampleRoad([{ kind: 'straight', length: 2000 }], {
    x: 0,
    z: 0,
    heading: 0,
  });
  const bodies = createSurfacedBodies(world, createSurfaceRegistry());
  const traffic = createTraffic(
    world,
    bodies,
    path,
    Array.from({ length: 20 }, (_, i) => ({
      station: 80 + 20 * i,
      laneSide: -1 as const,
      speed: 22,
    })),
  );
  try {
    const farPlayer = { x: 1000, y: 0.6, z: 0 };
    const first = traffic.states[0]!;
    const id = first.id;
    const startZ = first.position.z;
    for (let i = 0; i < 10 * 120; i++) {
      traffic.preStep(1 / 120, farPlayer);
      world.step(1 / 120);
      traffic.postStep();
    }
    expect(traffic.states).toHaveLength(20);
    expect(traffic.states.every((car) => car.bodyId === -1)).toBe(true);
    expect(first.position.z).toBeCloseTo(startZ - 220, 1);
    expect(first.velocity.z).toBeCloseTo(-22, 1);
    expect(traffic.velocityForBody(-1)).toBeUndefined();

    const player = { x: first.position.x, y: 0.6, z: first.position.z + 50 };
    const visualZ = first.position.z;
    traffic.preStep(1 / 120, player);
    expect(traffic.visualStates).toHaveLength(20);
    expect(first.id).toBe(id);
    expect(first.bodyId).not.toBe(-1);
    const bodyVelocity = { x: 0, y: 0, z: 0 };
    world.getLinearVelocity(first.bodyId, bodyVelocity);
    expect(bodyVelocity.z).toBeCloseTo(-22, 1);
    expect(first.position.z).toBeCloseTo(visualZ - 22 / 120, 1);

    traffic.preStep(1 / 120, farPlayer);
    expect(first.bodyId).toBe(-1);
    expect(first.id).toBe(id);
    const demotedZ = first.position.z;
    traffic.preStep(1 / 120, farPlayer);
    expect(first.position.z).toBeLessThan(demotedZ);
  } finally {
    traffic.dispose();
    bodies.dispose();
  }
});

it('drives a pooled car, yields on impact, and keeps its identity through visual hand-offs', async () => {
  const world = await createPhysicsWorld({ wasmPath });
  worlds.push(world);
  world.setGravity(20);
  world.createStaticBox({ x: 0, y: -0.5, z: -250 }, { x: 300, y: 0.5, z: 400 });
  const path = sampleRoad([{ kind: 'straight', length: 500 }], {
    x: 0,
    z: 0,
    heading: 0,
  });
  const bodies = createSurfacedBodies(world, createSurfaceRegistry());
  const traffic = createTraffic(world, bodies, path, [
    { station: 140, laneSide: -1, speed: 19 },
  ]);
  expect(bodies.count).toBe(MAX_DRIVING);
  const player = { x: 3.5, y: 0.6, z: -100 };
  traffic.preStep(1 / 120, player);
  expect(traffic.states).toHaveLength(1);
  const first = traffic.states[0]!;
  const firstEncounterId = first.id;
  const physicalBodyId = first.bodyId;
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
  expect(traffic.velocityForBody(first.bodyId)).toBe(first.velocity);
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
  expect(traffic.states).toHaveLength(1);
  expect(first.bodyId).toBe(-1);
  expect(world.isBodyActive(physicalBodyId)).toBe(false);
  expect(traffic.velocityForBody(physicalBodyId)).toBeUndefined();
  expect(traffic.velocityForBody(-1)).toBeUndefined();

  player.x = first.position.x;
  player.z = wreckZ;
  traffic.preStep(1 / 120, player);
  expect(traffic.states).toHaveLength(1);
  expect(traffic.states[0]!.id).toBe(firstEncounterId);
  expect(traffic.states[0]!.bodyId).toBe(physicalBodyId);
  expect(traffic.states[0]!.wrecked).toBe(true);
  traffic.dispose();
  expect(bodies.count).toBe(0);
  bodies.dispose();
});

it('drives an oncoming car along its lane with matching forward and velocity', async () => {
  const world = await createPhysicsWorld({ wasmPath });
  worlds.push(world);
  world.setGravity(20);
  world.createStaticBox({ x: 0, y: -0.5, z: -250 }, { x: 300, y: 0.5, z: 400 });
  const path = sampleRoad([{ kind: 'straight', length: 500 }], {
    x: 0,
    z: 0,
    heading: 0,
  });
  const bodies = createSurfacedBodies(world, createSurfaceRegistry());
  const traffic = createTraffic(world, bodies, path, [
    { station: 200, laneSide: -1, direction: -1, speed: 24 },
  ]);
  const player = { x: 0, y: 0.6, z: -200 };
  for (let i = 0; i < 100; i++) {
    traffic.preStep(1 / 120, player);
    world.step(1 / 120);
    traffic.postStep();
  }
  const car = traffic.states[0]!;
  expect(car.direction).toBe(-1);
  expect(car.position.z).toBeGreaterThan(-195);
  expect(car.forward.z).toBeGreaterThan(0.8);
  expect(car.velocity.z).toBeGreaterThan(10);
  traffic.dispose();
  bodies.dispose();
});
