import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
import { createPhysicsWorld } from '../src/physics/joltWorld';
import type {
  DynamicBoxDesc,
  IPhysicsWorld,
  RayHit,
} from '../src/physics/adapter';

const wasmPath = createRequire(import.meta.url).resolve(
  'jolt-physics/jolt-physics.wasm.wasm',
);
const worlds: IPhysicsWorld[] = [];
async function world() {
  const value = await createPhysicsWorld({ wasmPath });
  worlds.push(value);
  return value;
}
const box = (overrides: Partial<DynamicBoxDesc> = {}): DynamicBoxDesc => ({
  center: { x: 0, y: 2, z: 0 },
  halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
  mass: 12,
  comOffset: { x: 0, y: 0, z: 0 },
  inertiaScale: { x: 1, y: 1, z: 1 },
  friction: 0,
  restitution: 0,
  ccd: true,
  maxAngularVelocity: 12,
  angularDamping: 0,
  ...overrides,
});
const vec = () => ({ x: 0, y: 0, z: 0 });
const quat = () => ({ x: 0, y: 0, z: 0, w: 1 });
afterEach(() => {
  for (const value of worlds) value.dispose();
  worlds.length = 0;
});

describe('the real single-thread WASM adapter', () => {
  it('settles a dynamic box on a floor at 120 Hz and copies caller outputs', async () => {
    const w = await world();
    w.createStaticBox({ x: 0, y: -0.5, z: 0 }, { x: 50, y: 0.5, z: 50 });
    const a = w.createDynamicBox(box());
    const b = w.createDynamicBox(box({ center: { x: 10, y: 3, z: 0 } }));
    const aPos = vec();
    const bPos = vec();
    const rot = quat();
    for (let i = 0; i < 360; i++) w.step(1 / 120);
    w.getTransform(a, aPos, rot);
    const saved = { ...aPos };
    w.getTransform(b, bPos, rot);
    expect(aPos).toEqual(saved);
    expect(aPos.y).toBeCloseTo(0.5, 1);
    expect(bPos.x).toBeCloseTo(10);
  });

  it('accumulates force at a world point and torque for exactly one step', async () => {
    const w = await world();
    w.setGravity(0);
    const id = w.createDynamicBox(box());
    w.applyForceAtPoint(id, { x: 0, y: 0, z: -1200 }, { x: 1, y: 2, z: 0 });
    w.applyTorque(id, { x: 0, y: 60, z: 0 });
    w.step(1 / 120);
    const v = vec();
    const omega = vec();
    const pointV = vec();
    w.getLinearVelocity(id, v);
    w.getAngularVelocity(id, omega);
    expect(v.z).toBeCloseTo(-1200 / 12 / 120, 5);
    expect(omega.y).toBeGreaterThan(0);
    w.getPointVelocity(id, { x: 1, y: 2, z: 0 }, pointV);
    expect(pointV.z).toBeLessThan(v.z);
    w.step(1 / 120);
    w.getLinearVelocity(id, v);
    expect(v.z).toBeCloseTo(-1200 / 12 / 120, 5);
  });

  it('returns ray distance, copied point/normal, surface id, and excludes the chassis', async () => {
    const w = await world();
    const floor = w.createStaticBox(
      { x: 0, y: -0.5, z: 0 },
      { x: 50, y: 0.5, z: 50 },
      0,
      0.5,
      0,
      7,
    );
    const car = w.createDynamicBox(box());
    const hit: RayHit = {
      distance: 0,
      point: vec(),
      normal: vec(),
      bodyId: 0,
      surfaceId: 0,
    };
    expect(
      w.rayCast({ x: 0, y: 2, z: 0 }, { x: 0, y: -1, z: 0 }, 10, hit, car),
    ).toBe(true);
    expect(hit.distance).toBeCloseTo(2, 5);
    expect(hit.point.y).toBeCloseTo(0, 5);
    expect(hit.normal).toEqual({ x: 0, y: 1, z: 0 });
    expect(hit.bodyId).toBe(floor);
    expect(hit.surfaceId).toBe(7);
    expect(
      w.rayCast({ x: 100, y: 2, z: 100 }, { x: 0, y: -1, z: 0 }, 10, hit, car),
    ).toBe(false);
  });

  it('preserves pose and both velocities across a center-of-mass and inertia rebuild', async () => {
    const w = await world();
    w.setGravity(0);
    const id = w.createDynamicBox(box());
    const p = { x: 4, y: 5, z: 6 };
    const q = { x: 0, y: Math.sin(0.3), z: 0, w: Math.cos(0.3) };
    w.setTransform(id, p, q, true);
    w.setLinearVelocity(id, { x: 3, y: 2, z: 1 });
    w.setAngularVelocity(id, { x: 1, y: 2, z: 3 });
    w.updateMassProperties(id, {
      mass: 20,
      comOffset: { x: 0, y: -0.2, z: 0.3 },
      inertiaScale: { x: 2, y: 0.5, z: 2 },
    });
    const position = vec();
    const rotation = quat();
    const velocity = vec();
    const omega = vec();
    w.getTransform(id, position, rotation);
    w.getLinearVelocity(id, velocity);
    w.getAngularVelocity(id, omega);
    expect(position.x).toBeCloseTo(p.x, 5);
    expect(position.y).toBeCloseTo(p.y, 5);
    expect(position.z).toBeCloseTo(p.z, 5);
    expect(rotation.y).toBeCloseTo(q.y, 5);
    expect(rotation.w).toBeCloseTo(q.w, 5);
    expect(velocity).toEqual({ x: 3, y: 2, z: 1 });
    expect(omega).toEqual({ x: 1, y: 2, z: 3 });
    w.setTransform(id, p, q, true);
    w.getLinearVelocity(id, velocity);
    w.getAngularVelocity(id, omega);
    expect(velocity).toEqual(vec());
    expect(omega).toEqual(vec());
  });

  it('stops an 85 m/s box at a 4 cm wall using linear-cast CCD', async () => {
    const w = await world();
    w.setGravity(0);
    w.createStaticBox({ x: 0, y: 1, z: 0 }, { x: 0.02, y: 2, z: 2 });
    const id = w.createDynamicBox(
      box({
        center: { x: -2, y: 1, z: 0 },
        halfExtents: { x: 0.1, y: 0.1, z: 0.1 },
      }),
    );
    w.setLinearVelocity(id, { x: 85, y: 0, z: 0 });
    const p = vec();
    const q = quat();
    let maxX = -2;
    for (let i = 0; i < 30; i++) {
      w.step(1 / 120);
      w.getTransform(id, p, q);
      maxX = Math.max(maxX, p.x);
    }
    expect(maxX).toBeLessThanOrEqual(-0.1 + 1e-5);
    const control = w.createDynamicBox(
      box({
        center: { x: -2, y: 2, z: 1 },
        halfExtents: { x: 0.1, y: 0.1, z: 0.1 },
        ccd: false,
      }),
    );
    w.setLinearVelocity(control, { x: 85, y: 0, z: 0 });
    for (let i = 0; i < 30; i++) w.step(1 / 120);
    w.getTransform(control, p, q);
    expect(p.x).toBeGreaterThan(1); // The identical discrete-motion box tunnels.
  });

  it('reclaims allocator memory over repeated world creation and disposal', async () => {
    const stats = { heapBytes: 0, freeBytes: 0 };
    let baseline = 0;
    for (let cycle = 0; cycle < 8; cycle++) {
      const w = await world();
      const id = w.createDynamicBox(box());
      w.step(1 / 120);
      w.updateMassProperties(id, {
        mass: 20,
        comOffset: { x: 0, y: -0.2, z: 0.2 },
        inertiaScale: { x: 1, y: 1, z: 1 },
      });
      w.dispose();
      w.dispose();
      w.getMemoryStats(stats);
      if (cycle === 2) baseline = stats.freeBytes;
      if (cycle > 2) expect(stats.freeBytes).toBe(baseline);
    }
    expect(stats.heapBytes).toBeGreaterThan(0);
  });
});

it('reports real contact geometry with an explicitly unavailable solved impulse', async () => {
  const w = await world();
  const floor = w.createStaticBox(
    { x: 0, y: -0.5, z: 0 },
    { x: 5, y: 0.5, z: 5 },
  );
  const car = w.createDynamicBox(box());
  let seen = false;
  w.onContact((a, b, impulse, point, normal) => {
    expect([a, b].sort()).toEqual([floor, car].sort());
    expect(impulse).toBeNull();
    expect(Number.isFinite(point.x + point.y + point.z)).toBe(true);
    expect(Math.abs(normal.y)).toBeCloseTo(1, 5);
    seen = true;
  });
  for (let i = 0; i < 240; i++) w.step(1 / 120);
  expect(seen).toBe(true);
});

it('uses rebuilt mass and scaled yaw inertia for force and torque response', async () => {
  const w = await world();
  w.setGravity(0);
  const id = w.createDynamicBox(box());
  w.updateMassProperties(id, {
    mass: 24,
    comOffset: { x: 0, y: 0, z: 0 },
    inertiaScale: { x: 1, y: 2, z: 1 },
  });
  w.applyForceAtPoint(id, { x: 0, y: 0, z: -2880 }, { x: 0, y: 2, z: 0 });
  w.applyTorque(id, { x: 0, y: 120, z: 0 });
  w.step(1 / 120);
  const velocity = vec();
  const omega = vec();
  w.getLinearVelocity(id, velocity);
  w.getAngularVelocity(id, omega);
  expect(velocity.z).toBeCloseTo(-1, 5);
  expect(omega.y).toBeCloseTo(0.125, 5); // 24 kg cube: I_y = 4, doubled to 8.
});

it('reports real local inertia and applies live angular limits, damping and contact settings', async () => {
  const w = await world();
  w.setGravity(0);
  const floor = w.createStaticBox(
    { x: 0, y: -1, z: 0 },
    { x: 20, y: 0.5, z: 20 },
  );
  w.setContactProperties(floor, 0.3, 0.2);
  const id = w.createDynamicBox(box());
  const inertia = vec();
  w.getLocalInertia(id, inertia);
  expect(inertia.y).toBeCloseTo(2, 5); // 12 kg, one meter cube.
  w.setBodyProperties(id, {
    angularDamping: 2,
    maxAngularVelocity: 3,
    friction: 0.1,
    restitution: 0.4,
  });
  w.setAngularVelocity(id, { x: 0, y: 20, z: 0 });
  const omega = vec();
  w.getAngularVelocity(id, omega);
  expect(omega.y).toBeCloseTo(3, 5);
  w.step(1 / 120);
  w.getAngularVelocity(id, omega);
  expect(omega.y).toBeLessThan(3);
});
