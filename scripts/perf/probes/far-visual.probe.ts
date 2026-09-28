/* NS2: the far-field visual's per-frame cost over the circuit's records,
 * with the view carried round the lap. This is the one render-side cost
 * that scales with record count; draw calls do not (one instanced mesh). */
import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { MeshStandardMaterial, Scene } from 'three';
import { it } from 'vitest';
import { createStreamedPropVisual } from '../../../src/render/streamedPropVisual';
import { createCircuitMap } from '../../../src/world/circuit';
import {
  createPropStreamer,
  createPropStreamRecords,
} from '../../../src/world/propStreaming';
import { poseAt } from '../../../src/world/roadGenerator';
import type { BreakableProps } from '../../../src/world/breakableProps';

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

it('NS2 far visual cost over the circuit', () => {
  const map = createCircuitMap();
  const records = createPropStreamRecords(map.placements, 32);
  const active = new Uint8Array(map.placements.length);
  let live = 0;
  const props = {
    activate(i: number) {
      if (live >= 2048) return false;
      if (!active[i]) live++;
      active[i] = 1;
      return true;
    },
    deactivate(i: number) {
      if (active[i]) live--;
      active[i] = 0;
      return true;
    },
    isActive: (i: number) => active[i] === 1,
    isDestroyed: () => false,
    getActivePropPosition(i: number, out: { x: number; y: number; z: number }) {
      Object.assign(out, map.placements[i]!.position);
      return true;
    },
    reset() {
      active.fill(0);
      live = 0;
    },
  } as unknown as BreakableProps;
  const view = { x: 0, y: 1.5, z: 0 };
  const streamer = createPropStreamer({
    props,
    records,
    readVehiclePosition: (o) => Object.assign(o, view),
    maxPromoted: 2048,
    enterRadius: 90,
    exitRadius: 130,
  });
  const t0 = performance.now();
  const visual = createStreamedPropVisual(
    new Scene(),
    streamer,
    { x: 0.5, y: 0.5, z: 0.5 },
    new MeshStandardMaterial(),
    {
      readViewPosition: (o) => Object.assign(o, view),
      nearRadius: 90,
      farRadius: 200,
    },
  );
  const createMs = performance.now() - t0;
  visual.setFarScale(2);
  const samples: number[] = [];
  const dt = 1 / 60;
  let station = 0;
  while (station < map.path.length) {
    const p = poseAt(map.path, station);
    view.x = p.x;
    view.z = p.z;
    streamer.update();
    const t = performance.now();
    visual.update();
    samples.push(performance.now() - t);
    station += 60 * dt;
  }
  const out = {
    records: records.length,
    createMs: +createMs.toFixed(1),
    frames: samples.length,
    update: stats(samples),
  };
  console.log(JSON.stringify(out));
  writeFileSync('scratch/far-visual-probe.json', JSON.stringify(out, null, 1));
  visual.dispose();
  streamer.dispose();
}, 600_000);
