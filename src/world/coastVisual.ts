import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  type Scene,
} from 'three';
import { createInstancedBatch } from './instances';
import { COAST_ROAD_DECKS } from './coastCourse';

/** Four cheap draws: sand, sea, shared two-route asphalt and inland cliffs.
 * The existing single ground collider supports both lanes and their joins. */
export function createCoastVisual(scene: Scene) {
  const root = new Group();
  root.name = 'coast';
  const plane = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const box = new BoxGeometry(1, 1, 1);
  const sand = new MeshStandardMaterial({ color: 0xa99a72, roughness: 1 });
  const water = new MeshBasicMaterial({ color: 0x1875a5 });
  const asphalt = new MeshStandardMaterial({ color: 0x34383b, roughness: 1 });
  const rock = new MeshStandardMaterial({ color: 0x74674d, roughness: 1 });
  const sandPlane = new Mesh(plane, sand);
  sandPlane.name = 'coast.sand';
  sandPlane.position.y = 0.004;
  sandPlane.scale.set(4300, 1, 3600);
  root.add(sandPlane);
  const seaPlane = new Mesh(plane, water);
  seaPlane.name = 'coast.sea';
  seaPlane.position.set(1250, 0.009, 0);
  seaPlane.scale.set(1900, 1, 3300);
  root.add(seaPlane);
  const deck = createInstancedBatch(
    'coast.asphalt',
    plane,
    asphalt,
    COAST_ROAD_DECKS.map((lane) => ({
      center: { x: lane.x, y: 0.012, z: lane.z },
      size: { x: lane.width, y: 1, z: lane.length + 0.08 },
      rotY: lane.heading,
    })),
    false,
  );
  root.add(deck);
  const cliffs = createInstancedBatch(
    'coast.cliffs',
    box,
    rock,
    Array.from({ length: 50 }, (_, i) => {
      const height = 17 + ((i * 17) % 19);
      return {
        center: { x: -342 - (i % 3) * 16, y: height / 2, z: -930 + i * 38 },
        size: { x: 30 + (i % 3) * 11, y: height, z: 40 },
        rotY: 0,
      };
    }),
    false,
  );
  root.add(cliffs);
  scene.add(root);
  return {
    root,
    dispose() {
      root.removeFromParent();
      deck.dispose();
      cliffs.dispose();
      plane.dispose();
      box.dispose();
      sand.dispose();
      water.dispose();
      asphalt.dispose();
      rock.dispose();
    },
  };
}
