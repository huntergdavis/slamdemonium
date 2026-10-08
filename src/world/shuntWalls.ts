import { BoxGeometry, Group } from 'three';
import type { Material, Scene } from 'three';
import { SURFACE_IDS } from '../content/surfaces';
import type { V3 } from '../physics/adapter';
import { createInstancedBatch } from './instances';
import type { RoadPath } from './roadGenerator';
import { poseAt } from './roadGenerator';
import type { SurfacedBodies } from './surfacedBodies';

/** A short, solid roadside barrier: the visual and collider share this pose. */
export interface ShuntWallSpec {
  readonly center: Readonly<V3>;
  readonly halfExtents: Readonly<V3>;
  readonly heading: number;
}

export function shuntWallAt(
  path: RoadPath,
  station: number,
  side: -1 | 1,
  length: number,
  roadWidth: number,
): ShuntWallSpec {
  const pose = poseAt(path, station);
  const offset = side * (roadWidth / 2 + 2);
  return {
    center: {
      x: pose.x - Math.cos(pose.heading) * offset,
      y: 1.1,
      z: pose.z + Math.sin(pose.heading) * offset,
    },
    halfExtents: { x: 0.65, y: 1.1, z: length / 2 },
    heading: pose.heading,
  };
}

export function installShuntWalls(
  bodies: SurfacedBodies,
  specs: readonly ShuntWallSpec[],
): readonly number[] {
  return specs.map((spec) =>
    bodies.createStaticBody({
      center: { ...spec.center },
      halfExtents: { ...spec.halfExtents },
      rotation: {
        x: 0,
        y: Math.sin(spec.heading / 2),
        z: 0,
        w: Math.cos(spec.heading / 2),
      },
      surface: SURFACE_IDS.concrete,
      friction: 0.8,
      restitution: 0.05,
    }),
  );
}

export function createShuntWallVisual(
  scene: Scene,
  material: Material,
  specs: readonly ShuntWallSpec[],
) {
  const root = new Group();
  root.name = 'shunt-walls';
  const geometry = new BoxGeometry(1, 1, 1);
  const batch = createInstancedBatch(
    'shunt-walls.concrete',
    geometry,
    material,
    specs.map((spec) => ({
      center: spec.center,
      size: {
        x: spec.halfExtents.x * 2,
        y: spec.halfExtents.y * 2,
        z: spec.halfExtents.z * 2,
      },
      rotY: spec.heading,
    })),
    true,
  );
  root.add(batch);
  scene.add(root);
  return {
    root,
    dispose() {
      root.removeFromParent();
      batch.dispose();
      geometry.dispose();
    },
  };
}
