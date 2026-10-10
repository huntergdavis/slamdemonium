import { describe, expect, it } from 'vitest';
import { createTimedRun } from '../src/core/timedRun';
import {
  CITY_CROSS_STREET_WIDTH,
  CITY_INTERSECTIONS,
  CITY_ROAD_WIDTH,
  createCityMap,
} from '../src/world/cityCourse';
import { createGroundDescriptor } from '../src/world/trackPhysics';
import { resolveTrackConfig } from '../src/world/trackConfig';
import { poseAt } from '../src/world/roadGenerator';
import { runwayLaneClearance } from '../src/world/runways';

describe('city graybox', () => {
  const forward = createCityMap();
  const reverse = createCityMap(true);

  it('offers the same closed 3.16 km road in opposite directions', () => {
    const a = forward.path!;
    const b = reverse.path!;
    expect(a.closed).toBe(true);
    expect(b.closed).toBe(true);
    expect(a.closureError).toBeLessThan(1e-3);
    expect(a.length).toBeGreaterThan(3000);
    expect(a.length).toBeLessThan(3300);
    expect(b.length).toBeCloseTo(a.length, 9);
    for (let station = 0; station < a.length; station += 123) {
      const left = poseAt(a, station);
      const right = poseAt(b, b.length - station);
      expect(Math.hypot(left.x - right.x, left.z - right.z)).toBeLessThan(0.02);
      const dot =
        Math.sin(left.heading) * Math.sin(right.heading) +
        Math.cos(left.heading) * Math.cos(right.heading);
      expect(dot).toBeCloseTo(-1, 5);
    }
  });

  it('keeps two open 20 m crossings and the 24 m four-lane loop on one ground collider', () => {
    expect(CITY_INTERSECTIONS).toHaveLength(2);
    expect(forward.roadDecks?.at(-1)?.width).toBe(CITY_CROSS_STREET_WIDTH);
    expect(CITY_ROAD_WIDTH).toBe(24);
    const ground = createGroundDescriptor(resolveTrackConfig(forward.track));
    for (const map of [forward, reverse]) {
      for (const sample of map.path!.samples)
        expect(Math.max(Math.abs(sample.x), Math.abs(sample.z))).toBeLessThan(
          ground.halfExtents.x,
        );
      for (const junction of CITY_INTERSECTIONS) {
        expect(
          Math.min(
            ...map.roadDecks!.map((deck) =>
              runwayLaneClearance(deck, junction.x, junction.z),
            ),
          ),
        ).toBe(0);
        expect(
          map.runways.some(
            (paint) =>
              Math.abs(paint.x - junction.x) < 20 &&
              Math.abs(paint.z - junction.z) < 22,
          ),
        ).toBe(false);
      }
    }
  });

  it.each([forward, reverse])(
    'orders checkpoints so the cross street cannot skip a side',
    (map) => {
      const gates = map.runs![0]!.gates;
      expect(gates.map((gate) => gate.kind)).toEqual([
        'start',
        'checkpoint',
        'checkpoint',
        'checkpoint',
        'checkpoint',
        'goal',
      ]);
      const run = createTimedRun(map.runs![0]);
      const enter = (index: number) =>
        run.update(1, gates[index]!.x, gates[index]!.z, 30);
      enter(0);
      enter(1); // first junction
      enter(3); // cut across town, bypassing the short side
      enter(5);
      expect(run.state.phase).not.toBe('finished');
      run.reset();
      for (let index = 0; index < gates.length; index++) enter(index);
      expect(run.state.phase).toBe('finished');
    },
  );
});
