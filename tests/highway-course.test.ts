import { describe, expect, it } from 'vitest';
import { createTimedRun } from '../src/core/timedRun';
import {
  HIGHWAY_EXPRESS_MAP,
  HIGHWAY_EXPRESS_PATH,
  HIGHWAY_INTERCHANGE_MAP,
  HIGHWAY_INTERCHANGE_PATH,
} from '../src/world/highwayCourse';
import { poseAt, type RoadPath } from '../src/world/roadGenerator';

function drive(map: typeof HIGHWAY_EXPRESS_MAP, path: RoadPath) {
  const run = createTimedRun(map.runs![0]);
  for (const sample of path.samples) {
    run.update(4 / 65, sample.x, sample.z, 65);
    if (run.state.phase === 'finished') break;
  }
  return run.state;
}

describe('highway bypass and interchange', () => {
  it('keeps two ten-kilometre closed lanes with one common fork and rejoin', () => {
    expect(HIGHWAY_EXPRESS_PATH.closed).toBe(true);
    expect(HIGHWAY_INTERCHANGE_PATH.closed).toBe(true);
    for (const path of [HIGHWAY_EXPRESS_PATH, HIGHWAY_INTERCHANGE_PATH]) {
      expect(path.length).toBeGreaterThan(10_000);
      expect(path.length).toBeLessThan(10_500);
    }
    const separation = (a: number, b: number) => {
      const express = poseAt(HIGHWAY_EXPRESS_PATH, a);
      const interchange = poseAt(HIGHWAY_INTERCHANGE_PATH, b);
      return Math.hypot(express.x - interchange.x, express.z - interchange.z);
    };
    expect(separation(650, 650)).toBeLessThan(0.5);
    expect(separation(1200, 1200)).toBeGreaterThan(50);
    expect(separation(1900, 1919)).toBeLessThan(2);
  });

  it('finishes each selected branch and rejects the opposite branch', () => {
    expect(drive(HIGHWAY_EXPRESS_MAP, HIGHWAY_EXPRESS_PATH).phase).toBe(
      'finished',
    );
    expect(drive(HIGHWAY_INTERCHANGE_MAP, HIGHWAY_INTERCHANGE_PATH).phase).toBe(
      'finished',
    );
    expect(drive(HIGHWAY_EXPRESS_MAP, HIGHWAY_INTERCHANGE_PATH).phase).not.toBe(
      'finished',
    );
    expect(drive(HIGHWAY_INTERCHANGE_MAP, HIGHWAY_EXPRESS_PATH).phase).not.toBe(
      'finished',
    );
  });

  it('authors slower heavy vehicles and limits contraflow to the merge', () => {
    for (const map of [HIGHWAY_EXPRESS_MAP, HIGHWAY_INTERCHANGE_MAP]) {
      expect(map.traffic!.some((car) => car.modelKind === 'boxTruck')).toBe(
        true,
      );
      expect(map.traffic!.some((car) => car.modelKind === 'bus')).toBe(true);
      expect(map.traffic!.every((car) => car.station >= 280)).toBe(true);
    }
    expect(
      HIGHWAY_EXPRESS_MAP.traffic!.every((car) => car.direction === 1),
    ).toBe(true);
    expect(
      HIGHWAY_INTERCHANGE_MAP.traffic!.filter(
        (car) => car.direction === -1,
      ).every((car) => car.station >= 1700 && car.station < 2300),
    ).toBe(true);
  });
});
