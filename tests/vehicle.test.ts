import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterEach, expect, it, vi } from 'vitest';
import { createPhysicsWorld } from '../src/physics/joltWorld';
import type { IPhysicsWorld } from '../src/physics/adapter';
import type { GameInput } from '../src/core/gameApi';
import { TuningStore } from '../src/tuning/store';
import { Vehicle } from '../src/vehicle/vehicle';
import { createTrackSurfaceResolver } from '../src/world/trackSurfaces';
import { SURFACE_IDS, type SurfaceResolver } from '../src/content/surfaces';

const wasmPath = createRequire(import.meta.url).resolve(
  'jolt-physics/jolt-physics.wasm.wasm',
);
const worlds: IPhysicsWorld[] = [];
const surfaceResolvers: SurfaceResolver[] = [];
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
  const ground = {
    center: { x: 0, y: -0.5, z: 0 },
    halfExtents: { x: 5000, y: 0.5, z: 5000 },
    rotY: 0,
  };
  const groundBody = world.createStaticBox(ground.center, ground.halfExtents);
  const surfaceResolver = createTrackSurfaceResolver({
    bodies: { ground: groundBody, barriers: [] },
    groundSurfaceId: SURFACE_IDS.asphalt,
    ground,
    kerbFootprint: () => false,
  });
  surfaceResolvers.push(surfaceResolver);
  const tuning = new TuningStore();
  tuning.set('physicsHz', hz);
  const vehicle = new Vehicle(
    world,
    tuning,
    { x: 0, y: 1, z: 0 },
    surfaceResolver,
  );
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
  for (const resolver of surfaceResolvers) resolver.dispose();
  surfaceResolvers.length = 0;
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
  const tireCapacity =
    vehicle.telemetry.wheels.reduce(
      (sum, wheel) => sum + wheel.mu * wheel.Fz,
      0,
    ) / 1300;
  // Coupling < 1 intentionally permits extra combined force (PM ellipse ruling).
  expect(Math.abs(vehicle.telemetry.lateralAcceleration)).toBeLessThan(
    tireCapacity * Math.sqrt(2 - 0.85) + 1,
  );
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

it('Raw applies exactly zero handling-assist yaw torque even beyond the drift limit', async () => {
  const { world, tuning, vehicle, step } = await setup();
  tuning.set('countersteerAssist', 0);
  tuning.set('yawAssist', 0);
  world.setLinearVelocity(vehicle.body, { x: 40, y: 0, z: -10 });
  step({ ...idle, throttle: 1, steer: 1 });
  expect(vehicle.telemetry.groundedWheels).toBe(4);
  expect(vehicle.telemetry.yawAssistTorque).toBe(0);
  expect(vehicle.drift.side).toBe(0);
});

it('keeps equivalent launch behavior at 60, 120 and 240 Hz', async () => {
  const speeds: number[] = [];
  for (const hz of [60, 120, 240]) {
    const { vehicle, step } = await setup(hz);
    step({ ...idle, throttle: 1 }, hz * 3);
    speeds.push(vehicle.telemetry.vLong);
    expect(vehicle.telemetry.groundedWheels).toBe(4);
    expect(vehicle.telemetry.recoveryCount).toBe(0);
  }
  expect(Math.max(...speeds) - Math.min(...speeds)).toBeLessThan(0.5);
});

it('repeats a seeded 300-second input sequence with bounded finite state', async () => {
  const hashes: string[] = [];
  const means: number[] = [];
  let maxAngularSpeed = 0;
  const bits = new DataView(new ArrayBuffer(8));
  for (let run = 0; run < 2; run++) {
    const { vehicle, step } = await setup();
    let seed = 0x51a7,
      hash = 2166136261;
    const input = { ...idle };
    function random() {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x100000000;
    }
    let measuredMs = 0;
    for (let i = 0; i < 36000; i++) {
      if (i % 60 === 0) {
        input.throttle = random();
        input.brake = random() > 0.8 ? random() : 0;
        input.steer = 2 * random() - 1;
        input.handbrake = random() > 0.9;
        input.boost = random() > 0.8;
      }
      const started = performance.now();
      step(input);
      measuredMs += performance.now() - started;
      const s = vehicle.telemetry;
      if (
        !Number.isFinite(
          s.speed + s.position.x + s.position.y + s.position.z,
        ) ||
        s.recoveryCount !== 0
      ) {
        throw new Error('Non-finite vehicle state at seeded step ' + i);
      }
      maxAngularSpeed = Math.max(maxAngularSpeed, s.angularVelocity.length());
      for (const value of [
        s.position.x,
        s.position.y,
        s.position.z,
        s.rotation.x,
        s.rotation.y,
        s.rotation.z,
        s.rotation.w,
        s.velocity.x,
        s.velocity.y,
        s.velocity.z,
        s.angularVelocity.x,
        s.angularVelocity.y,
        s.angularVelocity.z,
        s.boostMeter,
        s.boostEnvelope,
        s.driftTarget,
        vehicle.drift.betaDot,
      ]) {
        bits.setFloat64(0, value, true);
        hash = Math.imul(hash ^ bits.getUint32(0, true), 16777619) >>> 0;
        hash = Math.imul(hash ^ bits.getUint32(4, true), 16777619) >>> 0;
      }
    }
    hashes.push(hash.toString(16));
    means.push(measuredMs / 36000);
  }
  expect(hashes[0]).toBe(hashes[1]);
  expect(maxAngularSpeed).toBeLessThanOrEqual(12.0001);
  mkdirSync('scratch', { recursive: true });
  writeFileSync(
    'scratch/vehicle-soak.json',
    JSON.stringify(
      {
        simulatedSecondsPerRun: 300,
        stepsPerRun: 36000,
        hashes,
        meanModelAndPhysicsMs: means,
        maxAngularSpeed,
        scope:
          'exact float-bit hashes, same binary, same machine; Node with stock single-thread WASM',
      },
      null,
      2,
    ),
  );
}, 90000);

it('recovers a non-finite returned state and resets derivative/filter history', async () => {
  const { world, vehicle, step } = await setup();
  step({ ...idle, throttle: 1 }, 30);
  vehicle.setDriftMeter(1);
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(world, 'getLinearVelocity').mockImplementationOnce((_body, out) => {
    out.x = NaN;
    out.y = out.z = 0;
  });
  vehicle.postStep(1 / 120);
  expect(vehicle.telemetry.recoveryCount).toBe(1);
  expect(vehicle.telemetry.position.y).toBeCloseTo(1);
  expect(vehicle.telemetry.speed).toBe(0);
  expect(vehicle.controls.throttle).toBe(0);
  expect(vehicle.drift.side).toBe(0);
  expect(vehicle.telemetry.boostMeter).toBe(0);
  expect(error).toHaveBeenCalledOnce();
  error.mockRestore();
});

it('measures default 0-100 km/h and 0-55 m/s on the actual suspended vehicle', async () => {
  const { vehicle, step } = await setup();
  let steps = 0,
    to100 = 0;
  const input = { ...idle, throttle: 1 };
  while (vehicle.telemetry.speed < 55 && steps < 1800) {
    step(input);
    steps++;
    if (!to100 && vehicle.telemetry.speed >= 100 / 3.6) to100 = steps / 120;
  }
  const to55 = steps / 120;
  mkdirSync('scratch', { recursive: true });
  writeFileSync(
    'scratch/vehicle-acceleration.json',
    JSON.stringify(
      {
        physicsHz: 120,
        zeroTo100KmhSeconds: to100,
        zeroTo55MsSeconds: to55,
        mass: vehicle.currentMass,
        speedAtEnd: vehicle.telemetry.speed,
        groundedWheels: vehicle.telemetry.groundedWheels,
        scope:
          'default tuning, real Jolt vehicle, throttle filtering and tire traction enabled; simulated seconds after settled spawn',
      },
      null,
      2,
    ),
  );
  expect(to100).toBeGreaterThanOrEqual(2);
  expect(to100).toBeLessThanOrEqual(2.3);
  expect(to55).toBeGreaterThanOrEqual(6.3);
  expect(to55).toBeLessThanOrEqual(7.1);
}, 30000);
