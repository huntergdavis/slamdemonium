import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Vector3,
  type Texture,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import sedanUrl from '../../assets/cars/kenney-car-kit-3.1/sedan-sports-embedded.glb?url';
import { VEHICLE_GEOMETRY as G } from '../vehicle/constants';
import type { HeroPaint } from '../vehicle/vehicleDefinition';

type DeformMesh = {
  geometry: BufferGeometry;
  pristine: Float32Array;
};

export interface HeroCarModel {
  readonly deformMeshes: readonly DeformMesh[];
  setLod(lod: 'near' | 'far'): void;
  setPaint(paint: HeroPaint): void;
  dispose(): void;
}

const WHEEL_NODES = [
  'wheel-front-left',
  'wheel-front-right',
  'wheel-back-left',
  'wheel-back-right',
] as const;

function namedMesh(
  root: Group,
  name: string,
): Mesh<BufferGeometry, MeshStandardMaterial> {
  const object = root.getObjectByName(name);
  if (
    !(object instanceof Mesh) ||
    !(object.material instanceof MeshStandardMaterial)
  )
    throw new Error('Hero car is missing mesh ' + name);
  return object as Mesh<BufferGeometry, MeshStandardMaterial>;
}

/** Paint only warm body swatches; windows, glass, lamps and tyres keep the source palette. */
function paintTexture(
  source: Texture,
  paint: Exclude<HeroPaint, 'orange'>,
): CanvasTexture {
  const image = source.image as CanvasImageSource & {
    width: number;
    height: number;
  };
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Hero paint canvas unavailable');
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const target = paint === 'blue' ? [65, 148, 235] : [87, 192, 126];
  for (let i = 0; i < pixels.data.length; i += 4) {
    const red = pixels.data[i]!;
    const green = pixels.data[i + 1]!;
    const blue = pixels.data[i + 2]!;
    if (red < 110 || red <= green * 1.18 || green < blue * 0.85) continue;
    const shade = Math.max(0.3, red / 255);
    pixels.data[i] = Math.round(target[0]! * shade);
    pixels.data[i + 1] = Math.round(target[1]! * shade);
    pixels.data[i + 2] = Math.round(target[2]! * shade);
  }
  context.putImageData(pixels, 0, 0);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = source.colorSpace;
  texture.flipY = source.flipY;
  texture.magFilter = source.magFilter;
  texture.minFilter = source.minFilter;
  texture.wrapS = source.wrapS;
  texture.wrapT = source.wrapT;
  texture.anisotropy = source.anisotropy;
  return texture;
}

/** Load once at boot. The returned meshes own no vehicle state or physics body. */
export async function mountHeroCarModel(
  root: Group,
  wheelSpins: readonly Group[],
): Promise<HeroCarModel> {
  const gltf = await new GLTFLoader().loadAsync(sedanUrl);
  const source = gltf.scene;
  source.updateMatrixWorld(true);
  const body = namedMesh(source, 'body');
  const spoiler = namedMesh(source, 'spoiler');
  const sourceMaterial = body.material;
  const sourceTexture = sourceMaterial.map;
  if (!sourceTexture) throw new Error('Hero car palette unavailable');

  const ownedGeometries = new Set<BufferGeometry>();
  const ownedMaterials = new Set<MeshStandardMaterial>();
  const ownedTextures = new Set<Texture>([sourceTexture]);
  const mounted: Mesh[] = [];
  const deformMeshes: DeformMesh[] = [];
  source.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    ownedGeometries.add(object.geometry);
    if (object.material instanceof MeshStandardMaterial)
      ownedMaterials.add(object.material);
  });

  const bodySource = body.geometry.clone().applyMatrix4(body.matrixWorld);
  bodySource.computeBoundingBox();
  const bounds = bodySource.boundingBox!;
  const center = bounds.getCenter(new Vector3());
  const span = bounds.getSize(new Vector3());
  const sx = G.width / span.x;
  const sy = G.height / span.y;
  const sz = G.length / span.z;
  bodySource.dispose();

  const maps: Record<HeroPaint, Texture> = {
    orange: sourceTexture,
    blue: paintTexture(sourceTexture, 'blue'),
    green: paintTexture(sourceTexture, 'green'),
  };
  ownedTextures.add(maps.blue);
  ownedTextures.add(maps.green);
  const shellMaterial = sourceMaterial.clone();
  shellMaterial.map = sourceTexture;
  ownedMaterials.add(shellMaterial);

  for (const [part, name] of [
    [body, 'body'],
    [spoiler, 'spoiler'],
  ] as const) {
    const shape = part.geometry.clone().applyMatrix4(part.matrixWorld);
    shape.translate(-center.x, -center.y, -center.z);
    // Kenney's front is +Z. Two negative axes rotate it into the game's -Z
    // forward convention without reversing triangle winding.
    shape.scale(-sx, sy, -sz);
    shape.computeBoundingSphere();
    ownedGeometries.add(shape);
    const mesh = new Mesh(shape, shellMaterial);
    mesh.name = 'car.hero.' + name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    mounted.push(mesh);
    const position = shape.getAttribute('position');
    deformMeshes.push({
      geometry: shape,
      pristine: new Float32Array(position.array),
    });
  }

  for (let i = 0; i < WHEEL_NODES.length; i++) {
    const part = namedMesh(source, WHEEL_NODES[i]!);
    const shape = part.geometry.clone();
    shape.center();
    shape.computeBoundingBox();
    const size = shape.boundingBox!.getSize(new Vector3());
    shape.scale(
      -0.3 / size.x,
      (G.wheelRadius * 2) / size.y,
      -(G.wheelRadius * 2) / size.z,
    );
    shape.computeBoundingSphere();
    ownedGeometries.add(shape);
    const wheel = new Mesh(shape, part.material);
    wheel.name = 'car.hero.wheel.' + i;
    wheel.castShadow = true;
    wheel.receiveShadow = true;
    wheelSpins[i]!.add(wheel);
    mounted.push(wheel);
  }

  // At 8 screen pixels the source mesh cannot resolve. Construct the three
  // draw far proxy here so it ships in the already lazy-loaded model chunk.
  const far = new Group();
  far.name = 'car.hero.far';
  far.visible = false;
  root.add(far);
  const farPaint = new MeshStandardMaterial({
    color: 0xff6b24,
    roughness: 0.74,
  });
  const farRubber = new MeshStandardMaterial({
    color: 0x171b20,
    roughness: 0.96,
  });
  ownedMaterials.add(farPaint);
  ownedMaterials.add(farRubber);
  const farBodyShape = new BoxGeometry(
    G.width * 0.97,
    G.height * 0.52,
    G.length * 0.98,
  );
  const farCabinShape = new BoxGeometry(
    G.width * 0.7,
    G.height * 0.42,
    G.length * 0.46,
  );
  const farWheelShape = new BoxGeometry(
    G.wheelRadius * 0.52,
    G.wheelRadius * 2,
    G.wheelRadius * 2,
  );
  ownedGeometries.add(farBodyShape);
  ownedGeometries.add(farCabinShape);
  ownedGeometries.add(farWheelShape);
  const farBody = new Mesh(farBodyShape, farPaint);
  farBody.name = 'car.hero.far.body';
  farBody.position.y = -G.height * 0.14;
  far.add(farBody);
  const farCabin = new Mesh(farCabinShape, farPaint);
  farCabin.name = 'car.hero.far.cabin';
  farCabin.position.set(0, G.height * 0.24, G.length * 0.035);
  far.add(farCabin);
  const farWheels = new InstancedMesh(farWheelShape, farRubber, 4);
  farWheels.name = 'car.hero.far.wheels';
  const farMatrix = new Matrix4();
  for (let index = 0; index < 4; index++) {
    farMatrix.makeTranslation(
      index % 2 ? G.track / 2 : -G.track / 2,
      -G.height * 0.48,
      index < 2 ? -G.wheelbase / 2 : G.wheelbase / 2,
    );
    farWheels.setMatrixAt(index, farMatrix);
  }
  farWheels.instanceMatrix.needsUpdate = true;
  far.add(farWheels);

  return {
    deformMeshes,
    setLod(lod) {
      for (const mesh of mounted) mesh.visible = lod === 'near';
      far.visible = lod === 'far';
    },
    setPaint(paint) {
      shellMaterial.map = maps[paint];
      farPaint.color.setHex(
        paint === 'blue' ? 0x4194eb : paint === 'green' ? 0x57c07e : 0xff6b24,
      );
    },
    dispose() {
      for (const mesh of mounted) mesh.removeFromParent();
      far.removeFromParent();
      for (const shape of ownedGeometries) shape.dispose();
      for (const material of ownedMaterials) material.dispose();
      for (const texture of ownedTextures) texture.dispose();
    },
  };
}
