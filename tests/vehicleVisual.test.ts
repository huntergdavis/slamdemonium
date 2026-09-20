import { expect, it } from 'vitest';
import { TransformState } from '../src/core/transforms';
import { VehicleTelemetry } from '../src/vehicle/telemetry';
import { VehicleVisualHistory } from '../src/vehicle/visualState';

it('interpolates the physical spin advance before wrapping across zero', () => {
  const telemetry = new VehicleTelemetry();
  telemetry.wheels[0].spinAngle = 0.1;
  const visual = new VehicleVisualHistory(telemetry);
  telemetry.wheels[0].spinDelta = -0.2;
  telemetry.wheels[0].spinAngle = 2 * Math.PI - 0.1;
  telemetry.wheels[0].centerLocal.y = -0.6;
  const pose = new TransformState();
  expect(visual.interpolate(0.5, pose).wheels[0].spinAngle).toBe(0);
  expect(visual.interpolate(0.75, pose).wheels[0].spinAngle).toBeCloseTo(
    2 * Math.PI - 0.05,
  );
  expect(visual.interpolate(0.5, pose).wheels[0].centerLocal.y).toBeCloseTo(
    -0.3,
  );
  const state = visual.interpolate(0.5, pose);
  expect(visual.interpolate(0.8, pose)).toBe(state);
});

it('handles more than one turn per step without guessing a shortest arc', () => {
  const telemetry = new VehicleTelemetry();
  const visual = new VehicleVisualHistory(telemetry);
  telemetry.wheels[0].spinDelta = -4 * Math.PI - 0.2;
  const pose = new TransformState();
  expect(visual.interpolate(0.5, pose).wheels[0].spinAngle).toBeCloseTo(
    2 * Math.PI - 0.1,
  );
});
