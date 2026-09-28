/* NS2 cost probe: the 10 km circuit's records through the real pools, props
 * and streamer while the car is carried round one lap at 60 m/s (its body
 * moved each step along the centreline), with the awake budget on. Reports
 * creation times, WASM memory before and after, per-step cost through the
 * lap and the worst step, plus the instance counts the renderer would draw. */
import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { scriptVehicleHarness } from '../../../tests/scriptVehicleHarness';
import { createAwakeBudget } from '../../../src/world/awakeBudget';
import { createPropPools } from '../../../src/world/bodyPool';
import {
  createBreakableProps,
  MAX_RESIDENT_BREAKABLES,
} from '../../../src/world/breakableProps';
import { createCircuitMap } from '../../../src/world/circuit';
import {
  createPropStreamer,
  createPropStreamRecords,
} from '../../../src/world/propStreaming';
import { poseAt } from '../../../src/world/roadGenerator';
import { runwayInstances } from '../../../src/world/runways';
import {
  DEFAULT_TRACK_CONFIG,
  resolveTrackConfig,
} from '../../../src/world/trackConfig';
import { createBarrierDescriptors } from '../../../src/world/trackPhysics';

function stats(samples: number[]) {
  const s = [...samples].sort((a, b) => a - b);
  const q = (f: number) => s[Math.min(s.length - 1, Math.floor(f * s.length))]!;
  return {
    n: s.length,
    avg: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(4),
    p50: +q(0.5).toFixed(4),
    p99: +q(0.99).toFixed(4),
    max: +q(1).toFixed(4),
  };
}

it('NS2 circuit cost probe', async () => {
  const t0 = performance.now();
  const map = createCircuitMap();
  const mapMs = performance.now() - t0;
  const t1 = performance.now();
  const records = createPropStreamRecords(map.placements, 32);
  const recordsMs = performance.now() - t1;
  const config = resolveTrackConfig(map.track);
  const counts = {
    records: records.length,
    cells: new Set(records.map((r) => r.cellId)).size,
    lanes: map.runways.length,
    paintInstances: runwayInstances(map.runways, DEFAULT_TRACK_CONFIG).length,
    barrierBoxes: createBarrierDescriptors(config).length,
    ramps: map.ramps.length,
    loops: map.loops.length,
    halfPipes: map.halfPipes.length,
    pads: map.boostPads.length,
    gates: map.runs![0]!.gates.length,
    lapMetres: +map.path.length.toFixed(1),
  };
  const rig = await scriptVehicleHarness({ flatPlane: true });
  const { vehicle, loop, world, surfacedBodies } = rig;
  const memory = { heapBytes: 0, freeBytes: 0 };
  world.getMemoryStats(memory);
  const memBefore = { ...memory };
  const t2 = performance.now();
  const pools = createPropPools(surfacedBodies);
  const poolsMs = performance.now() - t2;
  const props = createBreakableProps({
    physics: world,
    pools,
    placements: map.placements,
    vehicleBody: vehicle.body,
    onBreak: () => {},
    initialActiveIndices: [],
    maxActiveProps: MAX_RESIDENT_BREAKABLES,
  });
  const s = vehicle.telemetry;
  const t3 = performance.now();
  const streamer = createPropStreamer({
    props,
    records,
    readVehiclePosition: (out) => Object.assign(out, s.position),
    maxPromoted: MAX_RESIDENT_BREAKABLES,
    enterRadius: 90,
    exitRadius: 130,
  });
  const streamerMs = performance.now() - t3;
  const budget = createAwakeBudget({
    physics: world,
    props,
    readVehiclePosition: (out) => Object.assign(out, s.position),
  });
  world.getMemoryStats(memory);
  const memAfterBoot = { ...memory };
  // One lap at 60 m/s: the body is carried along the centreline each step.
  const speed = 60;
  const dt = 1 / 120;
  const samples: number[] = [];
  const promoted: number[] = [];
  const awake: number[] = [];
  let station = 0;
  let steps = 0;
  const rot = { x: 0, y: 0, z: 0, w: 1 };
  while (station < map.path.length) {
    const pose = poseAt(map.path, station);
    rot.y = Math.sin(pose.heading / 2);
    rot.w = Math.cos(pose.heading / 2);
    world.setTransform(
      vehicle.body,
      { x: pose.x, y: 0.86, z: pose.z },
      rot,
      true,
    );
    const t = performance.now();
    loop.stepMany(1);
    streamer.update();
    budget.update(96, 30);
    samples.push(performance.now() - t);
    station += speed * dt;
    steps++;
    if (steps % 1200 === 0) {
      promoted.push(
        records.reduce((n, _r, i) => n + (streamer.isPromoted(i) ? 1 : 0), 0),
      );
      awake.push(world.awakeBodyCount());
    }
  }
  world.getMemoryStats(memory);
  const memAfterLap = { ...memory };
  const out = {
    counts,
    bootMs: {
      map: +mapMs.toFixed(1),
      records: +recordsMs.toFixed(1),
      pools: +poolsMs.toFixed(1),
      streamer: +streamerMs.toFixed(1),
    },
    memory: {
      before: memBefore,
      afterBoot: memAfterBoot,
      afterLap: memAfterLap,
    },
    lap: {
      steps,
      seconds: +(steps * dt).toFixed(1),
      step: stats(samples),
      promotedEvery10s: promoted,
      awakeEvery10s: awake,
    },
  };
  console.log(JSON.stringify(out));
  writeFileSync('scratch/track-probe.json', JSON.stringify(out, null, 1));
  streamer.dispose();
  props.dispose();
  pools.dispose();
  rig.dispose();
}, 3_600_000);
