import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import {
  createPropStreamer,
  createPropStreamRecords,
} from '../../../src/world/propStreaming';
import type {
  BreakableProps,
  BreakablePlacement,
} from '../../../src/world/breakableProps';

function fakeProps(placements: readonly BreakablePlacement[]): BreakableProps {
  const active = new Uint8Array(placements.length);
  let liveCount = 0;
  return {
    propCapacity: 192,
    fragmentCapacity: 768,
    propHalfExtents: { x: 0.5, y: 0.5, z: 0.5 },
    fragmentHalfExtents: { x: 0.2, y: 0.2, z: 0.2 },
    copyActivePropIds: () => 0,
    copyActiveFragmentIds: () => 0,
    reset() {
      active.fill(0);
    },
    activate(i: number) {
      if (liveCount >= 128) return false;
      if (!active[i]) liveCount++;
      active[i] = 1;
      return true;
    },
    deactivate(i: number) {
      if (active[i]) liveCount--;
      active[i] = 0;
      return true;
    },
    isActive(i: number) {
      return active[i] === 1;
    },
    isDestroyed() {
      return false;
    },
    getActivePropPosition(i: number, out: { x: number; y: number; z: number }) {
      Object.assign(out, placements[i]!.position);
      return true;
    },
    onContact() {},
    update() {},
    dispose() {},
  } as unknown as BreakableProps;
}
function stats(samples: number[]) {
  const s = [...samples].sort((a, b) => a - b);
  const q = (f: number) => s[Math.min(s.length - 1, Math.floor(f * s.length))]!;
  return {
    avg: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(4),
    p50: +q(0.5).toFixed(4),
    p99: +q(0.99).toFixed(4),
    max: +q(1).toFixed(4),
  };
}
it('NS2 streamer scan cost vs record count on a 10 km strip', () => {
  const out: unknown[] = [];
  for (const n of [256, 1024, 4096, 19000, 60000]) {
    // Props scattered along a 10 km strip, 100 m wide, like a long track's shoulders.
    let seed = 3;
    const rnd = () =>
      (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const placements: BreakablePlacement[] = Array.from(
      { length: n },
      (_, i) => ({
        id: 'p' + i,
        position: { x: rnd() * 100 - 50, y: 0.5, z: rnd() * 10000 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
      }),
    ) as unknown as BreakablePlacement[];
    const props = fakeProps(placements);
    const records = createPropStreamRecords(placements, 32);
    const view = { x: 0, y: 0, z: 0 };
    const streamer = createPropStreamer({
      props,
      records,
      readVehiclePosition: (o) => Object.assign(o, view),
      maxPromoted: 128,
      enterRadius: 90,
      exitRadius: 130,
    });
    const samples: number[] = [];
    const changes = new Int32Array(records.length);
    let farChanges = 0;
    for (let step = 0; step < 2400; step++) {
      // 20 s at 60 m/s: 1.2 km of strip
      view.z = step * (60 / 120);
      const t0 = performance.now();
      streamer.update();
      farChanges += streamer.copyFarVisibilityChanges(changes);
      samples.push(performance.now() - t0);
    }
    const promoted = records.reduce(
      (c, _r, i) => c + (streamer.isPromoted(i) ? 1 : 0),
      0,
    );
    const density = n / 10000; // per metre of strip
    out.push({
      records: n,
      perMetre: +density.toFixed(3),
      within90m: Math.round(density * 180),
      promotedAtEnd: promoted,
      farChangesPerStep: +(farChanges / 2400).toFixed(2),
      update: stats(samples.slice(120)),
    });
    streamer.dispose();
  }
  console.log('SCAN ' + JSON.stringify(out));
  writeFileSync('scratch/stream-scan-probe.json', JSON.stringify(out, null, 1));
}, 600_000);
