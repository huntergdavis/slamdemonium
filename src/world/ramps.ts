import { BoxGeometry, Group, Mesh, Quaternion, Vector3 } from 'three';
import type { Material, Scene } from 'three';
import { SURFACE_IDS } from '../content/surfaces';
import type { BodyId, Quat, V3 } from '../physics/adapter';
import type { SurfacedBodies, SurfacedStaticBodyDesc } from './surfacedBodies';

/** One authored ramp: a pitched slab whose low edge sits flush with the
 * ground. `heading` is the launch direction (yaw, radians, 0 = -Z, positive
 * turns left like steering). `x`/`z` locate the low edge's centre, so moving
 * a ramp is a data change and the slab grows away from that point. */
export interface RampSpec {
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  /** Along the launch direction, metres. */
  readonly length: number;
  readonly width: number;
  /** Height of the lip at the far end, metres; pitch is atan(rise / length). */
  readonly rise: number;
  /** A triangle: a second, mirrored face descends from the lip so the ramp
   * can be driven from either direction and a test run never has to circle
   * back to re-approach. Its low edge lies 2 * length along the heading. */
  readonly symmetric?: boolean;
}

/** Slab thickness; the low edge buries this much below the ground plane. */
export const RAMP_THICKNESS = 0.3;

/** Four ramps on the infield side of the racing line, launching along the
 * ring and turned 15 degrees inward so a jump drifts toward the centre and
 * can never clear the 152 m barrier and drop past the kill plane. The two
 * small ones sit at about 113 m radius, the two big ones at about 105 m, so
 * every footprint ends inside 120 m and the 127 to 130 m line the example
 * scripts follow clears them by over six metres (the clearance test asks
 * for five; at 120 m the ring lap came within 3.6 m). A driver steers onto
 * them from the racing line. At 40 m/s the first launches about 5 m/s upward
 * for a 0.7 s, 30 m hop; the second about 7 m/s for a 0.9 s, 36 m jump.
 * Both are data: the ramp clearance test measures every example route
 * against them, so a moved ramp fails a test before it surprises a replay. */
export const RAMP_LAYOUT: readonly RampSpec[] = Object.freeze([
  Object.freeze({
    x: 0,
    z: -113,
    heading: -Math.PI / 2 - (15 * Math.PI) / 180,
    length: 12,
    width: 6,
    rise: 1.6,
  }),
  Object.freeze({
    x: 0,
    z: 113,
    heading: Math.PI / 2 - (15 * Math.PI) / 180,
    length: 14,
    width: 6,
    rise: 2.4,
  }),
  // Two bigger ramps at the east and west points, in the quadrants the prop
  // banks do not use, launching along the ring's counter-clockwise direction
  // and 15 degrees inward. East: 18 m long, 3.5 m lip, about 1 s and 40 m of
  // flight at 40 m/s with a 6 m apex. West: 24 m long, 6 m lip, about 1.3 s
  // and 50 m with a 9 m apex; from 105 m radius it lands near 100 m, far
  // inside the 152 m barrier. Their footprints end near 118 m, still over
  // eight metres inside the example routes.
  Object.freeze({
    x: 105,
    z: 0,
    heading: Math.PI - (15 * Math.PI) / 180,
    length: 18,
    width: 8,
    rise: 3.5,
  }),
  Object.freeze({
    x: -105,
    z: 0,
    heading: -(15 * Math.PI) / 180,
    length: 24,
    width: 8,
    rise: 6,
  }),
]);

export function rampPitch(spec: Readonly<RampSpec>): number {
  return Math.atan2(spec.rise, spec.length);
}

const scratchYaw = new Quaternion();
const scratchPitch = new Quaternion();
const scratchAxis = new Vector3();
const scratchForward = new Vector3();

/** Static body for a ramp: one pitched box, asphalt surface, low edge on the
 * ground. Allocation free apart from the returned descriptor; call at boot. */
export function rampBodyDescriptor(
  spec: Readonly<RampSpec>,
): SurfacedStaticBodyDesc {
  const pitch = rampPitch(spec);
  const half = Math.hypot(spec.length, spec.rise) / 2; // Slab half-length along its slope.
  // Yaw about world Y, then nose-up pitch about the slab's own right axis.
  scratchYaw.setFromAxisAngle(scratchAxis.set(0, 1, 0), spec.heading);
  scratchForward.set(0, 0, -1).applyQuaternion(scratchYaw);
  scratchAxis.set(1, 0, 0).applyQuaternion(scratchYaw);
  scratchPitch.setFromAxisAngle(scratchAxis, pitch);
  const rotation = scratchPitch.multiply(scratchYaw);
  // Centre sits half a slab up the slope from the low edge, lifted so the low
  // edge's top corner is exactly at ground level.
  const centreLift =
    half * Math.sin(pitch) - (RAMP_THICKNESS / 2) * Math.cos(pitch);
  const along = half * Math.cos(pitch);
  return {
    center: {
      x: spec.x + scratchForward.x * along,
      y: centreLift,
      z: spec.z + scratchForward.z * along,
    },
    halfExtents: { x: spec.width / 2, y: RAMP_THICKNESS / 2, z: half },
    rotation: { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w },
    friction: 0.5,
    restitution: 0,
    surface: SURFACE_IDS.asphalt,
  };
}

/** The back face of a triangle ramp as its own spec: same slab, launching
 * the other way, low edge two lengths along the heading from the front's. */
export function rampBackFace(spec: Readonly<RampSpec>): RampSpec {
  const f = rampForward(spec, { x: 0, y: 0, z: 0 });
  // Each slab's top surface stops half a thickness short of the apex (its
  // low-edge top corner sits at the spec point, so its far top corner is at
  // length - thickness/2 * sin(pitch)); pulling the back face in by a full
  // thickness * sin(pitch) makes the two top surfaces meet at one ridge.
  const span = 2 * spec.length - RAMP_THICKNESS * Math.sin(rampPitch(spec));
  return {
    x: spec.x + f.x * span,
    z: spec.z + f.z * span,
    heading: spec.heading + Math.PI,
    length: spec.length,
    width: spec.width,
    rise: spec.rise,
  };
}

/** Every static body of a ramp: one slab, or two meeting at the lip. */
export function rampBodyDescriptors(
  spec: Readonly<RampSpec>,
): SurfacedStaticBodyDesc[] {
  const slabs = [rampBodyDescriptor(spec)];
  if (spec.symmetric) slabs.push(rampBodyDescriptor(rampBackFace(spec)));
  return slabs;
}

/** Horizontal footprint radius from the slab centre, for clearance checks. */
export function rampFootprintRadius(spec: Readonly<RampSpec>): number {
  return Math.hypot(spec.length / 2, spec.width / 2);
}

/** Ground-plane disc containing every face of the ramp: for a single slab
 * its own centre and radius; for a triangle, centred on the lip. */
export function rampFootprint(spec: Readonly<RampSpec>): {
  x: number;
  z: number;
  radius: number;
} {
  if (!spec.symmetric) {
    const d = rampBodyDescriptor(spec);
    return { x: d.center.x, z: d.center.z, radius: rampFootprintRadius(spec) };
  }
  const f = rampForward(spec, { x: 0, y: 0, z: 0 });
  return {
    x: spec.x + f.x * spec.length,
    z: spec.z + f.z * spec.length,
    radius: Math.hypot(spec.length, spec.width / 2),
  };
}

/** Installs every ramp through the facade, so each registers its asphalt
 * surface in the same call that creates its body: a ramp can never be the
 * unregistered body that gives suspension force and no grip. */
export function installRamps(
  bodies: SurfacedBodies,
  specs: readonly RampSpec[] = RAMP_LAYOUT,
): readonly BodyId[] {
  return specs.flatMap((spec) =>
    rampBodyDescriptors(spec).map((slab) => bodies.createStaticBody(slab)),
  );
}

export interface RampVisual {
  readonly root: Group;
  dispose(): void;
}

/** One box mesh per ramp from the same descriptor the collider uses, so
 * collision and visual cannot disagree. Materials belong to the track. */
export function createRampVisual(
  scene: Scene,
  material: Material,
  specs: readonly RampSpec[] = RAMP_LAYOUT,
): RampVisual {
  const root = new Group();
  root.name = 'ramps';
  const geometries: BoxGeometry[] = [];
  for (const spec of specs)
    for (const desc of rampBodyDescriptors(spec)) {
      const geometry = new BoxGeometry(
        desc.halfExtents.x * 2,
        desc.halfExtents.y * 2,
        desc.halfExtents.z * 2,
      );
      geometries.push(geometry);
      const mesh = new Mesh(geometry, material);
      mesh.position.set(desc.center.x, desc.center.y, desc.center.z);
      const q = desc.rotation as Quat;
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

/** Convenience for tests and tools: the launch direction as a unit vector. */
export function rampForward(spec: Readonly<RampSpec>, out: V3): V3 {
  out.x = -Math.sin(spec.heading);
  out.y = 0;
  out.z = -Math.cos(spec.heading);
  return out;
}
