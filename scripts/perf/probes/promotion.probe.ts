/* NS2 route A verification: what boot and respawn cost through the real
 * promotion path (pools, breakable props, streamer) with a dense field
 * around the spawn, four ways: promoted awake (the old way) or asleep, and
 * all at once or spread 32 per update. */
import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { scriptVehicleHarness } from '../../../tests/scriptVehicleHarness';
import { SURFACE_IDS } from '../../../src/content/surfaces';
import { BodyPool, POOL_BUDGET } from '../../../src/world/bodyPool';
import {
  createBreakableProps,
  MAX_RESIDENT_BREAKABLES,
  type BreakablePlacement,
} from '../../../src/world/breakableProps';
import {
  createPropStreamer,
  createPropStreamRecords,
} from '../../../src/world/propStreaming';

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
function stats(samples: number[]) {
  const s = [...samples].sort((a, b) => a - b);
  const q = (f: number) => s[Math.min(s.length - 1, Math.floor(f * s.length))]!;
  return {
    n: s.length,
    avg: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(4),
    p99: +q(0.99).toFixed(4),
    max: +q(1).toFixed(4),
  };
}

/** `count` records in a 120 m square around the spawn: every one is inside
 * the 90 m promotion radius at boot. */
async function boot(count: number, asleep: boolean, perUpdate: number) {
  const rig = await scriptVehicleHarness({ flatPlane: true });
  const { vehicle, loop, surfacedBodies, world } = rig;
  vehicle.respawn({ x: 0, y: 0.86, z: 0 }, { x: 0, y: 0, z: 0, w: 1 });
  let seed = 5;
  const rnd = () =>
    (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const placements: BreakablePlacement[] = Array.from(
    { length: count },
    (_, i) => ({
      id: 'p' + i,
      position: { x: rnd() * 120 - 60, y: 0.5, z: rnd() * 120 - 60 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    }),
  ) as unknown as BreakablePlacement[];
  const created0 = performance.now();
  const breakables = new BodyPool(surfacedBodies, {
    count: POOL_BUDGET.breakables,
    asleep,
    desc: DESC,
  });
  const debris = new BodyPool(surfacedBodies, {
    count: POOL_BUDGET.debris,
    desc: { ...DESC, halfExtents: { x: 0.2, y: 0.2, z: 0.2 }, mass: 4 },
  });
  const poolMs = performance.now() - created0;
  const props = createBreakableProps({
    physics: world,
    pools: {
      breakables,
      debris,
      dispose() {
        breakables.dispose();
        debris.dispose();
      },
    },
    placements,
    vehicleBody: vehicle.body,
    onBreak: () => {},
    initialActiveIndices: [],
    maxActiveProps: MAX_RESIDENT_BREAKABLES,
  });
  const records = createPropStreamRecords(placements, 32);
  const p = vehicle.telemetry.position;
  const t0 = performance.now();
  const streamer = createPropStreamer({
    props,
    records,
    readVehiclePosition: (out) => Object.assign(out, p),
    maxPromoted: MAX_RESIDENT_BREAKABLES,
    maxPromotionsPerUpdate: perUpdate,
    enterRadius: 90,
    exitRadius: 130,
  });
  const constructMs = performance.now() - t0;
  const promoted = () =>
    records.reduce((n, _r, i) => n + (streamer.isPromoted(i) ? 1 : 0), 0);
  const stepOnce = () => {
    const t = performance.now();
    loop.stepMany(1);
    streamer.update();
    return performance.now() - t;
  };
  const bootSteps: number[] = [];
  for (let i = 0; i < 30; i++) bootSteps.push(stepOnce());
  const promotedAfterBoot = promoted();
  const awakeAfterBoot = world.awakeBodyCount();
  for (let i = 0; i < 120; i++) stepOnce();
  const idle = stats(Array.from({ length: 60 }, stepOnce));
  // Respawn: the game calls streamer.reset() (which resets props) then keeps stepping.
  const r0 = performance.now();
  streamer.reset();
  const resetMs = performance.now() - r0;
  const respawnSteps: number[] = [];
  for (let i = 0; i < 30; i++) respawnSteps.push(stepOnce());
  const out = {
    scenario: `${count} records around spawn, ${asleep ? 'asleep' : 'awake'}, ${perUpdate >= count ? 'all at once' : perUpdate + ' per update'}`,
    poolCreateMs: +poolMs.toFixed(1),
    streamerConstructMs: +constructMs.toFixed(2),
    bootFirst10Steps: bootSteps.slice(0, 10).map((v) => +v.toFixed(2)),
    bootSteps0_30: stats(bootSteps),
    promotedAfterBoot,
    awakeAfterBoot,
    idle: idle,
    resetCallMs: +resetMs.toFixed(2),
    respawnFirst10Steps: respawnSteps.slice(0, 10).map((v) => +v.toFixed(2)),
    respawnSteps0_30: stats(respawnSteps),
    promotedAfterRespawn: promoted(),
  };
  streamer.dispose();
  props.dispose();
  rig.dispose();
  return out;
}

it('NS2 route A boot and respawn probe', async () => {
  const results: unknown[] = [];
  for (const count of [300, 1000])
    for (const asleep of [false, true])
      for (const perUpdate of [1_000_000, 32]) {
        const r = await boot(count, asleep, perUpdate);
        results.push(r);
        console.log(JSON.stringify(r));
      }
  writeFileSync(
    'scratch/promotion-probe.json',
    JSON.stringify(results, null, 1),
  );
}, 3_600_000);
