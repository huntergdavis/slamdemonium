import { expect, it } from 'vitest';
import {
  JUMP_LAUNCH_SEGMENTS,
  jumpRampLaunchLength,
  jumpRampMeshDescriptor,
} from '../src/world/jumpRamp';
import { PROVING_GROUND_MAP } from '../src/world/maps';

it('launches from an 8 m circular arc at the authored 22 degree tangent', () => {
  const spec = PROVING_GROUND_MAP.jumpRamps[0]!;
  const vertices = jumpRampMeshDescriptor(spec).vertices;
  const previous = vertices[(JUMP_LAUNCH_SEGMENTS - 1) * 4]!;
  const lip = vertices[JUMP_LAUNCH_SEGMENTS * 4]!;
  const horizontal = Math.hypot(lip.x - previous.x, lip.z - previous.z);
  const tangent = Math.atan2(lip.y - previous.y, horizontal);
  const tangentDegrees = (tangent * 180) / Math.PI;

  expect(spec.launchHeight).toBe(8);
  expect(lip.y).toBeCloseTo(8, 9);
  expect(tangentDegrees).toBeCloseTo(22, 0);
  expect(Math.abs(tangentDegrees - 22)).toBeLessThan(0.2);
  expect(jumpRampLaunchLength(spec)).toBeGreaterThan(40);
  expect(jumpRampLaunchLength(spec)).toBeLessThan(42);

  const landingStart = vertices[(JUMP_LAUNCH_SEGMENTS + 1) * 4]!;
  const landingEnd = vertices[vertices.length - 4]!;
  expect(landingStart.y).toBeCloseTo(8, 9);
  expect(landingEnd.y).toBeCloseTo(0, 9);
  expect(spec.landingLength).toBe(150);
});
