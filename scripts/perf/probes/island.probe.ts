/* NS2 ceiling probe: what a contact island costs on the real Jolt build.
 * Run: PROBE_FILTER=<name> npx vitest run --config vitest.probes.config.ts island
 * Every scenario is a fresh world (flat ground + pooled 15 kg 1 m boxes, the
 * breakable descriptor from bodyPool.ts), stepped at 120 Hz; per-step wall
 * time is measured around world.step only. */
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { activeBodies, joltProbe } from './joltProbe';
import { createPhysicsWorld } from '../../../src/physics/joltWorld';
import type { BodyId, IPhysicsWorld } from '../../../src/physics/adapter';

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

interface Settings {
  velocitySteps?: number;
  positionSteps?: number;
  timeBeforeSleep?: number;
  manifoldReduction?: boolean;
}
function applySettings(s: Settings) {
  const p = joltProbe();
  if (!p) return { skipped: 'no __joltProbe hook', requested: s };
  const { physics } = p;
  const ps = physics.GetPhysicsSettings();
  if (s.velocitySteps !== undefined) ps.mNumVelocitySteps = s.velocitySteps;
  if (s.positionSteps !== undefined) ps.mNumPositionSteps = s.positionSteps;
  if (s.timeBeforeSleep !== undefined) ps.mTimeBeforeSleep = s.timeBeforeSleep;
  if (s.manifoldReduction !== undefined)
    ps.mUseManifoldReduction = s.manifoldReduction;
  physics.SetPhysicsSettings(ps);
  return {
    v: ps.mNumVelocitySteps,
    p: ps.mNumPositionSteps,
    sleep: ps.mTimeBeforeSleep,
    manifold: ps.mUseManifoldReduction,
  };
}

function stats(samples: number[]) {
  const s = [...samples].sort((a, b) => a - b);
  const q = (f: number) => s[Math.min(s.length - 1, Math.floor(f * s.length))]!;
  return {
    n: s.length,
    avg: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(4),
    p50: +q(0.5).toFixed(4),
    p95: +q(0.95).toFixed(4),
    p99: +q(0.99).toFixed(4),
    max: +s[s.length - 1]!.toFixed(4),
  };
}

interface Layout {
  name: string;
  count: number;
  place: (i: number) => { x: number; y: number; z: number };
  churn?: (world: IPhysicsWorld, ids: BodyId[], step: number) => void;
  static?: boolean;
}
function grid(count: number, spacing: number, y = 0.5): Layout {
  const side = Math.ceil(Math.sqrt(count));
  return {
    name: `separated ${count} @${spacing}m`,
    count,
    place: (i) => ({
      x: ((i % side) - side / 2) * spacing,
      y,
      z: (Math.floor(i / side) - side / 2) * spacing,
    }),
  };
}
/** m islands of k touching boxes: a compact stack, faces touching (1 m pitch), islands 20 m apart. */
function islands(k: number, m: number, churn = false): Layout {
  const sx = k >= 32 ? 4 : k >= 16 ? 4 : 2,
    sz = k >= 32 ? 4 : 2;
  const per = sx * sz;
  const l: Layout = {
    name: `${m} island${m > 1 ? 's' : ''} of ${k} touching${churn ? ', churned' : ''}`,
    count: k * m,
    place: (i) => {
      const island = Math.floor(i / k),
        j = i % k;
      const layer = Math.floor(j / per),
        r = j % per;
      return {
        x: island * 20 + (r % sx) * 1.0,
        y: 0.5 + layer * 1.0,
        z: Math.floor(r / sx) * 1.0,
      };
    },
  };
  if (churn)
    l.churn = (world, ids, step) => {
      if (step % 30 !== 0) return;
      for (let s = 0; s < m; s++) {
        const id = ids[s * k + ((step / 30) % k)]!;
        world.setLinearVelocity(id, { x: 3, y: 1, z: 2 });
      }
    };
  return l;
}
/** A pileup: count boxes dropped into a column, random yaw-free, random spots. */
function pile(count: number, radius = 4): Layout {
  let seed = 7;
  const rnd = () =>
    (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const spots = Array.from({ length: count }, () => {
    const a = rnd() * Math.PI * 2,
      r = Math.sqrt(rnd()) * radius;
    return {
      x: Math.cos(a) * r,
      y: 1.5 + rnd() * (count / 8),
      z: Math.sin(a) * r,
    };
  });
  return {
    name: `pileup ${count} dropped into r${radius} m`,
    count,
    place: (i) => spots[i]!,
  };
}
function staticGrid(count: number, spacing: number): Layout {
  const g = grid(count, spacing);
  return { ...g, name: `static ${count} @${spacing}m`, static: true };
}

interface Window {
  label: string;
  from: number;
  to: number;
}
async function run(
  layout: Layout,
  windows: Window[],
  settings: Settings = {},
  steps = 480,
) {
  const world = await createPhysicsWorld({ wasmPath });
  const applied = applySettings(settings);
  world.createStaticBox({ x: 0, y: -0.5, z: 0 }, { x: 5000, y: 0.5, z: 5000 });
  const ids: BodyId[] = [];
  for (let i = 0; i < layout.count; i++)
    ids.push(
      world.createPooledBox(
        layout.static
          ? { motion: 'static', halfExtents: DESC.halfExtents, friction: 0.6 }
          : DESC,
      ),
    );
  for (let i = 0; i < layout.count; i++)
    world.activateBody(ids[i]!, layout.place(i), Q);
  const samples: number[] = [];
  const active: number[] = [];
  for (let step = 0; step < steps; step++) {
    layout.churn?.(world, ids, step);
    const t0 = performance.now();
    world.step(DT);
    samples.push(performance.now() - t0);
    if (step % 60 === 0) active.push(activeBodies());
  }
  world.dispose();
  const out: Record<string, unknown> = {
    scenario: layout.name,
    bodies: layout.count,
    settings: applied,
    activeBodiesEvery60: active,
  };
  for (const w of windows) out[w.label] = stats(samples.slice(w.from, w.to));
  return out;
}

const W_AWAKE = { label: 'awake0-60', from: 0, to: 60 };
const W_SETTLE = { label: 'settle60-240', from: 60, to: 240 };
const W_REST = { label: 'rest240-480', from: 240, to: 480 };
const W_CHURN = { label: 'churn60-480', from: 60, to: 480 };

async function main() {
  const filter = process.env.PROBE_FILTER ?? '';
  const results: unknown[] = [];
  const cases: Array<[string, () => Promise<unknown>]> = [];
  // Warm-up (JIT + WASM), discarded.
  cases.push(['warmup', () => run(grid(64, 3), [W_AWAKE])]);
  for (const n of [64, 128, 192, 256, 384, 512, 768, 1024, 2048])
    cases.push([`sep${n}`, () => run(grid(n, 3), [W_AWAKE, W_SETTLE, W_REST])]);
  for (const n of [1024, 4096])
    cases.push([`static${n}`, () => run(staticGrid(n, 3), [W_AWAKE, W_REST])]);
  for (const k of [8, 16, 32, 64]) {
    cases.push([
      `island${k}x1`,
      () => run(islands(k, 1), [W_AWAKE, W_SETTLE, W_REST]),
    ]);
    cases.push([
      `island${k}x1churn`,
      () => run(islands(k, 1, true), [W_AWAKE, W_CHURN]),
    ]);
  }
  for (const [k, m] of [
    [8, 8],
    [16, 8],
    [8, 16],
    [16, 16],
    [32, 4],
    [32, 8],
  ] as const) {
    cases.push([
      `island${k}x${m}`,
      () => run(islands(k, m), [W_AWAKE, W_SETTLE, W_REST]),
    ]);
    cases.push([
      `island${k}x${m}churn`,
      () => run(islands(k, m, true), [W_AWAKE, W_CHURN]),
    ]);
  }
  for (const n of [32, 64, 128, 256])
    cases.push([
      `pile${n}`,
      () =>
        run(
          pile(n),
          [
            W_AWAKE,
            W_SETTLE,
            W_REST,
            { label: 'rest480-720', from: 480, to: 720 },
          ],
          {},
          720,
        ),
    ]);
  // Levers on the worst realistic island and on the pileup.
  for (const s of [
    { velocitySteps: 10, positionSteps: 2 },
    { velocitySteps: 6, positionSteps: 1 },
    { velocitySteps: 4, positionSteps: 1 },
    { velocitySteps: 2, positionSteps: 1 },
    { manifoldReduction: false },
    { manifoldReduction: true },
  ]) {
    const tag = JSON.stringify(s).replace(/[{}"]/g, '').replace(/[:,]/g, '_');
    cases.push([
      `lever-island64churn-${tag}`,
      () => run(islands(64, 1, true), [W_AWAKE, W_CHURN], s),
    ]);
    cases.push([
      `lever-pile128-${tag}`,
      () => run(pile(128), [W_AWAKE, W_SETTLE, W_REST], s),
    ]);
  }
  for (const [name, fn] of cases) {
    if (filter && !name.includes(filter) && name !== 'warmup') continue;
    const r = await fn();
    if (name === 'warmup') continue;
    results.push({ name, ...(r as object) });
    console.log(name, JSON.stringify(r));
  }
  writeFileSync('scratch/island-probe.json', JSON.stringify(results, null, 1));
}
it('NS2 island probe', async () => {
  await main();
}, 3_600_000);
