import { describe, expect, it } from 'vitest';
import { createTimedRun } from '../src/core/timedRun';
import {
  COAST_HEADLAND_MAP,
  COAST_HEAD_PATH,
  COAST_SHORELINE_MAP,
  COAST_SHORE_PATH,
} from '../src/world/coastCourse';
import { poseAt, type RoadPath } from '../src/world/roadGenerator';

function drive(route: typeof COAST_SHORELINE_MAP, path: RoadPath) {
  const run = createTimedRun(route.runs![0]);
  for (const sample of path.samples) run.update(4 / 45, sample.x, sample.z, 45);
  return run.state;
}

describe('coast fork and run gates', () => {
  it('has two 3–5 km roads that share a safe start and rejoin at one finish', () => {
    expect(COAST_SHORE_PATH.length).toBeGreaterThan(3000);
    expect(COAST_HEAD_PATH.length).toBeLessThan(5000);
    for (const station of [0, 500]) {
      const a = poseAt(COAST_SHORE_PATH, station);
      const b = poseAt(COAST_HEAD_PATH, station);
      expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(0.5);
    }
    const middleA = poseAt(COAST_SHORE_PATH, 1700);
    const middleB = poseAt(COAST_HEAD_PATH, 1700);
    expect(
      Math.hypot(middleA.x - middleB.x, middleA.z - middleB.z),
    ).toBeGreaterThan(480);
    const endA = poseAt(COAST_SHORE_PATH, COAST_SHORE_PATH.length);
    const endB = poseAt(COAST_HEAD_PATH, COAST_HEAD_PATH.length);
    expect(Math.hypot(endA.x - endB.x, endA.z - endB.z)).toBeLessThan(0.5);
  });

  it('finishes each selected route but rejects the wrong fork', () => {
    expect(drive(COAST_SHORELINE_MAP, COAST_SHORE_PATH).phase).toBe('finished');
    expect(drive(COAST_HEADLAND_MAP, COAST_HEAD_PATH).phase).toBe('finished');
    expect(drive(COAST_SHORELINE_MAP, COAST_HEAD_PATH).phase).not.toBe(
      'finished',
    );
    expect(drive(COAST_HEADLAND_MAP, COAST_SHORE_PATH).phase).not.toBe(
      'finished',
    );
  });

  it('keeps moving traffic out of the first bends at a 25 m/s approach', () => {
    for (const map of [COAST_SHORELINE_MAP, COAST_HEADLAND_MAP]) {
      for (const car of map.traffic!) {
        if (car.direction === 1) expect(car.station).toBeGreaterThan(1050);
        else
          expect((25 * car.station) / (25 + car.speed)).toBeGreaterThan(1050);
      }
      expect(map.traffic!.length).toBeGreaterThan(20);
      expect(map.shuntWalls!.length).toBeGreaterThan(20);
    }
  });
});
