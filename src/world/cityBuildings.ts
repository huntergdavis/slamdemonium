import { BoxGeometry, Group, MeshBasicMaterial } from 'three';
import type { Scene } from 'three';
import type { V3 } from '../physics/adapter';
import { createInstancedBatch } from './instances';

/** Visual city massing. Buildings stand beyond the roads and have no collision. */
export interface CityBuildingSpec {
  readonly center: Readonly<V3>;
  readonly size: Readonly<V3>;
  readonly color: number;
}

/** One unlit, unshadowed draw for all skyline and junction-corner blocks. */
export function createCityBuildingsVisual(
  scene: Scene,
  specs: readonly CityBuildingSpec[],
) {
  const root = new Group();
  root.name = 'city.buildings';
  const geometry = new BoxGeometry(1, 1, 1);
  const material = new MeshBasicMaterial({ color: 0xffffff, fog: true });
  const batch = createInstancedBatch(
    'city.buildings.instanced',
    geometry,
    material,
    specs.map((spec) => ({
      center: spec.center,
      size: spec.size,
      rotY: 0,
      color: spec.color,
    })),
    false,
  );
  root.add(batch);
  scene.add(root);
  return {
    dispose() {
      root.removeFromParent();
      batch.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}
