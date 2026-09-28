/* NS2 probe, part two: the resident-asleep route and promotion churn.
 * Run: PROBE_FILTER=<name> npx vitest run --config vitest.probes.config.ts asleep */
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { activeBodies, joltProbe } from './joltProbe';
import { createPhysicsWorld } from '../../../src/physics/joltWorld';
import type { BodyId } from '../../../src/physics/adapter';

const wasmPath = createRequire(import.meta.url).resolve(
  'jolt-physics/jolt-physics.wasm.wasm',
);
const DT = 1 / 120;
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
};
const Q = { x: 0, y: 0, z: 0, w: 1 };
/** The raw Jolt body id behind an adapter handle: the adapter keeps a record map; we reach it through the body interface by position, so instead we sleep bodies via the physics system's body interface using the adapter's own numbering. */
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

async function world() {
  const w = await createPhysicsWorld({ wasmPath });
  w.createStaticBox({ x: 0, y: -0.5, z: 0 }, { x: 5000, y: 0.5, z: 5000 });
  return w;
}
function gridPos(i: number, count: number, spacing: number, y = 0.5) {
  const side = Math.ceil(Math.sqrt(count));
  return {
    x: ((i % side) - side / 2) * spacing,
    y,
    z: (Math.floor(i / side) - side / 2) * spacing,
  };
}

/** Resident and asleep: activate (awake), let them settle and sleep, then measure the resting cost with N dynamic bodies in the simulation. Compare with the same N added static. */
async function resident(n: number, kind: 'dynamic' | 'static') {
  const w = await world();
  const ids: BodyId[] = [];
  for (let i = 0; i < n; i++)
    ids.push(
      w.createPooledBox(
        kind === 'static'
          ? { motion: 'static', halfExtents: DESC.halfExtents, friction: 0.6 }
          : DESC,
      ),
    );
  for (let i = 0; i < n; i++) w.activateBody(ids[i]!, gridPos(i, n, 3), Q);
  const samples: number[] = [];
  const active: number[] = [];
  for (let step = 0; step < 480; step++) {
    const t0 = performance.now();
    w.step(DT);
    samples.push(performance.now() - t0);
    if (step % 120 === 0) active.push(activeBodies());
  }
  w.dispose();
  return {
    scenario: `resident ${kind} ${n}`,
    bodies: n,
    active,
    wake0_60: stats(samples.slice(0, 60)),
    rest240_480: stats(samples.slice(240)),
  };
}
/** Promotion churn as the car drives: every `interval` steps one more body is activated awake at rest on the ground (as the streamer does today) and the oldest is removed; a rolling window of `window` live bodies. Cost is what the promotion rate itself costs, with nothing touching anything. */
async function churn(promotionsPerSecond: number, windowSize = 128) {
  const w = await world();
  const total = 2000;
  const ids: BodyId[] = [];
  for (let i = 0; i < total; i++) ids.push(w.createPooledBox(DESC));
  const interval = 120 / promotionsPerSecond;
  let next = 0,
    oldest = 0,
    acc = 0;
  const samples: number[] = [];
  const active: number[] = [];
  for (let step = 0; step < 720; step++) {
    acc += 1;
    while (acc >= interval && next < total) {
      acc -= interval;
      w.activateBody(ids[next]!, gridPos(next, total, 3), Q);
      next++;
      if (next - oldest > windowSize) {
        w.deactivateBody(ids[oldest]!);
        oldest++;
      }
    }
    const t0 = performance.now();
    w.step(DT);
    samples.push(performance.now() - t0);
    if (step % 120 === 0) active.push(activeBodies());
  }
  w.dispose();
  return {
    scenario: `promotion churn ${promotionsPerSecond}/s, window ${windowSize}`,
    promotionsPerSecond,
    active,
    steady240_720: stats(samples.slice(240)),
  };
}
/** Same churn but each promoted body is put to sleep the step after it is added (the resident-asleep route): the streamer would add with DontActivate. */
async function churnAsleep(promotionsPerSecond: number, windowSize = 128) {
  const w = await world();
  const p = joltProbe();
  const total = 2000;
  const ids: BodyId[] = [];
  for (let i = 0; i < total; i++) ids.push(w.createPooledBox(DESC));
  const interval = 120 / promotionsPerSecond;
  let next = 0,
    oldest = 0,
    acc = 0;
  const samples: number[] = [];
  const active: number[] = [];
  // Body ids: the adapter numbers handles; Jolt ids are reachable through GetBodies? Not exposed. Instead sleep everything active each step via DeactivateBody on the active set: not available either. So: put all bodies to sleep by setting the sleep timer short.
  if (p) {
    const ps = p.physics.GetPhysicsSettings();
    ps.mTimeBeforeSleep = 0.05;
    p.physics.SetPhysicsSettings(ps);
  }
  for (let step = 0; step < 720; step++) {
    acc += 1;
    while (acc >= interval && next < total) {
      acc -= interval;
      w.activateBody(ids[next]!, gridPos(next, total, 3), Q);
      next++;
      if (next - oldest > windowSize) {
        w.deactivateBody(ids[oldest]!);
        oldest++;
      }
    }
    const t0 = performance.now();
    w.step(DT);
    samples.push(performance.now() - t0);
    if (step % 120 === 0) active.push(activeBodies());
  }
  w.dispose();
  return {
    scenario: `promotion churn ${promotionsPerSecond}/s, window ${windowSize}, sleep after 0.05 s`,
    promotionsPerSecond,
    active,
    steady240_720: stats(samples.slice(240)),
  };
}
/** Does a sleeping island wake when hit? 64 touching boxes settle and sleep; then one box is fired into them at 30 m/s. */
async function wakeOnHit() {
  const w = await world();
  const ids: BodyId[] = [];
  const k = 64;
  for (let i = 0; i < k + 1; i++) ids.push(w.createPooledBox(DESC));
  for (let j = 0; j < k; j++) {
    const layer = Math.floor(j / 16),
      r = j % 16;
    w.activateBody(
      ids[j]!,
      { x: r % 4, y: 0.5 + layer, z: Math.floor(r / 4) },
      Q,
    );
  }
  const samples: number[] = [];
  const active: number[] = [];
  for (let step = 0; step < 480; step++) {
    const t0 = performance.now();
    w.step(DT);
    samples.push(performance.now() - t0);
    if (step % 60 === 0) active.push(activeBodies());
  }
  const asleepCost = stats(samples.slice(240));
  w.activateBody(ids[k]!, { x: -6, y: 0.5, z: 1.5 }, Q);
  w.setLinearVelocity(ids[k]!, { x: 30, y: 0, z: 0 });
  const after: number[] = [];
  const activeAfter: number[] = [];
  for (let step = 0; step < 480; step++) {
    const t0 = performance.now();
    w.step(DT);
    after.push(performance.now() - t0);
    if (step % 30 === 0) activeAfter.push(activeBodies());
  }
  w.dispose();
  return {
    scenario: 'sleeping island of 64 hit by one box at 30 m/s',
    activeBeforeEvery60: active,
    asleepCost,
    activeAfterEvery30: activeAfter,
    hit0_120: stats(after.slice(0, 120)),
    hit120_480: stats(after.slice(120)),
  };
}

it('NS2 asleep-resident and churn probe', async () => {
  const filter = process.env.PROBE_FILTER ?? '';
  const cases: Array<[string, () => Promise<unknown>]> = [
    ['warmup', () => resident(64, 'dynamic')],
  ];
  for (const n of [128, 512, 1024, 2048, 4096, 7000])
    cases.push([`resident-dyn${n}`, () => resident(n, 'dynamic')]);
  for (const n of [1024, 4096, 7000])
    cases.push([`resident-static${n}`, () => resident(n, 'static')]);
  for (const r of [10, 30, 60, 120, 240]) {
    cases.push([`churn${r}`, () => churn(r)]);
    cases.push([`churnAsleep${r}`, () => churnAsleep(r)]);
  }
  cases.push(['wakeOnHit', wakeOnHit]);
  const results: unknown[] = [];
  for (const [name, fn] of cases) {
    if (filter && !name.includes(filter) && name !== 'warmup') continue;
    const r = await fn();
    if (name !== 'warmup') {
      results.push({ name, ...(r as object) });
      console.log(name, JSON.stringify(r));
    }
  }
  writeFileSync('scratch/asleep-probe.json', JSON.stringify(results, null, 1));
}, 3_600_000);
