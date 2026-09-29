import { describe, expect, it } from 'vitest';
import {
  clusterPlacements,
  lanesAlong,
  poseAt,
  sampleRoad,
  shoulderPlacements,
  type RoadSegment,
} from '../src/world/roadGenerator';
import { runwayLaneClearance } from '../src/world/runways';

const NORTH = Math.PI;
const roundedRectangle = (
  long: number,
  short: number,
  r: number,
): RoadSegment[] => [
  { kind: 'straight', length: long - 2 * r },
  { kind: 'arc', radius: r, angle: Math.PI / 2 },
  { kind: 'straight', length: short - 2 * r },
  { kind: 'arc', radius: r, angle: Math.PI / 2 },
  { kind: 'straight', length: long - 2 * r },
  { kind: 'arc', radius: r, angle: Math.PI / 2 },
  { kind: 'straight', length: short - 2 * r },
  { kind: 'arc', radius: r, angle: Math.PI / 2 },
];

describe('the road generator', () => {
  it('samples a straight along the heading convention and an arc exactly, and reports the length', () => {
    const path = sampleRoad(
      [{ kind: 'straight', length: 100 }],
      { x: 0, z: 0, heading: NORTH },
      10,
    );
    expect(path.length).toBe(100);
    const end = path.samples[path.samples.length - 1]!;
    expect(end.x).toBeCloseTo(0, 9);
    expect(end.z).toBeCloseTo(100, 9); // NORTH faces +z.
    // A quarter circle of radius 100 turning left from north ends 100 west and 100 north.
    const arc = sampleRoad(
      [{ kind: 'arc', radius: 100, angle: Math.PI / 2 }],
      { x: 0, z: 0, heading: NORTH },
      1,
    );
    const tip = arc.samples[arc.samples.length - 1]!;
    expect(arc.length).toBeCloseTo((Math.PI / 2) * 100, 9);
    expect(tip.x).toBeCloseTo(100, 6); // Facing +z, left is +x (facing -z it is -x).
    expect(tip.z).toBeCloseTo(100, 6);
    expect(tip.heading).toBeCloseTo(NORTH + Math.PI / 2, 9);
  });

  it('closes a rounded rectangle to within a millimetre and measures it', () => {
    const path = sampleRoad(roundedRectangle(3600, 1700, 300), {
      x: -1500,
      z: -850,
      heading: NORTH,
    });
    expect(path.closed).toBe(true);
    expect(path.closureError).toBeLessThan(1e-3);
    expect(path.length).toBeCloseTo(2 * 3000 + 2 * 1100 + 2 * Math.PI * 300, 6);
    // Wrapping: a station past the end is on the first straight again.
    const p = poseAt(path, path.length + 50);
    const q = poseAt(path, 50);
    expect(p.x).toBeCloseTo(q.x, 6);
    expect(p.z).toBeCloseTo(q.z, 6);
  });

  it('does not call an open road closed', () => {
    const path = sampleRoad([
      { kind: 'straight', length: 500 },
      { kind: 'arc', radius: 200, angle: Math.PI },
    ]);
    expect(path.closed).toBe(false);
    expect(path.closureError).toBeGreaterThan(100);
  });

  it('paints lanes that cover every station of the road', () => {
    const path = sampleRoad(roundedRectangle(3600, 1700, 300), {
      x: -1500,
      z: -850,
      heading: NORTH,
    });
    const lanes = lanesAlong(path, 16, 20);
    expect(lanes.length).toBe(Math.round(path.length / 20));
    for (let s = 0; s < path.length; s += 7) {
      const p = poseAt(path, s);
      const clearance = Math.min(
        ...lanes.map((l) => runwayLaneClearance(l, p.x, p.z)),
      );
      expect(clearance).toBeLessThanOrEqual(0.2);
    }
  });

  it('keeps shoulder props off the road, spreads them at the asked density, and repeats for a seed', () => {
    const path = sampleRoad(roundedRectangle(3600, 1700, 300), {
      x: -1500,
      z: -850,
      heading: NORTH,
    });
    const lanes = lanesAlong(path, 16, 20);
    const a = shoulderPlacements(path, {
      density: 1.5,
      nearest: 10,
      farthest: 22,
      seed: 7,
    });
    const b = shoulderPlacements(path, {
      density: 1.5,
      nearest: 10,
      farthest: 22,
      seed: 7,
    });
    expect(a.length).toBe(Math.floor(path.length * 1.5));
    expect(a).toEqual(b);
    for (const prop of a.filter((_, i) => i % 97 === 0)) {
      const clearance = Math.min(
        ...lanes.map((l) =>
          runwayLaneClearance(l, prop.position.x, prop.position.z),
        ),
      );
      expect(clearance).toBeGreaterThan(1.5); // At least 10 m from the centreline of a 16 m lane.
    }
    const cluster = clusterPlacements(path, 500, 1, 14);
    expect(cluster).toHaveLength(12);
  });
});
