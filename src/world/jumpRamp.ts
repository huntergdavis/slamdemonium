import { BufferGeometry, Float32BufferAttribute, Group, Mesh } from 'three';
import type { Material, Scene } from 'three';
import { SURFACE_IDS } from '../content/surfaces';
import type { BodyId, V3 } from '../physics/adapter';
import type { SurfacedBodies, SurfacedStaticMeshDesc } from './surfacedBodies';

export interface JumpRampSpec {
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  readonly launchLength: number;
  readonly launchHeight: number;
  readonly gap: number;
  readonly landingLength: number;
  readonly width: number;
  readonly surface?: number;
}

const THICKNESS = 0.3;
const launchProfile = (s: JumpRampSpec): [number, number][] => {
  const out: [number, number][] = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const z = -s.launchLength * t;
    const y = s.launchHeight * (t * t * (3 - 2 * t));
    out.push([z, y]);
  }
  return out;
};
const landingProfile = (s: JumpRampSpec): [number, number][] => {
  const out: [number, number][] = [];
  for (let i = 0; i <= 64; i++) {
    const t = i / 64;
    const z = -s.launchLength - s.gap - s.landingLength * t;
    const y = s.launchHeight * (1 - t * t * (3 - 2 * t));
    out.push([z, y]);
  }
  return out;
};

function meshDescriptor(s: JumpRampSpec): SurfacedStaticMeshDesc {
  const surface = s.surface ?? SURFACE_IDS.asphalt;
  const profiles = [launchProfile(s), landingProfile(s)];
  const vertices: V3[] = [];
  const indices: number[] = [];
  const add = (x: number, y: number, z: number): number => {
    const c = Math.cos(s.heading),
      si = Math.sin(s.heading);
    vertices.push({ x: s.x + c * x - si * z, y, z: s.z + si * x + c * z });
    return vertices.length - 1;
  };
  const quad = (a: number, b: number, c: number, d: number) =>
    indices.push(a, b, c, a, c, d);
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
  return specs.map((s) => bodies.createStaticMesh(meshDescriptor(s)));
}

export interface JumpRampVisual {
  readonly root: Group;
  dispose(): void;
}
export function createJumpRampVisual(
  scene: Scene,
  materialFor: (surface: number) => Material,
  specs: readonly JumpRampSpec[],
): JumpRampVisual {
  const root = new Group();
  root.name = 'jump-ramps';
  const geometries: BufferGeometry[] = [];
  for (const s of specs) {
    const d = meshDescriptor(s);
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
