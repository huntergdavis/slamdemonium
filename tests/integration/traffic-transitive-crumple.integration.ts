import { createRequire } from 'node:module';
import { expect, it, vi } from 'vitest';
import { createPhysicsWorld } from '../../src/physics/joltWorld';
import { sampleRoad } from '../../src/world/roadGenerator';
import { createSurfacedBodies } from '../../src/world/surfacedBodies';
import { createSurfaceRegistry } from '../../src/world/surfaceRegistry';
import { createTraffic, type TrafficCarRecord } from '../../src/world/traffic';
import { createImpactSeverity } from '../../src/core/impactSeverity';

const wasmPath = createRequire(import.meta.url).resolve(
  'jolt-physics/jolt-physics.wasm.wasm',
);
const DT = 1 / 120;
const PLAYER = { x: 3.5, y: 1, z: -100 };

async function fixture(records: readonly TrafficCarRecord[]) {
  const world = await createPhysicsWorld({ wasmPath });
  world.setGravity(20);
  world.createStaticBox({ x: 0, y: -0.5, z: -150 }, { x: 300, y: 0.5, z: 350 });
  const bodies = createSurfacedBodies(world, createSurfaceRegistry());
  const path = sampleRoad([{ kind: 'straight', length: 300 }], {
    x: 0,
    z: 0,
    heading: 0,
  });
  const traffic = createTraffic(world, bodies, path, records);
  world.onContact((a, b, _impulse, _point, normal, readVelocities) => {
    traffic.onWorldContact(a, b, normal, readVelocities);
  });
  const step = () => {
    traffic.preStep(DT, PLAYER);
    world.step(DT);
    traffic.postStep();
  };
  return {
    world,
    traffic,
    step,
    dispose() {
      traffic.dispose();
      bodies.dispose();
      world.dispose();
    },
  };
}

it('crumples both cars in each link of a live A into B into C chain', async () => {
  const run = await fixture([
    { station: 90, laneSide: -1, speed: 38, modelKind: 'sedan' },
    { station: 99, laneSide: -1, speed: 0, modelKind: 'sedan' },
    { station: 108, laneSide: -1, speed: 0, modelKind: 'sedan' },
  ]);
  const shapeSwap = vi.spyOn(run.world, 'setBodyConvexShape');
  try {
    for (let i = 0; i < 360; i++) run.step();
    const [a, b, c] = run.traffic.states;
    expect(a?.crush.front).toBeGreaterThan(0);
    expect(b?.crush.rear).toBeGreaterThan(0);
    expect(b?.crush.front).toBeGreaterThan(0);
    expect(c?.crush.rear).toBeGreaterThan(0);
    expect(shapeSwap.mock.calls.some(([id]) => id === b?.bodyId)).toBe(true);
    expect(shapeSwap.mock.calls.some(([id]) => id === c?.bodyId)).toBe(true);
  } finally {
    run.dispose();
  }
}, 300_000);

it('dents both cars in a gentle chain without disabling their lane drive', async () => {
  const run = await fixture([
    { station: 90, laneSide: -1, speed: 8, modelKind: 'sedan' },
    { station: 99, laneSide: -1, speed: 0, modelKind: 'sedan' },
  ]);
  try {
    for (let i = 0; i < 360; i++) run.step();
    const [a, b] = run.traffic.states;
    expect(a?.crush.front).toBeGreaterThan(0);
    expect(b?.crush.rear).toBeGreaterThan(0);
    expect(a?.wrecked).toBe(false);
    expect(b?.wrecked).toBe(false);
  } finally {
    run.dispose();
  }
}, 300_000);

it('crumples a traffic car against a wall and swaps its physical hull', async () => {
  const run = await fixture([
    { station: 100, laneSide: -1, speed: 25, modelKind: 'sedan' },
  ]);
  run.world.createStaticBox({ x: 3.5, y: 1, z: -112 }, { x: 5, y: 2, z: 0.5 });
  const shapeSwap = vi.spyOn(run.world, 'setBodyConvexShape');
  try {
    for (let i = 0; i < 240; i++) run.step();
    const car = run.traffic.states[0]!;
    expect(car.crush.front).toBeGreaterThan(0);
    expect(car.wrecked).toBe(true);
    expect(shapeSwap.mock.calls.some(([id]) => id === car.bodyId)).toBe(true);
  } finally {
    run.dispose();
  }
}, 300_000);

it('instacrushes a rival that is shunted hard into a solid wall', async () => {
  const run = await fixture([
    { station: 100, laneSide: -1, speed: 25, modelKind: 'sedan', rival: true },
  ]);
  run.world.createStaticBox({ x: 3.5, y: 1, z: -112 }, { x: 5, y: 2, z: 0.5 });
  try {
    for (let i = 0; i < 240; i++) run.step();
    const rival = run.traffic.states[0]!;
    expect(rival.wrecked).toBe(true);
    expect(rival.crush.front).toBeGreaterThan(0.8);
  } finally {
    run.dispose();
  }
}, 300_000);

it('spreads simultaneous crushed-hull replacements over physics steps', async () => {
  const run = await fixture([
    { station: 80, laneSide: -1, speed: 0, modelKind: 'sedan' },
    { station: 110, laneSide: -1, speed: 0, modelKind: 'sedan' },
    { station: 140, laneSide: -1, speed: 0, modelKind: 'sedan' },
  ]);
  try {
    run.step();
    const cars = [...run.traffic.states];
    expect(cars).toHaveLength(3);
    const shapeSwap = vi.spyOn(run.world, 'setBodyConvexShape');
    const impact = createImpactSeverity();
    impact.severity = 1;
    for (const car of cars)
      run.traffic.onPlayerContact(
        car.bodyId,
        impact,
        { x: 0, y: 0, z: 1 },
        { x: 0, y: 0, z: -25 },
      );
    for (let step = 0; step < 3; step++) {
      const before = shapeSwap.mock.calls.length;
      run.step();
      expect(shapeSwap.mock.calls.length - before).toBeLessThanOrEqual(1);
    }
    expect(shapeSwap).toHaveBeenCalledTimes(3);
  } finally {
    run.dispose();
  }
}, 300_000);

it('uses a moving object’s speed to crumple a stationary traffic car', async () => {
  const run = await fixture([
    { station: 100, laneSide: -1, speed: 0, modelKind: 'sedan' },
  ]);
  const shapeSwap = vi.spyOn(run.world, 'setBodyConvexShape');
  try {
    run.step();
    const car = run.traffic.states[0]!;
    const object = run.world.createDynamicBox({
      center: { x: car.position.x, y: 0.7, z: car.position.z - 8 },
      halfExtents: { x: 0.7, y: 0.7, z: 0.7 },
      mass: 80,
      comOffset: { x: 0, y: 0, z: 0 },
      inertiaScale: { x: 1, y: 1, z: 1 },
      friction: 0.1,
      restitution: 0,
      ccd: true,
      maxAngularVelocity: 12,
      angularDamping: 0,
    });
    run.world.setLinearVelocity(object, { x: 0, y: 0, z: 22 });
    for (let i = 0; i < 120; i++) run.step();
    expect(car.crush.front).toBeGreaterThan(0);
    expect(shapeSwap.mock.calls.some(([id]) => id === car.bodyId)).toBe(true);
  } finally {
    run.dispose();
  }
}, 300_000);

it('does not dent a traffic car after a small hop', async () => {
  const run = await fixture([
    { station: 100, laneSide: -1, speed: 0, modelKind: 'sedan' },
  ]);
  try {
    run.step();
    const car = run.traffic.states[0]!;
    run.world.setTransform(
      car.bodyId,
      { x: car.position.x, y: car.position.y + 1, z: car.position.z },
      car.rotation,
      true,
    );
    run.traffic.postStep();
    for (let i = 0; i < 180; i++) run.step();
    expect(car.crush.front).toBe(0);
    expect(car.crush.rear).toBe(0);
    expect(car.crush.left).toBe(0);
    expect(car.crush.right).toBe(0);
  } finally {
    run.dispose();
  }
}, 300_000);

it('compresses the shell and collider when a traffic car lands hard', async () => {
  const run = await fixture([
    { station: 100, laneSide: -1, speed: 0, modelKind: 'sedan' },
  ]);
  const shapeSwap = vi.spyOn(run.world, 'setBodyConvexShape');
  try {
    run.step();
    const car = run.traffic.states[0]!;
    expect(car.crush.front).toBe(0);
    run.world.setTransform(
      car.bodyId,
      { x: car.position.x, y: 15, z: car.position.z },
      car.rotation,
      true,
    );
    run.traffic.postStep();
    for (let i = 0; i < 240; i++) run.step();
    expect(car.crush.front).toBeGreaterThan(0);
    expect(car.crush.rear).toBeGreaterThan(0);
    expect(car.crush.left).toBeGreaterThan(0);
    expect(car.crush.right).toBeGreaterThan(0);
    expect(shapeSwap.mock.calls.some(([id]) => id === car.bodyId)).toBe(true);
  } finally {
    run.dispose();
  }
}, 300_000);
