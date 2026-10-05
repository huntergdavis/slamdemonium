import { createRequire } from 'node:module';
import { InstancedMesh, Matrix4, Scene } from 'three';
import { afterEach, expect, it } from 'vitest';
import type { IPhysicsWorld } from '../../src/physics/adapter';
import { createPhysicsWorld } from '../../src/physics/joltWorld';
import { createCircuitMap } from '../../src/world/circuit';
import { sampleRoad } from '../../src/world/roadGenerator';
import {
  createTraffic,
  createTrafficVisual,
  MAX_DRIVING,
} from '../../src/world/traffic';
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

it('makes the default circuit breathe beneath the authored density ceiling', async () => {
  const world = await createPhysicsWorld({ wasmPath });
  worlds.push(world);
  const map = createCircuitMap();
  const bodies = createSurfacedBodies(world, createSurfaceRegistry());
  const traffic = createTraffic(world, bodies, map.path, map.traffic, {
    density: 0.85,
    minGap: 12,
    maxGap: 36,
  });
  try {
    expect(map.traffic.length).toBeGreaterThan(1400);
    expect(traffic.activeCount).toBeGreaterThan(700);
    expect(traffic.activeCount).toBeLessThan(1100);
    traffic.setRules({ density: 1, minGap: 12, maxGap: 12 });
    expect(traffic.activeCount).toBe(map.traffic.length);
  } finally {
    traffic.dispose();
    bodies.dispose();
  }
});

it('varies same-lane gaps live without exceeding the old ceiling or reusing ids', async () => {
  const world = await createPhysicsWorld({ wasmPath });
  worlds.push(world);
  const path = sampleRoad([{ kind: 'straight', length: 1000 }], {
    x: 0,
    z: 0,
    heading: 0,
  });
  const bodies = createSurfacedBodies(world, createSurfaceRegistry());
  const records = Array.from({ length: 20 }, (_, i) => ({
    station: 20 + i * 12,
    laneSide: -1 as const,
    speed: 20 + (i % 5),
  }));
  const traffic = createTraffic(world, bodies, path, records, {
    density: 0.85,
    minGap: 12,
    maxGap: 36,
  });
  try {
    const player = { x: 0, y: 0.6, z: -350 };
    traffic.preStep(1 / 120, player);
    expect(traffic.activeCount).toBeLessThan(records.length);
    expect(traffic.activeCount).toBeGreaterThan(5);
    const initialStates = new Map(traffic.states.map((car) => [car.id, car]));
    const stations = traffic.states.map((car) => -car.position.z);
    for (let i = 1; i < stations.length; i++)
      expect(stations[i]! - stations[i - 1]!).toBeGreaterThanOrEqual(11.9);

    traffic.setRules({ density: 1, minGap: 12, maxGap: 12 });
    traffic.preStep(1 / 120, player);
    expect(traffic.activeCount).toBeGreaterThan(initialStates.size);
    expect(traffic.activeCount).toBeLessThanOrEqual(records.length);
    const retained = traffic.states.filter((car) => initialStates.has(car.id));
    expect(retained.length).toBeGreaterThan(0);
    for (const car of retained) expect(car).toBe(initialStates.get(car.id));
  } finally {
    traffic.dispose();
    bodies.dispose();
  }
});

it('slows a faster visual follower behind a slower car in the same lane', async () => {
  const world = await createPhysicsWorld({ wasmPath });
  worlds.push(world);
  const path = sampleRoad([{ kind: 'straight', length: 1000 }], {
    x: 0,
    z: 0,
    heading: 0,
  });
  const bodies = createSurfacedBodies(world, createSurfaceRegistry());
  const traffic = createTraffic(
    world,
    bodies,
    path,
    [
      { station: 20, laneSide: -1, speed: 26 },
      { station: 32, laneSide: -1, speed: 20 },
    ],
    { density: 1, minGap: 12, maxGap: 12 },
  );
  try {
    traffic.preStep(1 / 120, { x: 0, y: 0.6, z: -350 });
    expect(traffic.states).toHaveLength(2);
    expect(traffic.states[0]!.speed).toBeCloseTo(20, 1);
    expect(traffic.states[1]!.speed).toBeCloseTo(20, 1);
  } finally {
    traffic.dispose();
    bodies.dispose();
  }
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
  const scene = new Scene();
  const visual = createTrafficVisual(scene, traffic);
  try {
    const farPlayer = { x: 1000, y: 0.6, z: 0 };
    traffic.preStep(1 / 120, { x: 0, y: 0.6, z: -300 });
    const tracked = [...traffic.states];
    expect(tracked).toHaveLength(20);
    const first = traffic.states[0]!;
    visual.update();
    // The catalogue draws one instanced body mesh per kind: the twenty cars
    // are spread across them, and the first car sits at index 0 of its kind.
    const bodyMeshes = scene.children.filter(
      (child): child is InstancedMesh =>
        child instanceof InstancedMesh && child.name.endsWith('.body'),
    );
    expect(bodyMeshes.reduce((sum, mesh) => sum + mesh.count, 0)).toBe(20);
    const firstMesh = scene.getObjectByName(
      `traffic.${first.modelKind}.body`,
    ) as InstancedMesh;
    const matrix = new Matrix4();
    firstMesh.getMatrixAt(0, matrix);
    expect(matrix.elements[12]).toBeCloseTo(first.position.x, 1);
    expect(matrix.elements[14]).toBeCloseTo(first.position.z, 1);
    const id = first.id;
    const startZ = first.position.z;
    traffic.preStep(1 / 120, farPlayer);
    for (let i = 0; i < 10 * 120; i++) {
      traffic.preStep(1 / 120, farPlayer);
      world.step(1 / 120);
      traffic.postStep();
    }
    expect(traffic.states).toHaveLength(0);
    visual.update();
    expect(bodyMeshes.reduce((sum, mesh) => sum + mesh.count, 0)).toBe(0);
    expect(tracked.every((car) => car.bodyId === -1)).toBe(true);
    expect(first.position.z).toBeLessThan(startZ - 219);
    expect(first.position.z).toBeGreaterThan(startZ - 222);
    expect(first.velocity.z).toBeCloseTo(-22, 1);
    expect(traffic.velocityForBody(-1)).toBeUndefined();

    const player = { x: first.position.x, y: 0.6, z: first.position.z + 130 };
    traffic.preStep(1 / 120, player);
    const visualZ = first.position.z;
    expect(first.bodyId).toBe(-1);
    player.z = first.position.z + 50;
    traffic.preStep(1 / 120, player);
    expect(traffic.visualStates).toContain(first);
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
    for (let i = 0; i < 13; i++) traffic.preStep(1 / 120, farPlayer);
    expect(first.position.z).toBeLessThan(demotedZ);
  } finally {
    visual.dispose();
    traffic.dispose();
    bodies.dispose();
  }
});

it('gives a closer car a physical body when the pool is full', async () => {
  const world = await createPhysicsWorld({ wasmPath });
  worlds.push(world);
  const path = sampleRoad([{ kind: 'straight', length: 500 }], {
    x: 0,
    z: 0,
    heading: 0,
  });
  const bodies = createSurfacedBodies(world, createSurfaceRegistry());
  const traffic = createTraffic(world, bodies, path, [
    ...Array.from({ length: MAX_DRIVING }, (_, i) => ({
      station: 8 + i * 10,
      laneSide: -1 as const,
      speed: 22,
    })),
    { station: 1, laneSide: -1, speed: 22 },
  ]);
  try {
    traffic.preStep(1 / 120, { x: 0, y: 0.6, z: 0 });
    expect(traffic.states.filter((car) => car.bodyId !== -1)).toHaveLength(
      MAX_DRIVING,
    );
    expect(traffic.states.at(-1)!.bodyId).not.toBe(-1);
    expect(traffic.states[MAX_DRIVING - 1]!.bodyId).toBe(-1);
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
  const gentleImpact = { ...impact, severity: 0.05 };
  traffic.onPlayerContact(
    first.bodyId,
    gentleImpact,
    { x: 0, y: 0, z: 1 },
    { x: 0, y: 0, z: -8 },
  );
  const lowSpeedDepth = first.crush.rear;
  expect(lowSpeedDepth).toBeGreaterThan(0.25);
  expect(first.crush.front).toBe(0);
  expect(first.wrecked).toBe(false);
  traffic.onPlayerContact(
    first.bodyId,
    gentleImpact,
    { x: 0, y: 0, z: 1 },
    { x: 0, y: 0, z: -15 },
  );
  expect(first.crush.rear).toBeGreaterThan(lowSpeedDepth);
  traffic.onPlayerContact(
    first.bodyId,
    gentleImpact,
    { x: 1, y: 0, z: 0 },
    { x: -8, y: 0, z: 0 },
  );
  expect(first.crush.left).toBeGreaterThan(0.25);
  expect(first.crush.right).toBe(0);
  traffic.onPlayerContact(
    first.bodyId,
    gentleImpact,
    { x: 0, y: 0, z: -1 },
    { x: 0, y: 0, z: 8 },
  );
  expect(first.crush.front).toBeGreaterThan(0.25);
  traffic.onPlayerContact(
    first.bodyId,
    gentleImpact,
    { x: -1, y: 0, z: 0 },
    { x: 8, y: 0, z: 0 },
  );
  expect(first.crush.right).toBeGreaterThan(0.25);
  expect(first.wrecked).toBe(false);
  world.onContact((a, b) => {
    if (
      (a === car && b === first.bodyId) ||
      (b === car && a === first.bodyId)
    ) {
      contacts++;
      traffic.onPlayerContact(
        first.bodyId,
        impact,
        { x: 0, y: 0, z: 1 },
        { x: 0, y: 0, z: -23 },
      );
    }
  });
  for (let i = 0; i < 120 && !first.wrecked; i++) {
    traffic.preStep(1 / 120, player);
    world.step(1 / 120);
    traffic.postStep();
  }
  expect(contacts).toBeGreaterThan(0);
  expect(first.wrecked).toBe(true);
  const crush = first.crush;
  expect(Math.max(...Object.values(crush))).toBeGreaterThan(0);
  const firstDepth = crush.rear;
  expect(firstDepth).toBeGreaterThan(0.65);
  traffic.onPlayerContact(
    first.bodyId,
    impact,
    { x: 0, y: 0, z: 1 },
    { x: 0, y: 0, z: -30 },
  );
  const mediumDepth = crush.rear;
  expect(mediumDepth).toBeGreaterThan(firstDepth);
  traffic.onPlayerContact(
    first.bodyId,
    impact,
    { x: 0, y: 0, z: 1 },
    { x: 0, y: 0, z: -60 },
  );
  expect(crush.rear).toBeGreaterThan(mediumDepth);
  traffic.onPlayerContact(
    first.bodyId,
    impact,
    { x: 1, y: 0, z: 0 },
    { x: -60, y: 0, z: 0 },
  );
  expect(crush.left).toBeGreaterThan(0);
  traffic.preStep(1 / 120, player);
  expect(world.isBodyAwake(first.bodyId)).toBe(true);
  const wreckZ = first.position.z;
  player.x = 1000;
  player.z = 1000;
  traffic.preStep(1 / 120, player);
  expect(traffic.states).toHaveLength(0);
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
  expect(traffic.states[0]!.crush).toBe(crush);
  expect(Math.max(...Object.values(crush))).toBeGreaterThan(0);
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
