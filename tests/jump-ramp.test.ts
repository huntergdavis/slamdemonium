import { expect, it } from 'vitest';
import {
  JUMP_LANDING_SEGMENTS,
  JUMP_LAUNCH_SEGMENTS,
  jumpRampLaunchLength,
  jumpRampMeshDescriptor,
} from '../src/world/jumpRamp';
import { BREAKABLE_PROP_PLACEMENTS } from '../src/world/breakablePlacements';
import { PROVING_GROUND_MAP } from '../src/world/maps';

it('launches from the R236 curve at the authored 22 degree tangent', () => {
  const spec = PROVING_GROUND_MAP.jumpRamps[0]!;
  const vertices = jumpRampMeshDescriptor(spec).vertices;
  const previous = vertices[(JUMP_LAUNCH_SEGMENTS - 1) * 4]!;
  const lip = vertices[JUMP_LAUNCH_SEGMENTS * 4]!;
  const horizontal = Math.hypot(lip.x - previous.x, lip.z - previous.z);
  const tangent = Math.atan2(lip.y - previous.y, horizontal);
  const tangentDegrees = (tangent * 180) / Math.PI;

  expect(spec.launchRadius).toBe(236);
  expect(spec.entryEase).toBe(10);
  expect(spec.lipEase).toBe(4);
  expect(lip.y).toBeGreaterThan(17.8);
  expect(lip.y).toBeLessThan(18.1);
  const foot = vertices[0]!;
  expect(Math.hypot(lip.x - foot.x, lip.z - foot.z)).toBeCloseTo(
    jumpRampLaunchLength(spec),
    8,
  );
  expect(tangentDegrees).toBeCloseTo(22, 0);
  expect(Math.abs(tangentDegrees - 22)).toBeLessThan(0.2);
  expect(jumpRampLaunchLength(spec)).toBeGreaterThan(95);
  expect(jumpRampLaunchLength(spec)).toBeLessThan(96);

  const landingStart = vertices[(JUMP_LAUNCH_SEGMENTS + 1) * 4]!;
  const landingEnd = vertices[vertices.length - 4]!;
  expect(landingStart.y).toBeCloseTo(lip.y, 9);
  expect(landingEnd.y).toBeCloseTo(0, 9);
  expect(spec.landingLength).toBe(300);
});

it('eases curvature on and off the launch instead of stepping it at either end', () => {
  const spec = PROVING_GROUND_MAP.jumpRamps[0]!;
  const vertices = jumpRampMeshDescriptor(spec).vertices;
  const tangents: number[] = [];
  const lengths: number[] = [];
  for (let i = 0; i < JUMP_LAUNCH_SEGMENTS; i++) {
    const a = vertices[i * 4]!;
    const b = vertices[(i + 1) * 4]!;
    const horizontal = Math.hypot(b.x - a.x, b.z - a.z);
    tangents.push(Math.atan2(b.y - a.y, horizontal));
    lengths.push(Math.hypot(horizontal, b.y - a.y));
  }
  const curvatures = tangents
    .slice(1)
    .map(
      (tangent, i) =>
        (tangent - tangents[i]!) / ((lengths[i]! + lengths[i + 1]!) / 2),
    );
  const middle = curvatures[Math.floor(curvatures.length / 2)]!;
  expect(curvatures[0]!).toBeLessThan(middle * 0.15);
  expect(curvatures[curvatures.length - 1]!).toBeLessThan(middle * 0.25);
  expect(Math.max(...curvatures)).toBeGreaterThan(1 / 245);
  expect(Math.max(...curvatures)).toBeLessThan(1 / 230);
  expect(Math.min(...curvatures)).toBeGreaterThan(0);
});

it('catches boosted flight before the hill foot without crossing the ring or props', () => {
  const spec = PROVING_GROUND_MAP.jumpRamps[0]!;
  const vertices = jumpRampMeshDescriptor(spec).vertices;
  const lip = vertices[JUMP_LAUNCH_SEGMENTS * 4]!;
  const hillFoot = vertices[vertices.length - 3]!;
  // At the approved gravity 20, a ground-level 85 m/s flight bounds where it
  // can intersect the hill: its surface is above ground until the foot.
  const speed = 85;
  const gravity = 20;
  const up = speed * Math.sin(spec.launchAngle);
  const forward = speed * Math.cos(spec.launchAngle);
  const flightTime = (up + Math.sqrt(up * up + 2 * gravity * lip.y)) / gravity;
  expect(forward * flightTime).toBeLessThan(spec.gap + spec.landingLength - 5);
  expect(Math.hypot(hillFoot.x, hillFoot.z)).toBeLessThan(380);

  // The enlarged launch arches over the east-west runway. Its underside must
  // leave the full painted lane clear for a car passing beneath it.
  const undersideOverRunway = vertices
    .slice(0, (JUMP_LAUNCH_SEGMENTS + 1) * 4)
    .filter((_, index) => index % 4 >= 2)
    .filter((vertex) => Math.abs(vertex.z) <= 8)
    .map((vertex) => vertex.y);
  expect(undersideOverRunway.length).toBeGreaterThan(0);
  expect(Math.min(...undersideOverRunway)).toBeGreaterThan(5);

  const corridorStart = PROVING_GROUND_MAP.spawn!.z;
  for (const prop of BREAKABLE_PROP_PLACEMENTS) {
    const p = prop.position;
    if (p.z < corridorStart || p.z > hillFoot.z) continue;
    expect(Math.abs(p.x - spec.x)).toBeGreaterThan(spec.width / 2 + 5);
  }
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
