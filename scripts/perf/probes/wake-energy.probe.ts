/* Flip investigation (2026-09-27): can a woken body leave its first awake
 * steps with more energy than it had when it slept? Heaps of props (1 m,
 * 15 kg) or debris (0.4 m, 4 kg) are dropped and then slept three ways:
 * naturally (Jolt's own timer), or as a block via sleepBody 0.5 s or 1 s
 * after the drop while still creeping (route B's lever). A slow toucher
 * (1 m/s, 7.5 J for a prop) wakes the heap; the heap's kinetic energy in
 * the steps after is compared with that input. Then the real car drives
 * into the same heaps over several seeds and its roll is recorded. */
import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { createRequire } from 'node:module';
import { createPhysicsWorld } from '../../../src/physics/joltWorld';
import type { BodyId, IPhysicsWorld } from '../../../src/physics/adapter';
import { scriptVehicleHarness } from '../../../tests/scriptVehicleHarness';
import { SURFACE_IDS } from '../../../src/content/surfaces';

const wasmPath = createRequire(import.meta.url).resolve(
  'jolt-physics/jolt-physics.wasm.wasm',
);
const DT = 1 / 120;
const PROP = {
  motion: 'dynamic' as const,
  halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
  mass: 15,
  comOffset: { x: 0, y: 0, z: 0 },
  inertiaScale: { x: 1, y: 1, z: 1 },
  friction: 0.6,
  restitution: 0.2,
  ccd: false,
  maxAngularVelocity: 30,
  angularDamping: 0.1,
};
const DEBRIS = { ...PROP, halfExtents: { x: 0.2, y: 0.2, z: 0.2 }, mass: 4 };
const Q = { x: 0, y: 0, z: 0, w: 1 };
type Kind = 'prop' | 'debris';
type Sleep = 'natural' | 'block0.5' | 'block1';

function rng(seed: number) {
  let s = seed;
  return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
}
function ke(world: IPhysicsWorld, ids: BodyId[], mass: number) {
  const v = { x: 0, y: 0, z: 0 };
  let total = 0;
  let maxSpeed = 0;
  for (const id of ids) {
    world.getLinearVelocity(id, v);
    const s2 = v.x * v.x + v.y * v.y + v.z * v.z;
    total += 0.5 * mass * s2;
    maxSpeed = Math.max(maxSpeed, Math.sqrt(s2));
  }
  return { ke: +total.toFixed(2), maxSpeed: +maxSpeed.toFixed(3) };
}
/** Drops `count` boxes into a column at (cx, cz) and returns their ids. */
function dropHeap(
  world: IPhysicsWorld,
  kind: Kind,
  count: number,
  seed: number,
  cx = 0,
  cz = 0,
) {
  const desc = kind === 'prop' ? PROP : DEBRIS;
  const size = desc.halfExtents.y * 2;
  const rnd = rng(seed);
  const ids: BodyId[] = [];
  const radius = kind === 'prop' ? 4 : 2.5;
  for (let i = 0; i < count; i++) {
    const id = world.createPooledBox(desc);
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * radius;
    world.activateBody(
      id,
      {
        x: cx + Math.cos(a) * r,
        y: size / 2 + 0.5 + (rnd() * (count * size)) / 10,
        z: cz + Math.sin(a) * r,
      },
      Q,
    );
    ids.push(id);
  }
  return ids;
}
function sleepAll(world: IPhysicsWorld, ids: BodyId[]) {
  for (const id of ids) world.sleepBody(id);
}

async function wakeEnergy(
  kind: Kind,
  count: number,
  sleep: Sleep,
  seed: number,
) {
  const world = await createPhysicsWorld({ wasmPath });
  world.createStaticBox({ x: 0, y: -0.5, z: 0 }, { x: 500, y: 0.5, z: 500 });
  const ids = dropHeap(world, kind, count, seed);
  const mass = kind === 'prop' ? PROP.mass : DEBRIS.mass;
  const settleSteps =
    sleep === 'block0.5' ? 60 : sleep === 'block1' ? 120 : 1200;
  for (let i = 0; i < settleSteps; i++) world.step(DT);
  const beforeSleep = ke(world, ids, mass);
  if (sleep !== 'natural') sleepAll(world, ids);
  // Give a natural sleep time to finish; blocks are already down.
  for (let i = 0; i < 120; i++) world.step(DT);
  const awakeBefore = world.awakeBodyCount();
  const asleepKe = ke(world, ids, mass);
  // A slow toucher: one more box of the same kind dropped from 0.05 m above the top, 1 m/s.
  const toucher = world.createPooledBox(kind === 'prop' ? PROP : DEBRIS);
  const size = (kind === 'prop' ? PROP : DEBRIS).halfExtents.y * 2;
  let top = 0;
  const p = { x: 0, y: 0, z: 0 };
  for (const id of ids) {
    world.getTransform(id, p, { x: 0, y: 0, z: 0, w: 1 });
    top = Math.max(top, p.y);
  }
  world.activateBody(toucher, { x: 0, y: top + size + 0.05, z: 0 }, Q);
  world.setLinearVelocity(toucher, { x: 0, y: -1, z: 0 });
  const inputKe = 0.5 * mass * 1;
  const after: Record<string, unknown> = {};
  const awake: number[] = [];
  let peak = { ke: 0, maxSpeed: 0, step: 0 };
  for (let step = 1; step <= 120; step++) {
    world.step(DT);
    const k = ke(world, ids, mass);
    if (k.ke > peak.ke) peak = { ...k, step };
    if ([1, 2, 3, 5, 10, 30, 120].includes(step)) {
      after['step' + step] = k;
      awake.push(world.awakeBodyCount());
    }
  }
  world.dispose();
  return {
    kind,
    count,
    sleep,
    seed,
    beforeSleep,
    awakeBefore,
    asleepKe,
    inputKe,
    after,
    awakeAtSamples: awake,
    peak,
    energyRatio: +(peak.ke / inputKe).toFixed(1),
  };
}

/** The real car at speed into a heap slept each way; roll and recoveries. */
async function carIntoHeap(
  kind: Kind,
  count: number,
  sleep: Sleep,
  seed: number,
  speed: number,
) {
  const rig = await scriptVehicleHarness({ flatPlane: true });
  const { vehicle, loop, world, surfacedBodies, setPad } = rig;
  const s = vehicle.telemetry;
  vehicle.respawn({ x: 0, y: 0.86, z: -60 }, { x: 0, y: 1, z: 0, w: 0 });
  const desc = {
    ...(kind === 'prop' ? PROP : DEBRIS),
    surface: SURFACE_IDS.concrete,
  };
  const rnd = rng(seed);
  const ids: BodyId[] = [];
  const size = desc.halfExtents.y * 2;
  const radius = kind === 'prop' ? 4 : 2.5;
  for (let i = 0; i < count; i++) {
    const id = surfacedBodies.createPooledBox(desc);
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * radius;
    surfacedBodies.activate(
      id,
      {
        x: Math.cos(a) * r,
        y: size / 2 + 0.5 + (rnd() * (count * size)) / 10,
        z: Math.sin(a) * r,
      },
      Q,
    );
    ids.push(id);
  }
  const settleSteps =
    sleep === 'block0.5' ? 60 : sleep === 'block1' ? 120 : 1200;
  for (let i = 0; i < settleSteps; i++) loop.stepMany(1);
  if (sleep !== 'natural') sleepAll(world, ids);
  for (let i = 0; i < 120; i++) loop.stepMany(1);
  world.setLinearVelocity(vehicle.body, { x: 0, y: 0, z: speed });
  setPad({
    brake: 0,
    steer: 0,
    handbrake: false,
    boost: false,
    source: 'gamepad',
    throttle: 1,
  });
  let maxRoll = 0,
    maxUp = 0,
    maxStep = 0;
  const up = { x: 0, y: 0, z: 0 };
  const v = { x: 0, y: 0, z: 0 };
  for (let step = 0; step < 480; step++) {
    const t0 = performance.now();
    loop.stepMany(1);
    maxStep = Math.max(maxStep, performance.now() - t0);
    const q = s.rotation;
    // Body up vector from the quaternion.
    up.x = 2 * (q.x * q.y - q.w * q.z);
    up.y = 1 - 2 * (q.x * q.x + q.z * q.z);
    up.z = 2 * (q.y * q.z + q.w * q.x);
    const roll = (Math.acos(Math.max(-1, Math.min(1, up.y))) * 180) / Math.PI;
    maxRoll = Math.max(maxRoll, roll);
    world.getLinearVelocity(vehicle.body, v);
    maxUp = Math.max(maxUp, v.y);
  }
  const out = {
    kind,
    count,
    sleep,
    seed,
    speed,
    maxTiltDeg: +maxRoll.toFixed(1),
    maxCarUpSpeed: +maxUp.toFixed(2),
    recoveries: s.recoveryCount,
    landings: s.landingCount,
    maxStepMs: +maxStep.toFixed(2),
  };
  rig.dispose();
  return out;
}

it('flip investigation: wake energy and car into slept heaps', async () => {
  const filter = process.env.PROBE_FILTER ?? '';
  const results: Record<string, unknown[]> = {
    wakeEnergy: [],
    carIntoHeap: [],
  };
  if (!filter || filter.includes('wake')) {
    for (const kind of ['prop', 'debris'] as Kind[])
      for (const sleep of ['natural', 'block0.5', 'block1'] as Sleep[])
        for (const seed of [1, 2, 3]) {
          const count = kind === 'prop' ? 64 : 256;
          const r = await wakeEnergy(kind, count, sleep, seed);
          results.wakeEnergy!.push(r);
          console.log(JSON.stringify(r));
        }
  }
  if (!filter || filter.includes('car')) {
    for (const kind of ['prop', 'debris'] as Kind[])
      for (const sleep of ['natural', 'block0.5', 'awake'] as (
        Sleep | 'awake'
      )[])
        for (const seed of [1, 2, 3, 4, 5, 6]) {
          const count = kind === 'prop' ? 48 : 192;
          const r = await carIntoHeap(
            kind,
            count,
            sleep === 'awake' ? 'natural' : sleep,
            seed,
            30,
          );
          if (sleep === 'awake') r.sleep = 'natural' as Sleep; // Same as natural here; kept for the row.
          results.carIntoHeap!.push(r);
          console.log(JSON.stringify(r));
        }
  }
  writeFileSync(
    'scratch/wake-energy-probe.json',
    JSON.stringify(results, null, 1),
  );
}, 3_600_000);
