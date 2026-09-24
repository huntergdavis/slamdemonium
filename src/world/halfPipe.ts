import { BoxGeometry, Group, Mesh, Quaternion, Vector3 } from 'three';
import type { Material, Scene } from 'three';
import { SURFACE_IDS, type SurfaceId } from '../content/surfaces';
import type { BodyId, V3 } from '../physics/adapter';
import type { SurfacedBodies, SurfacedStaticBodyDesc } from './surfacedBodies';

/** A long, ground-level U channel: the floor stays at world ground and two
 * curved walls rise on either side of the travel lane. The car drives through
 * it like an aquifer rather than crossing an elevated spine. deck is the open
 * channel length and width is the flat floor width. The smooth R16/85 degree
 * recipe is contained at 40–50 m/s; at 60 m/s it launches laterally beyond the
 * channel, so the ride window is deliberately recorded rather than implied. */
export interface HalfPipeSpec {
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  /** Transition radius, metres; wall height is radius x (1 - cos lip). */
  readonly radius: number;
  /** Open channel length along the travel axis, metres. */
  readonly deck: number;
  /** Flat floor width across the travel direction, metres. */
  readonly width: number;
  readonly surface?: SurfaceId;
}

/** Near-vertical channel lip from the measured aquifer ride. */
export const HALF_PIPE_EXIT_ANGLE = (85 * Math.PI) / 180;
/** Below this the transition load climbs toward the loop's unfair region. */
export const MIN_HALF_PIPE_RADIUS = 16;
/** Shipped aquifer wall: about 15 m tall at gravity 20. */
export const DEEP_HALF_PIPE_RADIUS = 16;
export const HALF_PIPE_THICKNESS = 0.3;
/** Coping rails along both wall lips, outside the lane. */
export const HALF_PIPE_RAIL = Object.freeze({ width: 0.3, height: 0.8 });
/** Maximum arc length of one wall collider/mesh segment.  At the fixed 120 Hz
 * step a fast car travels farther than this in one step, so the overlapping
 * segments present a continuous transition rather than staircase steps. */
export const HALF_PIPE_SEGMENT_ARC = 0.2;
const SEGMENT_OVERLAP = 1.08;

export function halfPipeForward(spec: Readonly<HalfPipeSpec>, out: V3): V3 {
  out.x = -Math.sin(spec.heading);
  out.y = 0;
  out.z = -Math.cos(spec.heading);
  return out;
}

/** Height of each wall lip above the ground. */
export function halfPipeLipHeight(spec: Readonly<HalfPipeSpec>): number {
  return spec.radius * (1 - Math.cos(HALF_PIPE_EXIT_ANGLE));
}

/** Horizontal run of one wall from its floor edge to its lip. */
export function halfPipeWallRun(spec: Readonly<HalfPipeSpec>): number {
  return spec.radius * Math.sin(HALF_PIPE_EXIT_ANGLE);
}

/** Along-heading half-length of the open channel. */
export function halfPipeHalfLength(spec: Readonly<HalfPipeSpec>): number {
  return spec.deck / 2;
}

/** Flight range from a lip at the given launch speed, retained for placement checks. */
export function halfPipeRange(launchSpeed: number, gravity: number): number {
  return (
    (launchSpeed * launchSpeed * Math.sin(2 * HALF_PIPE_EXIT_ANGLE)) / gravity
  );
}

const scratch = {
  forward: new Vector3(),
  left: new Vector3(),
  up: new Vector3(),
  centre: new Vector3(),
  quaternion: new Quaternion(),
  axis: new Vector3(),
};

/** Every static body: two curved walls and coping rails. The proving-ground
 * track already supplies the channel floor; duplicating it at Y=0 would
 * z-fight with the asphalt ground and make the texture shimmer while driving.
 */
export function halfPipeSlabDescriptors(
  spec: Readonly<HalfPipeSpec>,
): SurfacedStaticBodyDesc[] {
  const surface = spec.surface ?? SURFACE_IDS.asphalt;
  const f = scratch.forward.set(
    -Math.sin(spec.heading),
    0,
    -Math.cos(spec.heading),
  );
  const l = scratch.left.set(0, 1, 0).cross(f).normalize();
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
      rotation: { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w },
      friction: 0.5,
      restitution: 0,
      surface: slabSurface,
    });
  };
  const yaw = new Quaternion().setFromAxisAngle(
    scratch.axis.set(0, 1, 0),
    spec.heading,
  );
  const n = Math.max(
    32,
    Math.ceil((R * HALF_PIPE_EXIT_ANGLE) / HALF_PIPE_SEGMENT_ARC),
  );
  const d = HALF_PIPE_EXIT_ANGLE / n;
  for (const side of [-1, 1]) {
    for (let i = 0; i < n; i++) {
      const phi = (i + 0.5) * d;
      const across = side * (spec.width / 2 + R * Math.sin(phi));
      const y = R * (1 - Math.cos(phi));
      const roll = new Quaternion().setFromAxisAngle(
        scratch.axis.set(0, 0, 1),
        side > 0 ? phi : Math.PI - phi,
      );
      scratch.quaternion.copy(yaw).multiply(roll);
      scratch.centre.set(spec.x, y, spec.z).addScaledVector(l, across);
      pushBox(
        scratch.centre,
        {
          x: (R * d * SEGMENT_OVERLAP) / 2,
          y: HALF_PIPE_THICKNESS / 2,
          z: spec.deck / 2,
        },
        scratch.quaternion,
        surface,
      );
    }
  }
  // The map's existing ground collider and mesh are the channel floor. Do
  // not add a coplanar floor body or mesh: two asphalt surfaces at Y=0
  // produce depth fighting and visibly jumping ground texture.
  for (const side of [-1, 1]) {
    scratch.centre
      .set(spec.x, H + HALF_PIPE_RAIL.height / 2, spec.z)
      .addScaledVector(
        l,
        side * (spec.width / 2 + run + HALF_PIPE_RAIL.width / 2),
      );
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

/** Ground-plane footprint of the whole channel and its wall lips. */
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
      spec.width / 2 + halfPipeWallRun(spec) + HALF_PIPE_RAIL.width,
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
