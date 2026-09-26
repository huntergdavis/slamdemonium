/* NS2 probe, part three: the real car through a sleeping field and into a heap.
 * Uses the script vehicle harness (real Vehicle, flat plane) with pooled
 * 15 kg boxes added the way the streamer would under the resident-asleep
 * route: placed at rest and put to sleep before the car arrives. */
import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { activeBodies } from './joltProbe';
import { scriptVehicleHarness } from '../../../tests/scriptVehicleHarness';
import type { BodyId } from '../../../src/physics/adapter';
import { SURFACE_IDS } from '../../../src/content/surfaces';

const DESC = {
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
  surface: SURFACE_IDS.concrete,
};
const Q = { x: 0, y: 0, z: 0, w: 1 };
function stats(samples: number[]) {
  const s = [...samples].sort((a, b) => a - b);
  const q = (f: number) => s[Math.min(s.length - 1, Math.floor(f * s.length))]!;
  return {
    n: s.length,
    avg: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(4),
    p50: +q(0.5).toFixed(4),
    p95: +q(0.95).toFixed(4),
    p99: +q(0.99).toFixed(4),
    max: +q(1).toFixed(4),
  };
}
const PAD = {
  brake: 0,
  steer: 0,
  handbrake: false,
  boost: false,
  source: 'gamepad' as const,
};

/** Field: `count` boxes scattered in a 40 m wide lane over `length` m ahead of the spawn line at z=0 (car spawns at z=-80 driving +z), plus one heap of `heap` boxes at z = length/2 dead ahead. All sleep before the run. */
async function drive(count: number, heap: number, speed: number, length = 400) {
  const rig = await scriptVehicleHarness({ flatPlane: true });
  const { vehicle, loop, setPad, surfacedBodies, world } = rig;
  const s = vehicle.telemetry;
  let seed = 11;
  const rnd = () =>
    (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const ids: BodyId[] = [];
  for (let i = 0; i < count; i++) {
    const id = surfacedBodies.createPooledBox(DESC);
    ids.push(id);
    surfacedBodies.activate(
      id,
      { x: rnd() * 40 - 20, y: 0.5, z: rnd() * length },
      Q,
    );
  }
  for (let j = 0; j < heap; j++) {
    const id = surfacedBodies.createPooledBox(DESC);
    ids.push(id);
    const layer = Math.floor(j / 16),
      r = j % 16;
    surfacedBodies.activate(
      id,
      { x: -1.5 + (r % 4), y: 0.5 + layer, z: length / 2 + Math.floor(r / 4) },
      Q,
    );
  }
  // Let everything settle and sleep (car stationary at spawn).
  vehicle.respawn({ x: 0, y: 0.86, z: -80 }, { x: 0, y: 1, z: 0, w: 0 });
  for (let i = 0; i < 240; i++) loop.stepMany(1);
  const asleep = activeBodies();
  // Drive through at speed.
  world.setLinearVelocity(vehicle.body, { x: 0, y: 0, z: speed });
  setPad({ ...PAD, throttle: 1 });
  const samples: number[] = [];
  const active: number[] = [];
  const zs: number[] = [];
  const steps = Math.ceil(((length + 100) / speed) * 120);
  for (let step = 0; step < steps; step++) {
    const t0 = performance.now();
    loop.stepMany(1);
    samples.push(performance.now() - t0);
    if (step % 60 === 0) {
      active.push(activeBodies());
      zs.push(Math.round(s.position.z));
    }
  }
  setPad({ ...PAD, throttle: 0 });
  const after: number[] = [];
  const activeAfter: number[] = [];
  for (let step = 0; step < 600; step++) {
    const t0 = performance.now();
    loop.stepMany(1);
    after.push(performance.now() - t0);
    if (step % 120 === 0) activeAfter.push(activeBodies());
  }
  rig.dispose();
  return {
    scenario: `car at ${speed} m/s through ${count} sleeping boxes over ${length} m and a heap of ${heap}`,
    awakeBeforeRun: asleep,
    activeEvery60: active,
    carZEvery60: zs,
    drive: stats(samples),
    hitsAndSettling: stats(
      samples.filter(
        (_, i) => zs.length && (i / 120) * speed > length / 2 - 30 - 80,
      ),
    ),
    after5s: stats(after.slice(0, 300)),
    afterActive: activeAfter,
    recoveries: s.recoveryCount,
  };
}

it('NS2 car pileup probe', async () => {
  const filter = process.env.PROBE_FILTER ?? '';
  const cases: Array<[string, () => Promise<unknown>]> = [
    ['carBaseline', () => drive(0, 0, 30)],
    ['car-field256-30', () => drive(256, 0, 30)],
    ['car-field1024-30', () => drive(1024, 0, 30)],
    ['car-field1024-60', () => drive(1024, 0, 60)],
    ['car-heap64-30', () => drive(0, 64, 30)],
    ['car-heap128-30', () => drive(0, 128, 30)],
    ['car-field1024-heap64-40', () => drive(1024, 64, 40)],
  ];
  const results: unknown[] = [];
  for (const [name, fn] of cases) {
    if (filter && !name.includes(filter)) continue;
    const r = await fn();
    results.push({ name, ...(r as object) });
    console.log(name, JSON.stringify(r));
  }
  writeFileSync(
    'scratch/car-pileup-probe.json',
    JSON.stringify(results, null, 1),
  );
}, 3_600_000);
