import { createRequire } from 'node:module';
import { afterEach, expect, it } from 'vitest';
import { createPhysicsWorld } from '../src/physics/joltWorld';
import type { IPhysicsWorld } from '../src/physics/adapter';
import type { GameInput } from '../src/core/gameApi';
import { TuningStore } from '../src/tuning/store';
import { Vehicle } from '../src/vehicle/vehicle';

const wasmPath = createRequire(import.meta.url).resolve(
  'jolt-physics/jolt-physics.wasm.wasm',
);
const worlds: IPhysicsWorld[] = [];
const idle: GameInput = {
  throttle: 0,
  brake: 0,
  steer: 0,
  handbrake: false,
  boost: false,
};
async function setup(hz = 120) {
  const world = await createPhysicsWorld({ wasmPath });
  worlds.push(world);
  world.createStaticBox({ x: 0, y: -0.5, z: 0 }, { x: 5000, y: 0.5, z: 5000 });
  const tuning = new TuningStore();
  tuning.set('physicsHz', hz);
  const vehicle = new Vehicle(world, tuning);
  const dt = 1 / hz;
  function step(input = idle, count = 1) {
    for (let i = 0; i < count; i++) {
      vehicle.preStep(dt, input);
      world.step(dt);
      vehicle.postStep(dt);
    }
  }
  step(idle, hz * 3);
  return { world, tuning, vehicle, step };
}
afterEach(() => {
  for (const world of worlds) world.dispose();
  worlds.length = 0;
});

it('supports its weight on four rays, launches, and coasts without gaining speed', async () => {
  const { vehicle, step } = await setup();
  const s = vehicle.telemetry;
  expect(s.groundedWheels).toBe(4);
  expect(s.position.y).toBeCloseTo(0.86, 1);
  expect(s.wheels.reduce((sum, wheel) => sum + wheel.Fz, 0)).toBeCloseTo(
    1300 * 14.7,
    -1,
  );
  step({ ...idle, throttle: 1 }, 360);
  expect(s.vLong).toBeGreaterThan(30);
  expect(Math.abs(s.vLat)).toBeLessThan(0.1);
  // Let the throttle ramp finish before checking the coast energy invariant.
  step(idle, 24);
  let previous = s.speed;
  for (let i = 0; i < 360; i++) {
    step();
    expect(s.speed).toBeLessThanOrEqual(previous + 1e-4);
    previous = s.speed;
  }
  expect(s.recoveryCount).toBe(0);
});

it('brakes from 60 m/s within the specified default stopping distance', async () => {
  const { world, vehicle, step } = await setup();
  world.setLinearVelocity(vehicle.body, { x: 0, y: 0, z: -60 });
  const start = vehicle.telemetry.position.z;
  let count = 0;
  do {
    step({ ...idle, brake: 1 });
    count++;
  } while (vehicle.telemetry.vLong > 0.5 && count < 1200);
  const distance = start - vehicle.telemetry.position.z;
  expect(count).toBeLessThan(1200);
  expect(distance).toBeGreaterThan(77 * 0.85);
  expect(distance).toBeLessThan(77 * 1.15);
});

it('positive steering turns left, and a handbrake reduces rear tire grip', async () => {
  const { world, vehicle, step } = await setup();
  world.setLinearVelocity(vehicle.body, { x: 0, y: 0, z: -30 });
  step({ ...idle, throttle: 0.3, steer: 0.3 }, 240);
  expect(vehicle.telemetry.position.x).toBeLessThan(-1);
  expect(vehicle.telemetry.yawRate).toBeGreaterThan(0);
  expect(vehicle.telemetry.recoveryCount).toBe(0);
  step({ ...idle, throttle: 0.3, steer: 0.3, handbrake: true }, 12);
  expect(vehicle.controls.rearGrip).toBeCloseTo(0.35);
  expect(vehicle.telemetry.wheels[2].mu).toBeLessThan(
    vehicle.telemetry.wheels[0].mu,
  );
  expect(vehicle.telemetry.wheels[2].locked).toBe(true);
});

it('rebuilds actual mass/inertia without teleporting or stopping the body', async () => {
  const { tuning, vehicle, step } = await setup();
  step({ ...idle, throttle: 1 }, 120);
  const before = { ...vehicle.telemetry.position };
  const speed = vehicle.telemetry.speed;
  tuning.set('mass', 1800);
  tuning.set('comLongOffset', 0.4);
  vehicle.rebuildMassProperties();
  expect(vehicle.telemetry.position.x).toBeCloseTo(before.x, 5);
  expect(vehicle.telemetry.position.y).toBeCloseTo(before.y, 5);
  expect(vehicle.telemetry.speed).toBeCloseTo(speed, 5);
});
