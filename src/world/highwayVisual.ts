import { Group, MeshStandardMaterial, PlaneGeometry, type Scene } from 'three';
import { createInstancedBatch } from './instances';
import { HIGHWAY_DECKS } from './highwayCourse';
import { HIGHWAY_EXPRESS_PATH } from './highwayCourse';
import { poseAt } from './roadGenerator';

/** One unshadowed draw for both wide road decks; paint is above this layer. */
export function createHighwayVisual(scene: Scene) {
  const root = new Group();
  root.name = 'highway';
  const geometry = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const material = new MeshStandardMaterial({ color: 0x292d31, roughness: 1 });
  const mergePaint = new MeshStandardMaterial({
    color: 0xe8d999,
    roughness: 1,
  });
  const deck = createInstancedBatch(
    'highway.asphalt',
    geometry,
    material,
    HIGHWAY_DECKS.map((lane) => ({
      center: { x: lane.x, y: 0.012, z: lane.z },
      size: { x: lane.width, y: 1, z: lane.length + 0.08 },
      rotY: lane.heading,
    })),
    false,
  );
  root.add(deck);
  const chevrons = createInstancedBatch(
    'highway.merge-chevron',
    geometry,
    mergePaint,
    Array.from({ length: 8 }, (_, index) => {
      const pose = poseAt(HIGHWAY_EXPRESS_PATH, 1750 + index * 18);
      return {
        center: { x: pose.x + 7, y: 0.02, z: pose.z },
        size: { x: 1.6, y: 1, z: 12 },
        rotY: pose.heading + 0.55,
      };
    }),
    false,
  );
  root.add(chevrons);
  scene.add(root);
  return {
    root,
    dispose() {
      root.removeFromParent();
      deck.dispose();
      chevrons.dispose();
      geometry.dispose();
      material.dispose();
      mergePaint.dispose();
    },
  };
}
