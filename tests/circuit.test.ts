import { describe, expect, it } from 'vitest';
import { CIRCUIT_STATIONS, createCircuitMap } from '../src/world/circuit';
import { runGateContains } from '../src/core/timedRun';
import { runwayLaneClearance } from '../src/world/runways';
import { poseAt } from '../src/world/roadGenerator';

describe('the 10 km circuit', () => {
  const map = createCircuitMap();
  it('closes, is about ten kilometres, and fits inside its barrier ring', () => {
    expect(map.path.closed).toBe(true);
    expect(map.path.length).toBeGreaterThan(10_000);
    expect(map.path.length).toBeLessThan(10_200);
    let farthest = 0;
    for (const s of map.path.samples)
      farthest = Math.max(farthest, Math.hypot(s.x, s.z));
    expect(farthest).toBeLessThan(map.track.ringInnerRadius! - 30);
    expect(Math.hypot(map.spawn!.x, map.spawn!.z)).toBeLessThan(
      map.track.barrierInnerRadius!,
    );
  });
  it('places every set piece and gate on the road at its station', () => {
    const onRoad = (x: number, z: number) =>
      Math.min(...map.runways.map((l) => runwayLaneClearance(l, x, z)));
    for (const ramp of map.ramps)
      expect(onRoad(ramp.x, ramp.z)).toBeLessThan(0.5);
    for (const loop of map.loops)
      expect(onRoad(loop.x, loop.z)).toBeLessThan(0.5);
    for (const pad of map.boostPads)
      expect(onRoad(pad.x, pad.z)).toBeLessThan(0.5);
    const gates = map.runs![0]!.gates;
    expect(gates.map((g) => g.kind)).toEqual([
      'start',
      'checkpoint',
      'checkpoint',
      'checkpoint',
      'goal',
    ]);
    for (const g of gates) expect(onRoad(g.x, g.z)).toBeLessThan(0.5);
    // The spawn is 40 m short of the start box, facing it, and not inside it.
    expect(runGateContains(gates[0]!, map.spawn!.x, map.spawn!.z)).toBe(false);
    const ahead = poseAt(map.path, map.path.length - 40 + 40);
    expect(
      Math.hypot(ahead.x - gates[0]!.x, ahead.z - gates[0]!.z),
    ).toBeLessThan(1);
  });

  it('marks the optional aquifer braking approach without moving the racing line', () => {
    const aquiferEntry = map.runways.at(-2)!;
    expect(aquiferEntry.markerMeters).toBe(20);
    expect(aquiferEntry.width).toBe(14);
    expect(aquiferEntry.length).toBeGreaterThan(110);
    expect(aquiferEntry.length).toBeLessThan(130);
    expect(map.runways.slice(0, Math.round(map.path.length / 20))).toContainEqual(
      expect.objectContaining({ markerMeters: 0 }),
    );
  });
  it('carries about thirteen thousand props, all off the road', () => {
    expect(map.placements.length).toBeGreaterThan(12_000);
    expect(map.placements.length).toBeLessThan(16_000);
    const lanes = map.runways;
    for (const p of map.placements.filter((_, i) => i % 211 === 0)) {
      const clearance = Math.min(
        ...lanes.map((l) => runwayLaneClearance(l, p.position.x, p.position.z)),
      );
      expect(clearance).toBeGreaterThan(1);
    }
    expect(CIRCUIT_STATIONS.checkpoints).toHaveLength(3);
  });
});
