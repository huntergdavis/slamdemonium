/** The car catalogue (2026-10-02): every traffic car is one of six kinds,
 * now 20 percent larger than its original catalogue dimensions,
 * so the street has sedans, hatches, vans, pickups, box trucks and buses.
 * One place owns a kind's collision box, its visual parts and the palette,
 * so the near-miss gap, the slam and the picture all agree on how big a
 * car is. Traffic consumes it through one field, `modelKind`. */
import {
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedMesh,
  MeshDepthMaterial,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  type Scene,
} from 'three';

export type CarModelKind =
  'sedan' | 'hatch' | 'van' | 'pickup' | 'boxTruck' | 'bus';

export const CAR_MODEL_KINDS: readonly CarModelKind[] = Object.freeze([
  'sedan',
  'hatch',
  'van',
  'pickup',
  'boxTruck',
  'bus',
]);

/** Uniformly grows the catalogue's visuals, collision boxes and dent depths. */
export const TRAFFIC_MODEL_SCALE = 1.2;

/** Keep the secondary scuff cue off while the vertex dent is judged alone. */
const SCUFF_TINT_STRENGTH = 0;

/** Deform before the instance matrix in both the colour and depth passes.
 * Model metrics are vertex attributes because the three materials are shared
 * by all six kinds; damage strengths are per encounter, not per geometry. */
function installCrushShader(
  material: MeshStandardMaterial | MeshDepthMaterial,
): void {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
attribute vec4 instanceCrush;
attribute float instanceDentSeed;
attribute vec3 crushMetrics;`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
if (dot(instanceCrush, vec4(1.0)) > 0.0) {
  float halfWidth = crushMetrics.x;
  float halfLength = crushMetrics.y;
  float rideHeight = crushMetrics.z;
  float rearBand = 1.0 - smoothstep(-halfLength * 0.82, -halfLength * 0.08, position.z);
  float frontBand = smoothstep(halfLength * 0.08, halfLength * 0.82, position.z);
  float leftBand = 1.0 - smoothstep(-halfWidth * 0.82, -halfWidth * 0.08, position.x);
  float rightBand = smoothstep(halfWidth * 0.08, halfWidth * 0.82, position.x);
  float trafficRear = instanceCrush.y * rearBand;
  float trafficFront = instanceCrush.x * frontBand;
  float trafficLeft = instanceCrush.z * leftBand;
  float trafficRight = instanceCrush.w * rightBand;
  float dentPhase = instanceDentSeed * 6.2831853;
  float across = clamp(abs(position.x / halfWidth - 0.24 * sin(dentPhase * 2.3)), 0.0, 1.0);
  float along = clamp(abs(position.z / halfLength - 0.24 * cos(dentPhase * 3.7)), 0.0, 1.0);
  float height = clamp((position.y + rideHeight) / (rideHeight * 2.0), 0.0, 1.0);
  float bowl = 0.28 + 0.72 * (1.0 - across * across);
  float sideBowl = 0.28 + 0.72 * (1.0 - along * along);
  float wrinkle = 0.82 + 0.18 * sin(position.x * (4.7 + instanceDentSeed * 2.1)
    + position.y * 4.1 + dentPhase * 3.1);
  float sideWrinkle = 0.82 + 0.18 * sin(position.z * (4.7 + instanceDentSeed * 2.1)
    + position.y * 4.1 + dentPhase * 4.9);
  transformed.z += ${2.4 * TRAFFIC_MODEL_SCALE} * (trafficRear - trafficFront) * bowl * wrinkle;
  transformed.x += ${1.15 * TRAFFIC_MODEL_SCALE} * (trafficLeft - trafficRight) * sideBowl * sideWrinkle;
  float roof = smoothstep(0.55, 0.9, height);
  float roofNotch = 1.0 - smoothstep(0.1, 0.95, across);
  float sideNotch = 1.0 - smoothstep(0.1, 0.95, along);
  transformed.y -= roof * ${TRAFFIC_MODEL_SCALE} * ((trafficRear + trafficFront) * (0.35 + 0.9 * roofNotch)
    + (trafficLeft + trafficRight) * (0.35 + 0.9 * sideNotch));
  transformed.y += ${0.18 * TRAFFIC_MODEL_SCALE} * roof * ((trafficRear + trafficFront) * sin(position.x * 3.2 + position.z * 1.7 + dentPhase)
    + (trafficLeft + trafficRight) * sin(position.z * 3.2 + position.x * 1.7 + dentPhase * 1.7));
}`,
    );
  };
  material.customProgramCacheKey = () => 'traffic-vertex-crush-v3';
}

/** A box part of a model, in car space: +z is the nose, y up from the
 * ground plane, x to the right. Sizes are full extents. */
export interface CarModelPart {
  readonly size: readonly [number, number, number];
  /** Centre of the part; y is the centre height above the ground. */
  readonly offset: readonly [number, number, number];
  /** Which material: the painted body, the dark cabin glass, or an accent. */
  readonly tone: 'body' | 'cabin' | 'accent';
  /** Which end of this part buckles most when struck. */
  readonly zone: 'front' | 'rear' | 'centre';
}

/** Persistent visual damage, in car space. Each value is a fraction of that
 * kind's maximum crush depth. The collision box deliberately stays intact. */
export interface CarCrushState {
  front: number;
  rear: number;
  left: number;
  right: number;
}

export interface CarModelSpec {
  readonly kind: CarModelKind;
  readonly label: string;
  /** Collision box half extents (x right, y up, z along), metres. The box
   * is centred on the body origin, `ride` metres above the ground. */
  readonly halfExtents: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
  };
  /** Height of the body origin above the ground when at rest. */
  readonly ride: number;
  readonly parts: readonly CarModelPart[];
  /** Share of the street this kind gets from `pickCarModelKind`. */
  readonly share: number;
}

/** The first traffic box, retained as a historical size reference. */
export const ORIGINAL_TRAFFIC_BOX = Object.freeze({
  length: 4.2,
  width: 1.9,
  height: 0.9,
});

const spec = (
  kind: CarModelKind,
  label: string,
  length: number,
  width: number,
  height: number,
  share: number,
  parts: readonly CarModelPart[],
): CarModelSpec =>
  Object.freeze({
    kind,
    label,
    halfExtents: Object.freeze({
      x: (width * TRAFFIC_MODEL_SCALE) / 2,
      y: (height * TRAFFIC_MODEL_SCALE) / 2,
      z: (length * TRAFFIC_MODEL_SCALE) / 2,
    }),
    ride: (height / 2 + 0.04) * TRAFFIC_MODEL_SCALE,
    parts: Object.freeze(
      parts.map((p) =>
        Object.freeze({
          ...p,
          size: p.size.map((value) => value * TRAFFIC_MODEL_SCALE) as [
            number,
            number,
            number,
          ],
          offset: p.offset.map((value) => value * TRAFFIC_MODEL_SCALE) as [
            number,
            number,
            number,
          ],
        }),
      ),
    ),
    share,
  });

/** The authored dimensions below are the catalogue before this 20% scale.
 * Part offsets are in car space with y measured from the ground. */
export const CAR_MODELS: Readonly<Record<CarModelKind, CarModelSpec>> =
  Object.freeze({
    // Three-box: a low body, a short cabin in the middle, a long tail.
    sedan: spec('sedan', 'Sedan', 5.7, 2.55, 1.9, 0.38, [
      {
        size: [2.55, 1.1, 5.7],
        offset: [0, 0.59, 0],
        tone: 'body',
        zone: 'centre',
      },
      {
        size: [2.1, 0.8, 2.6],
        offset: [0, 1.5, 0.1],
        tone: 'cabin',
        zone: 'centre',
      },
    ]),
    // Two-box: a tall cabin that runs to the tail, a short nose, a higher
    // roof: reads as a different car from the sedan at chase distance.
    hatch: spec('hatch', 'Hatchback', 5.5, 2.5, 2.4, 0.24, [
      {
        size: [2.5, 1.2, 5.5],
        offset: [0, 0.64, 0],
        tone: 'body',
        zone: 'centre',
      },
      {
        size: [2.3, 1.2, 3.6],
        offset: [0, 1.8, -0.9],
        tone: 'cabin',
        zone: 'rear',
      },
    ]),
    van: spec('van', 'Van', 6.0, 2.6, 2.3, 0.14, [
      {
        size: [2.6, 2.3, 6.0],
        offset: [0, 1.19, 0],
        tone: 'body',
        zone: 'centre',
      },
      {
        size: [2.45, 0.8, 1.5],
        offset: [0, 1.85, 2.0],
        tone: 'cabin',
        zone: 'front',
      },
    ]),
    pickup: spec('pickup', 'Pickup', 6.3, 2.6, 2.1, 0.14, [
      {
        size: [2.6, 1.1, 6.3],
        offset: [0, 0.59, 0],
        tone: 'body',
        zone: 'centre',
      },
      {
        size: [2.4, 0.9, 2.2],
        offset: [0, 1.6, 1.3],
        tone: 'cabin',
        zone: 'front',
      },
      {
        size: [2.4, 0.5, 3.0],
        offset: [0, 1.3, -1.5],
        tone: 'accent',
        zone: 'rear',
      },
    ]),
    boxTruck: spec('boxTruck', 'Box truck', 8.5, 2.9, 3.4, 0.06, [
      {
        size: [2.9, 1.0, 8.5],
        offset: [0, 0.54, 0],
        tone: 'body',
        zone: 'centre',
      },
      {
        size: [2.7, 1.6, 2.2],
        offset: [0, 1.85, 3.1],
        tone: 'cabin',
        zone: 'front',
      },
      {
        size: [2.9, 2.4, 5.6],
        offset: [0, 2.2, -1.3],
        tone: 'accent',
        zone: 'rear',
      },
    ]),
    bus: spec('bus', 'Bus', 12.0, 2.9, 3.2, 0.04, [
      {
        size: [2.9, 3.2, 12.0],
        offset: [0, 1.64, 0],
        tone: 'body',
        zone: 'centre',
      },
      {
        size: [2.95, 1.1, 11.0],
        offset: [0, 2.3, 0],
        tone: 'cabin',
        zone: 'centre',
      },
    ]),
  });

/** Eight paints, picked by encounter id so a car keeps its colour. */
export const CAR_PALETTE: readonly number[] = Object.freeze([
  0xff4c3a, 0xe8c741, 0x63c9f1, 0xd9e0e7, 0x3fa65b, 0xf28c28, 0x8e6bd1,
  0x2b3a4a,
]);

export function paletteColorIndex(id: number): number {
  return Math.abs(Math.trunc(id)) % CAR_PALETTE.length;
}

/** A one-to-one 32-bit encounter-id shuffle. The pattern stays the same
 * through physics/visual LOD handoffs but neighbouring cars dent differently. */
export function dentSeedForId(id: number): number {
  return (Math.imul(Math.trunc(id), 0x9e3779b1) >>> 0) / 0x100000000;
}

/** A deterministic mix by encounter id: mostly sedans and hatches, fewer
 * vans and pickups, the odd truck and bus. A record may author its kind
 * instead; this is the default. */
export function pickCarModelKind(id: number): CarModelKind {
  // A small integer hash so neighbouring ids do not alternate in lockstep.
  let h = Math.abs(Math.trunc(id)) * 2654435761;
  h = (h ^ (h >>> 15)) >>> 0;
  const u = (h % 1000) / 1000;
  let acc = 0;
  for (const kind of CAR_MODEL_KINDS) {
    acc += CAR_MODELS[kind].share;
    if (u < acc) return kind;
  }
  return 'sedan';
}

/** Half the width of a kind: what the near-miss gap needs. */
export function carHalfWidth(kind: CarModelKind | undefined): number {
  return CAR_MODELS[kind ?? 'sedan'].halfExtents.x;
}

export interface CarModelInstances {
  /** Start a frame: every kind's count goes back to zero. */
  begin(): void;
  /** Place one car of a kind this frame. Returns false when the kind's
   * capacity is full (the car is simply not drawn). */
  push(
    kind: CarModelKind,
    position: { readonly x: number; readonly y: number; readonly z: number },
    rotation: {
      readonly x: number;
      readonly y: number;
      readonly z: number;
      readonly w: number;
    },
    encounterId: number,
    crush?: Readonly<CarCrushState>,
  ): boolean;
  /** Finish the frame: upload counts and matrices. */
  end(): void;
  /** Cars drawn in the last finished frame, by kind. */
  readonly counts: Readonly<Record<CarModelKind, number>>;
  /** Draw calls this manager issues (one per part per kind). */
  readonly drawCalls: number;
  dispose(): void;
}

/** One InstancedMesh per part per kind, all parts of a kind sharing the
 * kind's instance matrix (part offsets are baked into the geometry), so a
 * frame is one matrix write per car and a fixed number of draw calls. */
export function createCarModelInstances(
  scene: Scene,
  capacityPerKind: number,
): CarModelInstances {
  const materials = {
    body: new MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.55,
      flatShading: true,
    }),
    cabin: new MeshStandardMaterial({
      color: 0x344656,
      roughness: 0.42,
      flatShading: true,
    }),
    accent: new MeshStandardMaterial({
      color: 0x9aa3ad,
      roughness: 0.6,
      flatShading: true,
    }),
  };
  for (const material of Object.values(materials)) installCrushShader(material);
  const depthMaterial = new MeshDepthMaterial();
  installCrushShader(depthMaterial);
  const palette = CAR_PALETTE.map((hex) => new Color(hex));
  const instanceTint = new Color();
  const helper = new Object3D();
  // Traffic's chassis and velocity point along local -Z; catalogue parts
  // were authored with their nose at +Z. Turn only the visual model.
  const visualFacing = new Quaternion(0, 1, 0, 0);
  const counts: Record<CarModelKind, number> = {
    sedan: 0,
    hatch: 0,
    van: 0,
    pickup: 0,
    boxTruck: 0,
    bus: 0,
  };
  const meshes: Record<CarModelKind, InstancedMesh[]> = {
    sedan: [],
    hatch: [],
    van: [],
    pickup: [],
    boxTruck: [],
    bus: [],
  };
  const geometries: BoxGeometry[] = [];
  let drawCalls = 0;
  for (const kind of CAR_MODEL_KINDS) {
    const model = CAR_MODELS[kind];
    for (const part of model.parts) {
      const segments = 6;
      const geometry = new BoxGeometry(
        part.size[0],
        part.size[1],
        part.size[2],
        segments,
        segments,
        segments,
      );
      // Car space has the origin `ride` metres up; parts are authored from
      // the ground, so lower them by the ride height.
      geometry.translate(
        part.offset[0],
        part.offset[1] - model.ride,
        part.offset[2],
      );
      const metrics = new Float32Array(
        geometry.getAttribute('position').count * 3,
      );
      for (let i = 0; i < metrics.length; i += 3) {
        metrics[i] = model.halfExtents.x;
        metrics[i + 1] = model.halfExtents.z;
        metrics[i + 2] = model.ride;
      }
      geometry.setAttribute(
        'crushMetrics',
        new Float32BufferAttribute(metrics, 3),
      );
      const crushAttribute = new InstancedBufferAttribute(
        new Float32Array(capacityPerKind * 4),
        4,
      );
      crushAttribute.setUsage(DynamicDrawUsage);
      geometry.setAttribute('instanceCrush', crushAttribute);
      const seedAttribute = new InstancedBufferAttribute(
        new Float32Array(capacityPerKind),
        1,
      );
      seedAttribute.setUsage(DynamicDrawUsage);
      geometry.setAttribute('instanceDentSeed', seedAttribute);
      geometries.push(geometry);
      const mesh = new InstancedMesh(
        geometry,
        materials[part.tone],
        capacityPerKind,
      );
      mesh.name = `traffic.${kind}.${part.tone}`;
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.customDepthMaterial = depthMaterial;
      // Instances move across a 10 km map; a bounds sphere from their boot
      // positions would cull the whole draw at a distant station.
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.count = 0;
      scene.add(mesh);
      meshes[kind].push(mesh);
      drawCalls++;
    }
  }
  return {
    counts,
    drawCalls,
    begin() {
      for (const kind of CAR_MODEL_KINDS) counts[kind] = 0;
    },
    push(kind, position, rotation, encounterId, crush) {
      const index = counts[kind];
      if (index >= capacityPerKind) return false;
      helper.position.set(position.x, position.y, position.z);
      helper.quaternion
        .set(rotation.x, rotation.y, rotation.z, rotation.w)
        .multiply(visualFacing);
      helper.updateMatrix();
      const color = palette[paletteColorIndex(encounterId)]!;
      const dentSeed = dentSeedForId(encounterId);
      const front = Math.max(0, Math.min(1, crush?.front ?? 0));
      const rear = Math.max(0, Math.min(1, crush?.rear ?? 0));
      const left = Math.max(0, Math.min(1, crush?.left ?? 0));
      const right = Math.max(0, Math.min(1, crush?.right ?? 0));
      for (let partIndex = 0; partIndex < meshes[kind].length; partIndex++) {
        const mesh = meshes[kind][partIndex]!;
        mesh.setMatrixAt(index, helper.matrix);
        const crushAttribute = mesh.geometry.getAttribute(
          'instanceCrush',
        ) as InstancedBufferAttribute;
        crushAttribute.setXYZW(index, front, rear, left, right);
        const seedAttribute = mesh.geometry.getAttribute(
          'instanceDentSeed',
        ) as InstancedBufferAttribute;
        seedAttribute.setX(index, dentSeed);
        const scuff =
          SCUFF_TINT_STRENGTH > 0
            ? 1 - SCUFF_TINT_STRENGTH * Math.sqrt(rear)
            : 1;
        if (mesh.material === materials.body) {
          instanceTint.copy(color).multiplyScalar(scuff);
          mesh.setColorAt(index, instanceTint);
        } else if (SCUFF_TINT_STRENGTH > 0) {
          instanceTint.setRGB(scuff, scuff, scuff);
          mesh.setColorAt(index, instanceTint);
        }
      }
      counts[kind] = index + 1;
      return true;
    },
    end() {
      for (const kind of CAR_MODEL_KINDS)
        for (const mesh of meshes[kind]) {
          mesh.count = counts[kind];
          mesh.instanceMatrix.needsUpdate = true;
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
          if (mesh.count > 0) {
            const crushAttribute = mesh.geometry.getAttribute(
              'instanceCrush',
            ) as InstancedBufferAttribute;
            crushAttribute.clearUpdateRanges();
            crushAttribute.addUpdateRange(0, mesh.count * 4);
            crushAttribute.needsUpdate = true;
            const seedAttribute = mesh.geometry.getAttribute(
              'instanceDentSeed',
            ) as InstancedBufferAttribute;
            seedAttribute.clearUpdateRanges();
            seedAttribute.addUpdateRange(0, mesh.count);
            seedAttribute.needsUpdate = true;
          }
        }
    },
    dispose() {
      for (const kind of CAR_MODEL_KINDS)
        for (const mesh of meshes[kind]) scene.remove(mesh);
      for (const geometry of geometries) geometry.dispose();
      for (const material of Object.values(materials)) material.dispose();
      depthMaterial.dispose();
    },
  };
}
