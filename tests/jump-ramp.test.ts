import { expect, it } from 'vitest';
import {
  JUMP_LANDING_SEGMENTS,
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

it('faces every launch and landing top triangle upward for wheel raycasts', () => {
  const spec = PROVING_GROUND_MAP.jumpRamps[0]!;
  const { vertices, indices } = jumpRampMeshDescriptor(spec);
  // Each segment emits four quads; the first quad is the drivable top.
  // A capped launch profile precedes the landing profile in the same mesh.
  const profiles = [
    { firstIndex: 0, segments: JUMP_LAUNCH_SEGMENTS },
    {
      firstIndex: JUMP_LAUNCH_SEGMENTS * 24 + 12,
      segments: JUMP_LANDING_SEGMENTS,
    },
  ];
  for (const { firstIndex, segments } of profiles)
    for (let segment = 0; segment < segments; segment++)
      for (let triangle = 0; triangle < 2; triangle++) {
        const offset = firstIndex + segment * 24 + triangle * 3;
        const a = vertices[indices[offset]!]!;
        const b = vertices[indices[offset + 1]!]!;
        const c = vertices[indices[offset + 2]!]!;
        const normalY = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
        expect(normalY).toBeGreaterThan(0);
      }
});
