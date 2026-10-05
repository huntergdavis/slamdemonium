import { createRequire } from 'node:module';
import { afterEach, expect, it } from 'vitest';
import type { IPhysicsWorld } from '../../src/physics/adapter';
import { createPhysicsWorld } from '../../src/physics/joltWorld';
import { CAR_MODELS } from '../../src/world/carModels';
import { trafficCrushShape } from '../../src/world/trafficCrushShape';

/** The traffic catalogue swaps a pooled car's collision box for its kind at
 * promotion. Real Jolt: the swap keeps the body asleep where it is, the new
 * box is what touches the ground, and mass is what we asked for. */
const wasmPath = createRequire(import.meta.url).resolve(
  'jolt-physics/jolt-physics.wasm.wasm',
);
const HZ = 120;
const worlds: IPhysicsWorld[] = [];
afterEach(() => {
  for (const world of worlds) world.dispose();
  worlds.length = 0;
});
const mass = (kg: number) => ({
  mass: kg,
  comOffset: { x: 0, y: 0, z: 0 },
  inertiaScale: { x: 1, y: 1, z: 1 },
});

it('swaps an inactive pooled box for a bigger one: still asleep, rests on the new box, weighs what it should', async () => {
  const world = await createPhysicsWorld({ wasmPath });
  worlds.push(world);
  world.setGravity(20);
  world.createStaticBox({ x: 0, y: -0.5, z: 0 }, { x: 100, y: 0.5, z: 100 });
  const small = { x: 0.95, y: 0.55, z: 2.1 };
  const big = { x: 1.45, y: 1.7, z: 6.0 }; // The bus.
  const body = world.createPooledBox({
    motion: 'dynamic',
    halfExtents: small,
    ...mass(1100),
    friction: 0.05,
    restitution: 0.05,
    ccd: true,
    maxAngularVelocity: 9,
    angularDamping: 0.25,
  });
  expect(world.isBodyAwake(body)).toBe(false);
  world.setBodyShape(body, big, mass(1100));
  expect(world.isBodyAwake(body)).toBe(false); // The swap did not wake it.
  // Drop it from above the ground and let it settle on the new box.
  world.activateBody(body, { x: 0, y: 4, z: 0 }, { x: 0, y: 0, z: 0, w: 1 });
  const pos = { x: 0, y: 0, z: 0 };
  const quat = { x: 0, y: 0, z: 0, w: 1 };
  for (let i = 0; i < 3 * HZ; i++) world.step(1 / HZ);
  world.getTransform(body, pos, quat);
  expect(pos.y).toBeCloseTo(big.y, 1); // Resting on the 1.7 m half-height, not 0.55.
  // F = m a: a known force for one second reads back the mass. Gravity off
  // so ground friction does not eat part of the force.
  world.setGravity(0);
  const vel = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < HZ; i++) {
    world.getTransform(body, pos, quat);
    world.applyForceAtPoint(body, { x: 0, y: 0, z: 11000 }, pos);
    world.step(1 / HZ);
  }
  world.getLinearVelocity(body, vel);
  // 11000 N on 1100 kg for 1 s is 10 m/s.
  expect(vel.z).toBeGreaterThan(9.7);
  expect(vel.z).toBeLessThan(10.3);
});

it('refuses a static body', async () => {
  const world = await createPhysicsWorld({ wasmPath });
  worlds.push(world);
  const ground = world.createStaticBox(
    { x: 0, y: -0.5, z: 0 },
    { x: 10, y: 0.5, z: 10 },
  );
  expect(() =>
    world.setBodyShape(ground, { x: 1, y: 1, z: 1 }, mass(1)),
  ).toThrow();
});

it('retracts the crushed front while touching road and another car without a velocity pop', async () => {
  const world = await createPhysicsWorld({ wasmPath });
  worlds.push(world);
  world.setGravity(20);
  world.createStaticBox({ x: 0, y: -0.5, z: 0 }, { x: 100, y: 0.5, z: 100 });
  const model = CAR_MODELS.sedan;
  const body = world.createPooledBox({
    motion: 'dynamic',
    halfExtents: model.halfExtents,
    ...mass(1100),
    friction: 0.7,
    restitution: 0,
    ccd: true,
    maxAngularVelocity: 9,
    angularDamping: 0.25,
  });
  world.activateBody(
    body,
    { x: 0, y: model.ride, z: 0 },
    { x: 0, y: 0, z: 0, w: 1 },
  );
  const touching = world.createDynamicBox({
    center: { x: 0, y: model.ride, z: model.halfExtents.z + 2.08 },
    halfExtents: { x: 1, y: 0.6, z: 2 },
    ...mass(1300),
    friction: 0.7,
    restitution: 0,
    ccd: true,
    maxAngularVelocity: 9,
    angularDamping: 0.25,
  });
  for (let i = 0; i < 30; i++) world.step(1 / HZ);
  const hit = {
    distance: 0,
    bodyId: -1,
    surfaceId: 0,
    point: { x: 0, y: 0, z: 0 },
    normal: { x: 0, y: 0, z: 0 },
  };
  const rayOrigin = { x: 0, y: model.ride, z: 8 };
  expect(
    world.rayCast(rayOrigin, { x: 0, y: 0, z: -1 }, 10, hit, touching),
  ).toBe(true);
  expect(hit.bodyId).toBe(body);
  const beforeFace = hit.distance;
  const beforePos = { x: 0, y: 0, z: 0 };
  const afterPos = { x: 0, y: 0, z: 0 };
  const rotation = { x: 0, y: 0, z: 0, w: 1 };
  const beforeVelocity = { x: 0, y: 0, z: 0 };
  const afterVelocity = { x: 0, y: 0, z: 0 };
  world.getTransform(body, beforePos, rotation);
  world.getLinearVelocity(body, beforeVelocity);
  const crushed = trafficCrushShape('sedan', {
    front: 0.75,
    rear: 0,
    left: 0,
    right: 0,
  })!;
  world.setBodyConvexShape(
    body,
    crushed.key,
    crushed.vertices,
    crushed.halfExtents,
    mass(1100),
  );
  world.getTransform(body, afterPos, rotation);
  world.getLinearVelocity(body, afterVelocity);
  const swapDelta = Math.hypot(
    afterVelocity.x - beforeVelocity.x,
    afterVelocity.y - beforeVelocity.y,
    afterVelocity.z - beforeVelocity.z,
  );
  expect(swapDelta).toBeLessThan(0.1); // Normal slam changes several m/s.
  expect(
    Math.hypot(
      afterPos.x - beforePos.x,
      afterPos.y - beforePos.y,
      afterPos.z - beforePos.z,
    ),
  ).toBeLessThan(0.01);
  expect(
    world.rayCast(rayOrigin, { x: 0, y: 0, z: -1 }, 10, hit, touching),
  ).toBe(true);
  expect(hit.bodyId).toBe(body);
  expect(hit.distance - beforeFace).toBeGreaterThan(0.6);
  // The second contact must meet the new shorter face and remain stable.
  world.setTransform(
    touching,
    { x: 0, y: model.ride, z: 8 - hit.distance + 2.2 },
    { x: 0, y: 0, z: 0, w: 1 },
    true,
  );
  world.setLinearVelocity(touching, { x: 0, y: 0, z: -5 });
  let repeatContacts = 0;
  world.onContact((a, b) => {
    if ((a === body && b === touching) || (b === body && a === touching))
      repeatContacts++;
  });
  for (let i = 0; i < 60; i++) world.step(1 / HZ);
  world.getLinearVelocity(body, afterVelocity);
  expect(
    Number.isFinite(afterVelocity.x + afterVelocity.y + afterVelocity.z),
  ).toBe(true);
  expect(
    Math.hypot(afterVelocity.x, afterVelocity.y, afterVelocity.z),
  ).toBeLessThan(5);
  expect(repeatContacts).toBeGreaterThan(0);
});
