import {
  BoxGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  Scene,
} from 'three';
import type { MapDefinition } from '../world/maps';

/** Render-only navigation landmarks. They have no colliders and are built
 * once at boot, so finding the proving-ground toys cannot affect physics or
 * the per-frame allocation budget. */
export interface WorldLandmarks {
  readonly root: Group;
  dispose(): void;
}

const BEACON_HEIGHT = 40;
const COLORS = Object.freeze({
  ramp: 0xff7a24,
  loop: 0x4fb0ff,
  aquifer: 0xffd34f,
});

export function createWorldLandmarks(
  scene: Scene,
  map: Readonly<MapDefinition>,
): WorldLandmarks {
  const root = new Group();
  root.name = 'world-landmarks';
  const geometries: Array<BoxGeometry | CylinderGeometry> = [];
  const materials: MeshStandardMaterial[] = [];

  const material = (color: number): MeshStandardMaterial => {
    const value = new MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.18,
      side: DoubleSide,
    });
    materials.push(value);
    return value;
  };
  const poleGeometry = new CylinderGeometry(0.35, 0.5, BEACON_HEIGHT, 8);
  const panelGeometry = new BoxGeometry(8, 24, 0.5);
  geometries.push(poleGeometry, panelGeometry);

  const beacon = (x: number, z: number, color: number): void => {
    const m = material(color);
    const pole = new Mesh(poleGeometry, m);
    pole.position.set(x, BEACON_HEIGHT / 2, z);
    pole.castShadow = true;
    root.add(pole);
    const panel = new Mesh(panelGeometry, m);
    panel.position.set(x, 12, z);
    panel.castShadow = true;
    root.add(panel);
  };

  for (const ramp of map.ramps) beacon(ramp.x, ramp.z, COLORS.ramp);
  for (const loop of map.loops) beacon(loop.x, loop.z, COLORS.loop);
  for (const pipe of map.halfPipes) beacon(pipe.x, pipe.z, COLORS.aquifer);

  scene.add(root);
  return {
    root,
    dispose() {
      root.removeFromParent();
      for (const geometry of geometries) geometry.dispose();
      for (const value of materials) value.dispose();
    },
  };
}
