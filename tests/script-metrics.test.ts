import { expect, it } from 'vitest';
import {
  ReplayMetrics,
  assertReplay,
  RingLapTimer,
  assertCompletedLap,
} from '../src/input/script';
import { scriptFixture } from './scriptFixtures';

const point = (degree: number, radius = 130) => ({
  x: radius * Math.cos((degree * Math.PI) / 180),
  y: 0.86,
  z: -radius * Math.sin((degree * Math.PI) / 180),
});

it('counts all eight ordered ring gates with physics-step lap timing and a reused progress object', () => {
  const lap = new RingLapTimer({ physicsHz: 120 });
  lap.reset(point(0));
  const progress = lap.progress;
  for (let step = 1; step <= 360; step++)
    expect(lap.update(point(step), step)).toBe(progress);
  expect(progress).toEqual({
    completedLaps: 1,
    nextCheckpoint: 1,
    lastLapSteps: 360,
    lastLapSeconds: 3,
    invalidated: false,
  });
  assertCompletedLap(progress, 360);
  expect(() => assertCompletedLap(progress, 359)).toThrow(/budget/);
  for (let step = 361; step <= 720; step++) lap.update(point(step), step);
  expect(progress.completedLaps).toBe(2);
  expect(progress.lastLapSteps).toBe(360);
});

it('does not count reverse driving, shortcuts, teleports, skipped steps or non-finite positions', () => {
  const reverse = new RingLapTimer({ physicsHz: 120 });
  reverse.reset(point(0));
  for (let step = 1; step <= 720; step++) reverse.update(point(-step), step);
  expect(() => assertCompletedLap(reverse.progress)).toThrow(/No complete/);
  for (const invalidPoint of [point(46), point(0, 100)]) {
    const lap = new RingLapTimer({ physicsHz: 120 });
    lap.reset(point(0));
    lap.update(invalidPoint, 1);
    expect(lap.progress.invalidated).toBe(true);
    expect(lap.progress.nextCheckpoint).toBe(0);
    expect(() => assertCompletedLap(lap.progress)).toThrow();
  }
  const lap = new RingLapTimer({ physicsHz: 120 });
  lap.reset(point(0));
  expect(() => lap.update(point(1), 2)).toThrow(/consecutive/);
  expect(() => lap.update({ x: NaN, y: 0, z: 0 }, 1)).toThrow(/finite/);
});

it('collects finite metrics without retaining telemetry aliases and compares equivalent quaternion signs', () => {
  const metrics = new ReplayMetrics();
  const spawn = scriptFixture().spawn;
  metrics.reset(spawn);
  const current = metrics.current;
  const telemetry = {
    ...structuredClone(spawn),
    speed: 12,
    beta: -0.3,
    wheels: [{ alpha: 0.2 }],
  };
  metrics.record(telemetry);
  telemetry.speed = 10;
  telemetry.beta = 0.1;
  telemetry.position.z = -2;
  metrics.record(telemetry);
  expect(metrics.current).toBe(current);
  const result = metrics.snapshot();
  telemetry.position.z = -20;
  const expectedPose = {
    position: { x: 130, y: 0.86, z: -2.01 },
    rotation: { x: 0, y: 0, z: 0, w: -1 },
  };
  assertReplay(result, {
    elapsedSteps: 2,
    peakSpeed: { min: 12, max: 12 },
    peakAbsSlideAngle: { min: 0.3, max: 0.3 },
    finalPose: {
      pose: expectedPose,
      positionTolerance: 0.02,
      rotationTolerance: 0,
    },
  });
  expect(() => assertReplay(result, { elapsedSteps: 3 })).toThrow(
    /completed steps/,
  );
  expect(() =>
    assertReplay(result, { peakSpeed: { min: 0, max: 11 } }),
  ).toThrow(/peakSpeed/);
  expect(() =>
    assertReplay(result, { peakAbsSlideAngle: { min: 0, max: 0.2 } }),
  ).toThrow(/peakAbsSlideAngle/);
  expect(() =>
    assertReplay(result, {
      finalPose: {
        pose: expectedPose,
        positionTolerance: 0.001,
        rotationTolerance: 0,
      },
    }),
  ).toThrow(/Final pose/);
  telemetry.wheels[0]!.alpha = Infinity;
  metrics.record(telemetry);
  expect(metrics.current.firstNonFiniteStep).toBe(3);
  expect(() => assertReplay(metrics.snapshot(), {})).toThrow(/non-finite/);
  expect(result.allFinite).toBe(true);
});
