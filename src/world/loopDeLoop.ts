import { BoxGeometry, Group, Matrix4, Mesh, Quaternion, Vector3 } from 'three';
import type { Material, Scene } from 'three';
import { SURFACE_IDS, type SurfaceId } from '../content/surfaces';
import type { BodyId, V3 } from '../physics/adapter';
import type { SurfacedBodies, SurfacedStaticBodyDesc } from './surfacedBodies';

/** One authored loop-de-loop. `x`/`z` is the centre of the entry lane where
 * it meets the ground; `heading` is the entry direction in the ramp
 * convention (radians, 0 = -Z, positive turns left). The loop is a helix:
 * over one turn the lane slides sideways by `shift` toward the car's LEFT
 * (positive) or RIGHT (negative), so the exit lane lies beside the entry lane
 * instead of running into it. A planar loop is impossible: its descending
 * arc would come down onto the entry lane. The driver steers slightly to
 * follow the lane, as on a real loop. */
export interface LoopSpec {
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  readonly radius: number;
  readonly width: number;
  readonly shift: number;
  readonly segments: number;
  /** Ground surface of every slab; default asphalt. */
  readonly surface?: SurfaceId;
  /** Raised shoulders along both lane edges: a strip `width` metres wide
   * banked `bank` radians up toward the outside, so a car drifting off
   * centre climbs a ramp and rolls back to the middle instead of leaving
   * the lane. Half-pipe forgiveness, not assistance: it is geometry. */
  readonly shoulder?: Readonly<{ width: number; bank: number }>;
}

export const LOOP_THICKNESS = 0.3;
/** Slabs overlap their neighbours by this fraction so wheel rays never fall
 * through a seam. */
const SEGMENT_OVERLAP = 1.12;

/** North-west quadrant: the one no ramp lands in and no prop bank occupies,
 * and a twenty metre tall structure beside the racing line is visible from
 * anywhere on the ring. The entry lane centre sits at 108 m radius, so the
 * outer lane edge is at 114 m and the example routes at 127 m and beyond
 * clear the whole footprint by over eight metres. Counter-clockwise like the ramps; the exit
 * lane is one lane inward. Physics minimum: the top needs v^2 > g R and the
 * climb costs 4 g R, so an 10 m loop wants sqrt(5 g R), about 27 m/s at the
 * bottom before losses; the loop test measures the real figure. */
export const LOOP_LAYOUT: readonly LoopSpec[] = Object.freeze([
  Object.freeze({
    x: -76.4,
    z: 76.4,
    heading: Math.PI / 4,
    radius: 10,
    width: 12,
    // Negative: toward the car's right, which on a counter-clockwise ring is
    // toward the centre, so the exit lane is inward of the entry lane.
    shift: -13,
    segments: 48,
  }),
]);

const scratch = {
  forward: new Vector3(),
  left: new Vector3(),
  tangent: new Vector3(),
  up: new Vector3(),
  right: new Vector3(),
  matrix: new Matrix4(),
  quaternion: new Quaternion(),
  point: new Vector3(),
  centre: new Vector3(),
};

/** Entry direction as a unit vector in the ground plane. */
export function loopForward(spec: Readonly<LoopSpec>, out: V3): V3 {
  out.x = -Math.sin(spec.heading);
  out.y = 0;
  out.z = -Math.cos(spec.heading);
  return out;
}

/** Lane centreline point and frame at loop angle theta, as fresh vectors,
 * for tests and tools that place a car on the loop. Not for the hot path. */
export function loopLanePose(
  spec: Readonly<LoopSpec>,
  theta: number,
): { point: Vector3; tangent: Vector3; up: Vector3 } {
  const frame = laneFrame(spec, theta);
  return {
    point: frame.point.clone(),
    tangent: frame.tangent.clone(),
    up: frame.up.clone(),
  };
}

/** The point on the lane centreline at loop angle theta (0 at the entry,
 * 2 pi at the exit), and the local frame there. Allocation free. */
function laneFrame(spec: Readonly<LoopSpec>, theta: number) {
  const f = scratch.forward.set(
    -Math.sin(spec.heading),
    0,
    -Math.cos(spec.heading),
  );
  // Left of the heading in the ground plane: up x forward.
  const l = scratch.left.set(0, 1, 0).cross(f).normalize();
  const r = spec.radius;
  const slide = (spec.shift * theta) / (2 * Math.PI);
  scratch.point
    .set(spec.x, 0, spec.z)
    .addScaledVector(f, r * Math.sin(theta))
    .addScaledVector(l, slide)
    .setY(r * (1 - Math.cos(theta)));
  // Tangent: circle tangent plus the constant sideways slide per radian.
  scratch.tangent
    .copy(f)
    .multiplyScalar(r * Math.cos(theta))
    .addScaledVector(l, spec.shift / (2 * Math.PI))
    .setY(r * Math.sin(theta))
    .normalize();
  // Surface normal toward the loop centre (the car's up while riding it).
  scratch.up.copy(f).multiplyScalar(-Math.sin(theta)).setY(Math.cos(theta));
  return { point: scratch.point, tangent: scratch.tangent, up: scratch.up };
}

const shoulderScratch = {
  right: new Vector3(),
  up: new Vector3(),
  edge: new Vector3(),
};

/** One pitched slab per segment, low side flush with the lane, plus one
 * banked shoulder slab per edge when the spec asks for them. The lane slab
 * comes first in each segment's group, then the left shoulder, then the
 * right. */
export function loopSlabDescriptors(
  spec: Readonly<LoopSpec>,
): SurfacedStaticBodyDesc[] {
  const arc = (2 * Math.PI * spec.radius) / spec.segments;
  const surface = spec.surface ?? SURFACE_IDS.asphalt;
  const halfLength = (arc * SEGMENT_OVERLAP) / 2;
  const slabs: SurfacedStaticBodyDesc[] = [];
  const push = (
    centre: Vector3,
    right: Vector3,
    up: Vector3,
    tangent: Vector3,
    halfWidth: number,
  ): void => {
    scratch.matrix.makeBasis(right, up, tangent);
    scratch.quaternion.setFromRotationMatrix(scratch.matrix);
    slabs.push({
      center: { x: centre.x, y: centre.y, z: centre.z },
      halfExtents: { x: halfWidth, y: LOOP_THICKNESS / 2, z: halfLength },
      rotation: {
        x: scratch.quaternion.x,
        y: scratch.quaternion.y,
        z: scratch.quaternion.z,
        w: scratch.quaternion.w,
      },
      friction: 0.5,
      restitution: 0,
      surface,
    });
  };
  for (let i = 0; i < spec.segments; i++) {
    const theta = ((i + 0.5) * 2 * Math.PI) / spec.segments;
    const frame = laneFrame(spec, theta);
    // Right-handed basis with Z along the tangent; the slab is symmetric.
    scratch.right.crossVectors(frame.up, frame.tangent).normalize();
    scratch.up.crossVectors(frame.tangent, scratch.right).normalize();
    scratch.centre
      .copy(frame.point)
      .addScaledVector(scratch.up, -LOOP_THICKNESS / 2);
    push(
      scratch.centre,
      scratch.right,
      scratch.up,
      frame.tangent,
      spec.width / 2,
    );
    if (!spec.shoulder) continue;
    const { width, bank } = spec.shoulder;
    const cos = Math.cos(bank);
    const sin = Math.sin(bank);
    for (const side of [-1, 1]) {
      // Rotate the lane frame about the tangent so the shoulder's outer edge
      // rises: its right axis tilts up on the outside, its normal toward the
      // lane centre. The inner edge meets the lane surface edge exactly.
      shoulderScratch.right
        .copy(scratch.right)
        .multiplyScalar(cos)
        .addScaledVector(scratch.up, side * sin);
      shoulderScratch.up
        .copy(scratch.up)
        .multiplyScalar(cos)
        .addScaledVector(scratch.right, -side * sin);
      shoulderScratch.edge
        .copy(frame.point)
        .addScaledVector(scratch.right, (side * spec.width) / 2)
        .addScaledVector(shoulderScratch.right, (side * width) / 2)
        .addScaledVector(shoulderScratch.up, -LOOP_THICKNESS / 2);
      push(
        shoulderScratch.edge,
        shoulderScratch.right,
        shoulderScratch.up,
        frame.tangent,
        width / 2,
      );
    }
  }
  return slabs;
}

/** Ground-plane footprint for clearance checks: centre and radius of a
 * circle that contains every slab's footprint. */
export function loopFootprint(spec: Readonly<LoopSpec>): {
  x: number;
  z: number;
  radius: number;
} {
  const f = loopForward(spec, { x: 0, y: 0, z: 0 });
  const lx = f.z; // left = up x forward = (f.z, 0, -f.x) in the ground plane
  const lz = -f.x;
  const halfShift = spec.shift / 2;
  const halfWidth = spec.width / 2 + (spec.shoulder?.width ?? 0);
  return {
    x: spec.x + lx * halfShift,
    z: spec.z + lz * halfShift,
    radius: Math.hypot(spec.radius + 1, Math.abs(halfShift) + halfWidth),
  };
}

/** Where the exit lane meets the ground, and its direction: the same
 * heading as the entry, one `shift` to the side. */
export function loopExit(spec: Readonly<LoopSpec>): {
  x: number;
  z: number;
  forward: V3;
} {
  const f = loopForward(spec, { x: 0, y: 0, z: 0 });
  // left = (f.z, 0, -f.x); the exit lies `shift` along it (negative = right).
  return {
    x: spec.x + f.z * spec.shift,
    z: spec.z - f.x * spec.shift,
    forward: f,
  };
}

/** Installs every loop through the facade so each slab registers asphalt in
 * the call that creates it. */
export function installLoops(
  bodies: SurfacedBodies,
  specs: readonly LoopSpec[] = LOOP_LAYOUT,
): readonly BodyId[] {
  const ids: BodyId[] = [];
  for (const spec of specs)
    for (const slab of loopSlabDescriptors(spec))
      ids.push(bodies.createStaticBody(slab));
  return ids;
}

export interface LoopVisual {
  readonly root: Group;
  dispose(): void;
}

/** One box mesh per slab from the same descriptors the colliders use. */
export function createLoopVisual(
  scene: Scene,
  material: Material,
  specs: readonly LoopSpec[] = LOOP_LAYOUT,
): LoopVisual {
  const root = new Group();
  root.name = 'loops';
  const geometries: BoxGeometry[] = [];
  for (const spec of specs)
    for (const slab of loopSlabDescriptors(spec)) {
      const geometry = new BoxGeometry(
        slab.halfExtents.x * 2,
        slab.halfExtents.y * 2,
        slab.halfExtents.z * 2,
      );
      geometries.push(geometry);
      const mesh = new Mesh(geometry, material);
      mesh.position.set(slab.center.x, slab.center.y, slab.center.z);
      const q = slab.rotation!;
      mesh.quaternion.set(q.x, q.y, q.z, q.w);
      mesh.castShadow = mesh.receiveShadow = true;
      root.add(mesh);
    }
  scene.add(root);
  return {
    root,
    dispose() {
      root.removeFromParent();
      for (const geometry of geometries) geometry.dispose();
    },
  };
}
