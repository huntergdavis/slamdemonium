import {
  BoxGeometry,
  CanvasTexture,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  Scene,
  Sprite,
  SpriteMaterial,
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
  const geometries: Array<BoxGeometry | ConeGeometry | CylinderGeometry> = [];
  const materials: Array<MeshStandardMaterial | SpriteMaterial> = [];
  const textures: CanvasTexture[] = [];

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
  const capGeometry = new ConeGeometry(2.5, 5, 4);
  const panelGeometry = new BoxGeometry(8, 24, 0.5);
  geometries.push(poleGeometry, capGeometry, panelGeometry);

  const label = (
    text: string,
    x: number,
    z: number,
    y = BEACON_HEIGHT + 7,
    width = 18,
  ): void => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.fillStyle = '#07111c';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = '#f4f7fa';
    context.lineWidth = 8;
    context.strokeRect(4, 4, canvas.width - 8, canvas.height - 8);
    context.fillStyle = '#ffffff';
    context.font = 'bold 42px sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, canvas.width / 2, canvas.height / 2);
    const texture = new CanvasTexture(canvas);
    const spriteMaterial = new SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });
    const sprite = new Sprite(spriteMaterial);
    sprite.position.set(x, y, z);
    sprite.scale.set(width, width / 4, 1);
    root.add(sprite);
    textures.push(texture);
    materials.push(spriteMaterial);
  };

  const beacon = (word: string, x: number, z: number, color: number): void => {
    const m = material(color);
    const pole = new Mesh(poleGeometry, m);
    pole.position.set(x, BEACON_HEIGHT / 2, z);
    pole.castShadow = true;
    root.add(pole);
    const cap = new Mesh(capGeometry, m);
    cap.position.set(x, BEACON_HEIGHT + 1.75, z);
    cap.castShadow = true;
    root.add(cap);
    const panel = new Mesh(panelGeometry, m);
    panel.position.set(x, 12, z);
    panel.castShadow = true;
    root.add(panel);
    const distance = Math.round(
      Math.hypot(x - (map.spawn?.x ?? 0), z - (map.spawn?.z ?? -340)),
    );
    label(`${word} ${distance}m`, x, z);
  };

  for (const ramp of map.ramps) beacon('RAMPS', ramp.x, ramp.z, COLORS.ramp);
  for (const loop of map.loops) beacon('LOOP', loop.x, loop.z, COLORS.loop);
  for (const pipe of map.halfPipes)
    beacon('AQUIFER', pipe.x, pipe.z, COLORS.aquifer);

  // A compact direction board sits in the spawn sightline. The three arrows
  // use the same colours as the distant beacons: north for ramps/loops and
  // west for the aquifer on the proving ground.
  const spawnX = map.spawn?.x ?? 0;
  const spawnZ = map.spawn?.z ?? -340;
  const spawnHeading = map.spawn?.heading ?? 0;
  const forwardZ = -Math.cos(spawnHeading);
  const board = new Mesh(new BoxGeometry(18, 5, 0.35), material(0x17222e));
  board.position.set(spawnX, 5, spawnZ + forwardZ * 24);
  board.castShadow = true;
  root.add(board);
  const arrowGeometry = new ConeGeometry(1.15, 3.4, 4);
  geometries.push(arrowGeometry);
  const arrows = [
    { x: -5, color: COLORS.aquifer, angle: -Math.PI / 2 },
    { x: 0, color: COLORS.ramp, angle: 0 },
    { x: 5, color: COLORS.loop, angle: 0 },
  ];
  for (const arrow of arrows) {
    const arrowMesh = new Mesh(arrowGeometry, material(arrow.color));
    arrowMesh.position.set(
      board.position.x + arrow.x,
      5,
      board.position.z - 0.3,
    );
    arrowMesh.rotation.set(0, arrow.angle, Math.PI / 2);
    arrowMesh.castShadow = true;
    root.add(arrowMesh);
  }
  const firstRamp = map.ramps[0];
  const firstLoop = map.loops[0];
  const firstPipe = map.halfPipes[0];
  const distance = (x: number, z: number) =>
    `${Math.round(Math.hypot(x - spawnX, z - spawnZ))}m`;
  if (firstPipe)
    label(
      `AQUIFER ${distance(firstPipe.x, firstPipe.z)}`,
      board.position.x - 5,
      board.position.z - 0.5,
      8,
      5.4,
    );
  if (firstRamp)
    label(
      `RAMPS ${distance(firstRamp.x, firstRamp.z)}`,
      board.position.x,
      board.position.z - 0.5,
      8,
      5.4,
    );
  if (firstLoop)
    label(
      `LOOP ${distance(firstLoop.x, firstLoop.z)}`,
      board.position.x + 5,
      board.position.z - 0.5,
      8,
      5.4,
    );
  scene.add(root);
  return {
    root,
    dispose() {
      root.removeFromParent();
      for (const geometry of geometries) geometry.dispose();
      for (const value of materials) value.dispose();
      for (const texture of textures) texture.dispose();
    },
  };
}
