import { BufferGeometry, Float32BufferAttribute, Group, Mesh } from 'three';
import type { Material, Scene } from 'three';
import { SURFACE_IDS, type SurfaceId } from '../content/surfaces';
import type { BodyId, V3 } from '../physics/adapter';
import type { SurfacedBodies, SurfacedStaticMeshDesc } from './surfacedBodies';

export interface JumpRampSpec {
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  /** Radius of the constant-curvature middle, not the eased ends. */
  readonly launchRadius: number;
  /** Exit tangent in radians; the launch arc starts flat at ground level. */
  readonly launchAngle: number;
  readonly entryEase: number;
  readonly lipEase: number;
  readonly gap: number;
  readonly landingLength: number;
  readonly width: number;
  readonly surface?: SurfaceId;
}

const THICKNESS = 0.3;
export const JUMP_LAUNCH_SEGMENTS = 128;
export const JUMP_LANDING_SEGMENTS = 300;

export function jumpRampLaunchLength(s: Readonly<JumpRampSpec>): number {
  return -launchProfile(s)[JUMP_LAUNCH_SEGMENTS]![0];
}

const launchHeading = (
  distance: number,
  length: number,
  entryEase: number,
  lipEase: number,
  angle: number,
  radius: number,
): number => {
  // A pair of clothoids around a constant-curvature middle. The tangent and
  // curvature are continuous at both joins, and curvature is zero at each end.
  const peakCurvature = 1 / radius;
  if (distance < entryEase)
    return (peakCurvature * distance * distance) / (2 * entryEase);
  if (distance > length - lipEase) {
    const remaining = length - distance;
    return angle - (peakCurvature * remaining * remaining) / (2 * lipEase);
  }
  return peakCurvature * (distance - entryEase / 2);
};

const launchProfile = (s: JumpRampSpec): [number, number][] => {
  // The ease distances extend the path. Holding the middle radius fixed avoids
  // making the ramp's steady load larger just to fit a former lip height.
  const length = s.launchRadius * s.launchAngle + (s.entryEase + s.lipEase) / 2;
  const step = length / JUMP_LAUNCH_SEGMENTS;
  const out: [number, number][] = [[0, 0]];
  let x = 0;
  let y = 0;
  for (let i = 0; i < JUMP_LAUNCH_SEGMENTS; i++) {
    const heading = launchHeading(
      (i + 0.5) * step,
      length,
      s.entryEase,
      s.lipEase,
      s.launchAngle,
      s.launchRadius,
    );
    x += Math.cos(heading) * step;
    y += Math.sin(heading) * step;
    out.push([-x, y]);
  }
  return out;
};
const landingProfile = (
  s: JumpRampSpec,
  lip: readonly [number, number],
): [number, number][] => {
  const out: [number, number][] = [];
  for (let i = 0; i <= JUMP_LANDING_SEGMENTS; i++) {
    const t = i / JUMP_LANDING_SEGMENTS;
    const z = lip[0] - s.gap - s.landingLength * t;
    // Descends immediately from the far edge, then levels onto ground.
    const y = lip[1] * (1 - t) * (1 - t);
    out.push([z, y]);
  }
  return out;
};

export function jumpRampMeshDescriptor(
  s: JumpRampSpec,
): SurfacedStaticMeshDesc {
  const surface = s.surface ?? SURFACE_IDS.asphalt;
  const launch = launchProfile(s);
  const profiles = [launch, landingProfile(s, launch[JUMP_LAUNCH_SEGMENTS]!)];
  const vertices: V3[] = [];
  const indices: number[] = [];
  const add = (x: number, y: number, z: number): number => {
    const c = Math.cos(s.heading),
      si = Math.sin(s.heading);
    vertices.push({ x: s.x + c * x - si * z, y, z: s.z + si * x + c * z });
    return vertices.length - 1;
  };
  const quad = (a: number, b: number, c: number, d: number) =>
    indices.push(a, c, b, a, d, c);
  for (const profile of profiles) {
    const rings: number[][] = [];
    for (const [z, y] of profile) {
      const ring = [
        add(-s.width / 2, y, z),
        add(s.width / 2, y, z),
        add(-s.width / 2, y - THICKNESS, z),
        add(s.width / 2, y - THICKNESS, z),
      ];
      rings.push(ring);
    }
    for (let i = 0; i < rings.length - 1; i++) {
      const a = rings[i]!,
        b = rings[i + 1]!;
      quad(a[0]!, b[0]!, b[1]!, a[1]!);
      quad(a[2]!, a[3]!, b[3]!, b[2]!);
      quad(a[0]!, a[2]!, b[2]!, b[0]!);
      quad(a[1]!, b[1]!, b[3]!, a[3]!);
    }
    const first = rings[0]!,
      last = rings[rings.length - 1]!;
    quad(first[0]!, first[1]!, first[3]!, first[2]!);
    quad(last[1]!, last[0]!, last[2]!, last[3]!);
  }
  return {
    center: { x: 0, y: 0, z: 0 },
    vertices,
    indices,
    friction: 0.5,
    restitution: 0,
    surface,
  };
}

export function installJumpRamps(
  bodies: SurfacedBodies,
  specs: readonly JumpRampSpec[],
): readonly BodyId[] {
  return specs.map((s) => bodies.createStaticMesh(jumpRampMeshDescriptor(s)));
}

export interface JumpRampVisual {
  readonly root: Group;
  dispose(): void;
}
export function createJumpRampVisual(
  scene: Scene,
  materialFor: (surface: SurfaceId) => Material,
  specs: readonly JumpRampSpec[],
): JumpRampVisual {
  const root = new Group();
  root.name = 'jump-ramps';
  const geometries: BufferGeometry[] = [];
  for (const s of specs) {
    const d = jumpRampMeshDescriptor(s);
    const g = new BufferGeometry();
    g.setAttribute(
      'position',
      new Float32BufferAttribute(
        d.vertices.flatMap((v) => [v.x, v.y, v.z]),
        3,
      ),
    );
    g.setIndex([...d.indices]);
    g.computeVertexNormals();
    geometries.push(g);
    const m = new Mesh(g, materialFor(d.surface));
    m.castShadow = m.receiveShadow = true;
    root.add(m);
  }
  scene.add(root);
  return {
    root,
    dispose() {
      root.removeFromParent();
      for (const g of geometries) g.dispose();
    },
  };
}
