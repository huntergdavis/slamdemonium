import { Group, MeshBasicMaterial, PlaneGeometry } from 'three';
import type { Scene } from 'three';
import { createInstancedBatch } from './instances';
import type { RunwaySpec } from './runways';

/** A visual-only roadway over the world's continuous asphalt collider. */
export interface RoadDeckSpec extends RunwaySpec {
  readonly height: number;
}

export function createRoadDeckVisual(
  scene: Scene,
  specs: readonly RoadDeckSpec[],
): { dispose(): void } {
  const root = new Group();
  root.name = 'road.decks';
  const geometry = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const material = new MeshBasicMaterial({
    color: 0x32393d,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  root.add(
    createInstancedBatch(
      'road.decks.instanced',
      geometry,
      material,
      specs.map((spec) => ({
        center: { x: spec.x, y: spec.height, z: spec.z },
        size: { x: spec.width, y: 1, z: spec.length },
        rotY: spec.heading,
      })),
      false,
    ),
  );
  scene.add(root);
  return {
    dispose() {
      scene.remove(root);
      geometry.dispose();
      material.dispose();
    },
  };
}
