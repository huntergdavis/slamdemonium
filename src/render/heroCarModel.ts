import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Vector3,
  type Texture,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import sedanUrl from '../../assets/cars/kenney-car-kit-3.1/sedan-sports-embedded.glb?url';
import { VEHICLE_GEOMETRY as G } from '../vehicle/constants';
import type { HeroPaint } from '../vehicle/vehicleDefinition';
import type { GarageClassId } from '../vehicle/garageClasses';
import {
  farCabinProfile,
  garageSilhouettePoint,
  heavyCabinProfile,
} from './garageSilhouette';

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
  const target =
    paint === 'blue'
      ? [65, 148, 235]
      : paint === 'green'
        ? [87, 192, 126]
        : [232, 199, 65];
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
  classId: GarageClassId = 'sports',
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
    'vesper-gold': paintTexture(sourceTexture, 'vesper-gold'),
  };
  ownedTextures.add(maps.blue);
  ownedTextures.add(maps.green);
  ownedTextures.add(maps['vesper-gold']);
  const shellMaterial = sourceMaterial.clone();
  shellMaterial.map = sourceTexture;
  ownedMaterials.add(shellMaterial);

  for (const [part, name] of [
    [body, 'body'],
    [spoiler, 'spoiler'],
  ] as const) {
    // The clean fastback tail is the Coupe's chase-view silhouette cue.
    if (name === 'spoiler' && classId === 'coupe') continue;
    const shape = part.geometry.clone().applyMatrix4(part.matrixWorld);
    shape.translate(-center.x, -center.y, -center.z);
    // Kenney's front is +Z. Two negative axes rotate it into the game's -Z
    // forward convention without reversing triangle winding.
    shape.scale(-sx, sy, -sz);
    if (name === 'spoiler' && classId === 'super') {
      const vertices = shape.getAttribute('position');
      for (let index = 0; index < vertices.count; index++)
        vertices.setXYZ(
          index,
          vertices.getX(index) * 1.25,
          vertices.getY(index) + 0.16,
          vertices.getZ(index),
        );
      vertices.needsUpdate = true;
    }
    if (classId !== 'sports') {
      const vertices = shape.getAttribute('position');
      for (let index = 0; index < vertices.count; index++) {
        const [x, y, z] = garageSilhouettePoint(
          classId,
          vertices.getX(index),
          vertices.getY(index),
          vertices.getZ(index),
        );
        vertices.setXYZ(index, x, y, z);
      }
      vertices.needsUpdate = true;
      shape.computeVertexNormals();
    }
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

  // The pickup keeps the same class-scaled chassis, but the open bed needs
  // three low edges that remain visible and bend with player-car damage.
  const bedMaterial =
    classId === 'pickup'
      ? new MeshStandardMaterial({ color: 0xff6b24, roughness: 0.72 })
      : undefined;
  if (bedMaterial) {
    ownedMaterials.add(bedMaterial);
    const rails: BoxGeometry[] = [];
    for (const [name, width, length, x, z] of [
      ['left', 0.13, 1.65, -G.width * 0.43, 1.45],
      ['right', 0.13, 1.65, G.width * 0.43, 1.45],
      ['tailgate', G.width * 0.91, 0.14, 0, G.length * 0.45],
    ] as const) {
      const shape = new BoxGeometry(width, 0.22, length);
      shape.translate(x, G.height * 0.09, z);
      shape.name = `pickup.${name}`;
      rails.push(shape);
    }
    const bed = mergeGeometries(rails, false);
    for (const rail of rails) rail.dispose();
    if (!bed) throw new Error('Pickup bed geometry unavailable');
    ownedGeometries.add(bed);
    const mesh = new Mesh(bed, bedMaterial);
    mesh.name = 'car.hero.pickup.bed';
    mesh.castShadow = true;
    root.add(mesh);
    mounted.push(mesh);
    deformMeshes.push({
      geometry: bed,
      pristine: new Float32Array(bed.getAttribute('position').array),
    });
  }

  // One painted cab mesh per heavy class. Vertex colours put the windows in
  // the same draw as the roof, and the shared crush pass folds both together.
  const heavyCabin = heavyCabinProfile(classId);
  const heavyCabMaterial = heavyCabin
    ? new MeshStandardMaterial({
        color: 0xff6b24,
        vertexColors: true,
        roughness: 0.72,
      })
    : undefined;
  if (heavyCabMaterial) {
    ownedMaterials.add(heavyCabMaterial);
    const { width, height, length, centerY, centerZ } = heavyCabin!;
    const pieces: BoxGeometry[] = [];
    const piece = (
      w: number,
      h: number,
      l: number,
      x: number,
      y: number,
      z: number,
      color: readonly [number, number, number],
    ) => {
      const shape = new BoxGeometry(w, h, l, 2, 2, 4);
      shape.translate(x, y, z);
      const count = shape.getAttribute('position').count;
      const colors = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        colors[i * 3] = color[0];
        colors[i * 3 + 1] = color[1];
        colors[i * 3 + 2] = color[2];
      }
      shape.setAttribute('color', new Float32BufferAttribute(colors, 3));
      pieces.push(shape);
    };
    piece(width, height, length, 0, centerY, centerZ, [1, 1, 1]);
    const dark = [0.13, 0.2, 0.25] as const;
    for (const side of [-1, 1])
      piece(
        0.025,
        height * 0.28,
        length * 0.82,
        side * width * 0.505,
        centerY + height * 0.15,
        centerZ,
        dark,
      );
    piece(
      width * 0.76,
      height * 0.27,
      0.025,
      0,
      centerY + height * 0.15,
      centerZ - length * 0.505,
      dark,
    );
    piece(
      width * 0.76,
      height * (classId === 'bus' ? 0.32 : 0.3),
      0.025,
      0,
      centerY + height * 0.13,
      centerZ + length * 0.505,
      dark,
    );
    if (classId === 'suv') {
      for (const side of [-1, 1])
        piece(
          0.045,
          0.055,
          length * 0.78,
          side * width * 0.36,
          centerY + height * 0.53,
          centerZ,
          dark,
        );
    } else {
      const vent = [0.55, 0.63, 0.68] as const;
      for (const station of [-0.22, 0.22])
        piece(
          width * 0.54,
          0.1,
          length * 0.2,
          0,
          centerY + height * 0.55,
          centerZ + length * station,
          vent,
        );
    }
    // Outline the rear-quarter wheel openings on the actual body rear plane.
    // The cab's rear plane is ahead of the trunk and would be occluded in the
    // chase camera. These dark U shapes merge into the cab draw and crush.
    for (const side of [-1, 1]) {
      const rearFace = G.length / 2 + 0.02;
      const archCenter = G.track / 2 - 0.12;
      piece(0.43, 0.09, 0.025, side * archCenter, -0.03, rearFace, dark);
      for (const offset of [-0.16, 0.17])
        piece(
          0.1,
          0.31,
          0.025,
          side * (archCenter + offset),
          -0.2,
          rearFace,
          dark,
        );
    }
    const cab = mergeGeometries(pieces, false);
    for (const shape of pieces) shape.dispose();
    if (!cab) throw new Error('Heavy cab geometry unavailable');
    ownedGeometries.add(cab);
    const mesh = new Mesh(cab, heavyCabMaterial);
    mesh.name = `car.hero.${classId}.cab`;
    mesh.castShadow = true;
    root.add(mesh);
    mounted.push(mesh);
    deformMeshes.push({
      geometry: cab,
      pristine: new Float32Array(cab.getAttribute('position').array),
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

  // A single bright radial marker makes wheel rotation readable from either
  // quarter view. Share its geometry across the four existing spin groups.
  const spokeParts: BoxGeometry[] = [];
  for (const face of [-1, 1]) {
    const spoke = new BoxGeometry(
      0.018,
      G.wheelRadius * 0.72,
      G.wheelRadius * 0.17,
    );
    spoke.translate(face * 0.159, G.wheelRadius * 0.43, 0);
    spokeParts.push(spoke);
    const accent = new BoxGeometry(
      0.018,
      G.wheelRadius * 0.36,
      G.wheelRadius * 0.12,
    );
    accent.translate(face * 0.159, G.wheelRadius * 0.32, 0);
    accent.rotateX(2.25);
    spokeParts.push(accent);
  }
  const spokesShape = mergeGeometries(spokeParts, false);
  for (const shape of spokeParts) shape.dispose();
  if (!spokesShape) throw new Error('Hero wheel spokes unavailable');
  ownedGeometries.add(spokesShape);
  const spokesMaterial = new MeshStandardMaterial({
    color: 0xf0f5f8,
    emissive: 0x303840,
    metalness: 0.55,
    roughness: 0.4,
  });
  ownedMaterials.add(spokesMaterial);
  for (let i = 0; i < WHEEL_NODES.length; i++) {
    const spokes = new Mesh(spokesShape, spokesMaterial);
    spokes.name = 'car.hero.wheel.spokes.' + i;
    wheelSpins[i]!.add(spokes);
    mounted.push(spokes);
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
  const cabin = farCabinProfile(classId);
  const farCabinShape = new BoxGeometry(
    G.width * 0.7,
    cabin.height,
    cabin.length,
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
  farCabin.position.set(0, G.height * 0.24, cabin.z);
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
      bedMaterial?.color.setHex(
        paint === 'blue' ? 0x4194eb : paint === 'green' ? 0x57c07e : 0xff6b24,
      );
      heavyCabMaterial?.color.setHex(
        paint === 'blue' ? 0x4194eb : paint === 'green' ? 0x57c07e : 0xff6b24,
      );
      farPaint.color.setHex(
        paint === 'blue'
          ? 0x4194eb
          : paint === 'green'
            ? 0x57c07e
            : paint === 'vesper-gold'
              ? 0xe8c741
              : 0xff6b24,
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
