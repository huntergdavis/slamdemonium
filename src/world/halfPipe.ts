import { BoxGeometry, Group, Mesh, Quaternion, Vector3 } from 'three';
import type { Material, Scene } from 'three';
import { SURFACE_IDS, type SurfaceId } from '../content/surfaces';
import type { BodyId, V3 } from '../physics/adapter';
import type { SurfacedBodies, SurfacedStaticBodyDesc } from './surfacedBodies';

/** A half-pipe transfer, built as a spine because the world is one ground
 * slab and cannot be trenched: a quarter-pipe wall rising from the ground,
 * a solid deck at the lip height, and a mirrored quarter-pipe wall down the
 * other side, open at ground level at both ends and therefore drivable from
 * either direction. `x`/`z` is the centre of the deck; `heading` is the
 * axis of travel in the ramp convention (radians, 0 = -Z, positive turns
 * left); the walls are symmetric about the deck.
 *
 * The recipe, measured in tests/integration/half-pipe.integration.ts on the
 * real engine and recorded in docs/DECISIONS.md. Our world runs 1.5 g and
 * the car arrives at 40 to 60 m/s, so a skate-style steep wall is a cannon:
 * a 65 to 80 degree exit threw the car 50 to 110 m up for 4 to 5 s and
 * landed it at 30 to 40 m/s, twice the giant ramp's landing. Exit angle
 * sets range and landing violence together (both follow the vertical
 * component of the launch: touchdown speed is launch speed x sin(exit) plus
 * the drop from the lip), so the wall exits at 30 degrees: from a 20 to 30
 * m/s approach the car lands at 15 to 23 m/s, the giant ramp's level; the
 * flat-out miss lands at 33, upright. Wall height is radius x
 * (1 - cos 30) = 0.134 R, so depth comes from radius, not steepness; the
 * arc above a 30 degree lip must never be built, even as picture, because
 * the launch is tangent to the circle and the rest of the arc curves back
 * over the car's path. Range is launch speed squared x sin 60 / g, about
 * v^2 / 17 with the launch speed 8 to 10 m/s above the approach speed under
 * full throttle; the deck under the gap makes an undershoot a landing and
 * the flat beyond the far wall gives an overshoot somewhere to land. */
export interface HalfPipeSpec {
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  /** Transition radius, metres; wall height is 0.134 R at the 30 degree exit. */
  readonly radius: number;
  /** Deck length between the two lips, metres: the gap to fly. */
  readonly deck: number;
  /** Lane width across the travel direction, metres. */
  readonly width: number;
  readonly surface?: SurfaceId;
}

/** Fixed by the recipe: steeper couples range to landing violence. */
export const HALF_PIPE_EXIT_ANGLE = (30 * Math.PI) / 180;
/** Below this the transition load climbs toward the loop's unfair region. */
export const MIN_HALF_PIPE_RADIUS = 16;
/** Recommended: a 5.4 m wall that reads as a pipe from the runway. */
export const DEEP_HALF_PIPE_RADIUS = 40;
export const HALF_PIPE_THICKNESS = 0.3;
/** Coping rails along both deck edges, outside the lane. */
export const HALF_PIPE_RAIL = Object.freeze({ width: 0.3, height: 0.8 });
const SEGMENT_ARC = 0.8;
const SEGMENT_OVERLAP = 1.12;

export function halfPipeForward(spec: Readonly<HalfPipeSpec>, out: V3): V3 {
  out.x = -Math.sin(spec.heading);
  out.y = 0;
  out.z = -Math.cos(spec.heading);
  return out;
}

/** Height of the deck and of both lips above the ground. */
export function halfPipeLipHeight(spec: Readonly<HalfPipeSpec>): number {
  return spec.radius * (1 - Math.cos(HALF_PIPE_EXIT_ANGLE));
}

/** Horizontal run of one wall, from its ground edge to its lip. */
export function halfPipeWallRun(spec: Readonly<HalfPipeSpec>): number {
  return spec.radius * Math.sin(HALF_PIPE_EXIT_ANGLE);
}

/** Along-heading half-length of the whole structure: two walls and the deck. */
export function halfPipeHalfLength(spec: Readonly<HalfPipeSpec>): number {
  return spec.deck / 2 + halfPipeWallRun(spec);
}

/** Flight range from a lip at the given launch speed, for placement checks. */
export function halfPipeRange(launchSpeed: number, gravity: number): number {
  return (
    (launchSpeed * launchSpeed * Math.sin(2 * HALF_PIPE_EXIT_ANGLE)) / gravity
  );
}

const scratch = {
  forward: new Vector3(),
  left: new Vector3(),
  up: new Vector3(),
  right: new Vector3(),
  centre: new Vector3(),
  quaternion: new Quaternion(),
  axis: new Vector3(),
};

/** Every static body: wall slabs on both sides, the deck, two coping rails. */
export function halfPipeSlabDescriptors(
  spec: Readonly<HalfPipeSpec>,
): SurfacedStaticBodyDesc[] {
  const surface = spec.surface ?? SURFACE_IDS.asphalt;
  const f = scratch.forward.set(
    -Math.sin(spec.heading),
    0,
    -Math.cos(spec.heading),
  );
  const l = scratch.left.set(0, 1, 0).cross(f).normalize(); // Across the lane.
  const R = spec.radius;
  const H = halfPipeLipHeight(spec);
  const run = halfPipeWallRun(spec);
  const out: SurfacedStaticBodyDesc[] = [];
  const pushBox = (
    centre: Vector3,
    halfExtents: V3,
    rotation: Quaternion,
    slabSurface: SurfaceId,
  ): void => {
    out.push({
      center: { x: centre.x, y: centre.y, z: centre.z },
      halfExtents,
      rotation: {
        x: rotation.x,
        y: rotation.y,
        z: rotation.z,
        w: rotation.w,
      },
      friction: 0.5,
      restitution: 0,
      surface: slabSurface,
    });
  };
  // Yaw of the whole structure about world Y.
  const yaw = new Quaternion().setFromAxisAngle(
    scratch.axis.set(0, 1, 0),
    spec.heading,
  );
  const n = Math.max(6, Math.round((R * HALF_PIPE_EXIT_ANGLE) / SEGMENT_ARC));
  const d = HALF_PIPE_EXIT_ANGLE / n;
  for (const side of [-1, 1]) {
    // Ground edge of this wall lies half a deck plus a wall run from the
    // centre, on the side it belongs to; the arc centre sits R above it.
    const groundEdge = side * (spec.deck / 2 + run);
    for (let i = 0; i < n; i++) {
      const phi = (i + 0.5) * d;
      // Along the heading: from the ground edge back toward the deck.
      const along = groundEdge - side * R * Math.sin(phi);
      const y = R * (1 - Math.cos(phi));
      // Surface normal toward the arc centre: up cos(phi), toward the deck sin(phi).
      const ny = Math.cos(phi);
      const nAlong = -side * Math.sin(phi);
      // Rotation about the lane's across axis (left) taking up to the normal:
      // positive angle tilts up toward -forward for side +1.
      const tilt = Math.atan2(nAlong, ny); // signed angle from up toward +forward
      scratch.quaternion.setFromAxisAngle(l, -tilt).multiply(yaw);
      scratch.up.set(0, 1, 0).applyQuaternion(scratch.quaternion);
      scratch.centre
        .set(spec.x, 0, spec.z)
        .addScaledVector(f, along)
        .setY(y)
        .addScaledVector(scratch.up, -HALF_PIPE_THICKNESS / 2);
      pushBox(
        scratch.centre,
        {
          x: spec.width / 2,
          y: HALF_PIPE_THICKNESS / 2,
          z: (R * d * SEGMENT_OVERLAP) / 2,
        },
        scratch.quaternion,
        surface,
      );
    }
  }
  // The deck: flat at lip height between the lips.
  scratch.centre.set(spec.x, H - HALF_PIPE_THICKNESS / 2, spec.z);
  pushBox(
    scratch.centre,
    { x: spec.width / 2, y: HALF_PIPE_THICKNESS / 2, z: spec.deck / 2 + 0.2 },
    yaw,
    surface,
  );
  // Coping rails along both deck edges, just outside the lane.
  for (const side of [-1, 1]) {
    scratch.centre
      .set(spec.x, H + HALF_PIPE_RAIL.height / 2, spec.z)
      .addScaledVector(l, side * (spec.width / 2 + HALF_PIPE_RAIL.width / 2));
    pushBox(
      scratch.centre,
      {
        x: HALF_PIPE_RAIL.width / 2,
        y: HALF_PIPE_RAIL.height / 2,
        z: spec.deck / 2,
      },
      yaw,
      SURFACE_IDS.concrete,
    );
  }
  return out;
}

/** Ground-plane corners of the whole footprint, for clearance checks. */
export function halfPipeFootprint(spec: Readonly<HalfPipeSpec>): {
  x: number;
  z: number;
  radius: number;
} {
  return {
    x: spec.x,
    z: spec.z,
    radius: Math.hypot(
      halfPipeHalfLength(spec),
      spec.width / 2 + HALF_PIPE_RAIL.width,
    ),
  };
}

export function installHalfPipes(
  bodies: SurfacedBodies,
  specs: readonly HalfPipeSpec[],
): readonly BodyId[] {
  const ids: BodyId[] = [];
  for (const spec of specs)
    for (const slab of halfPipeSlabDescriptors(spec))
      ids.push(bodies.createStaticBody(slab));
  return ids;
}

export interface HalfPipeVisual {
  readonly root: Group;
  dispose(): void;
}

/** One box mesh per slab, each in the material of its own surface. */
export function createHalfPipeVisual(
  scene: Scene,
  materialFor: (surface: SurfaceId) => Material,
  specs: readonly HalfPipeSpec[],
): HalfPipeVisual {
  const root = new Group();
  root.name = 'half-pipes';
  const geometries: BoxGeometry[] = [];
  for (const spec of specs)
    for (const slab of halfPipeSlabDescriptors(spec)) {
      const geometry = new BoxGeometry(
        slab.halfExtents.x * 2,
        slab.halfExtents.y * 2,
        slab.halfExtents.z * 2,
      );
      geometries.push(geometry);
      const mesh = new Mesh(geometry, materialFor(slab.surface as SurfaceId));
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
