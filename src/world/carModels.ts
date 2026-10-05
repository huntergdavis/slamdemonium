/** The car catalogue (2026-10-02): every traffic car is one of six kinds,
 * each 30 to 40 percent larger than the first traffic box (4.2 x 1.9 x 0.9 m),
 * so the street has sedans, hatches, vans, pickups, box trucks and buses.
 * One place owns a kind's collision box, its visual parts and the palette,
 * so the near-miss gap, the slam and the picture all agree on how big a
 * car is. Traffic consumes it through one field, `modelKind`. */
import {
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
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

/** Set to zero to remove the secondary scuff cue without changing dent shape. */
const SCUFF_TINT_STRENGTH = 0.45;

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

/** The first traffic box: 4.2 long, 1.9 wide, 0.9 tall body. Every kind
 * below is at least 1.3 times that in both length and width (the CTO's
 * '30-40% bigger' applies to every car, the small ones included). */
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
    halfExtents: Object.freeze({ x: width / 2, y: height / 2, z: length / 2 }),
    ride: height / 2 + 0.04,
    parts: Object.freeze(parts.map((p) => Object.freeze(p))),
    share,
  });

/** Lengths and widths are 1.35 times the original box; the height of a
 * kind is its roof, so the collision box covers everything drawn (a van is
 * tall, a hatch is short and boxy, a bus is long and tall). Part offsets
 * are in car space with y measured from the ground. */
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
    colorIndex: number,
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
    body: new MeshStandardMaterial({ color: 0xffffff, roughness: 0.55 }),
    cabin: new MeshStandardMaterial({ color: 0x344656, roughness: 0.42 }),
    accent: new MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.6 }),
  };
  const palette = CAR_PALETTE.map((hex) => new Color(hex));
  const instanceTint = new Color();
  const helper = new Object3D();
  // Traffic's chassis and velocity point along local -Z; catalogue parts
  // were authored with their nose at +Z. Turn only the visual model.
  const visualFacing = new Quaternion(0, 1, 0, 0);
  const localDamage = new Matrix4();
  const damagedMatrix = new Matrix4();
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
      const geometry = new BoxGeometry(
        part.size[0],
        part.size[1],
        part.size[2],
      );
      // Car space has the origin `ride` metres up; parts are authored from
      // the ground, so lower them by the ride height.
      geometry.translate(
        part.offset[0],
        part.offset[1] - model.ride,
        part.offset[2],
      );
      geometries.push(geometry);
      const mesh = new InstancedMesh(
        geometry,
        materials[part.tone],
        capacityPerKind,
      );
      mesh.name = `traffic.${kind}.${part.tone}`;
      mesh.castShadow = mesh.receiveShadow = true;
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
    push(kind, position, rotation, colorIndex, crush) {
      const index = counts[kind];
      if (index >= capacityPerKind) return false;
      helper.position.set(position.x, position.y, position.z);
      helper.quaternion
        .set(rotation.x, rotation.y, rotation.z, rotation.w)
        .multiply(visualFacing);
      helper.updateMatrix();
      const color = palette[paletteColorIndex(colorIndex)]!;
      const model = CAR_MODELS[kind];
      const front = Math.max(0, Math.min(1, crush?.front ?? 0));
      const rear = Math.max(0, Math.min(1, crush?.rear ?? 0));
      const left = Math.max(0, Math.min(1, crush?.left ?? 0));
      const right = Math.max(0, Math.min(1, crush?.right ?? 0));
      // Keep the opposite edge fixed: front damage pulls +z inward, rear
      // damage pulls -z inward, and the same rule applies across the width.
      const noseDepth = front * Math.min(2, model.halfExtents.z * 0.4);
      const tailDepth = rear * Math.min(2, model.halfExtents.z * 0.4);
      const leftDepth = left * model.halfExtents.x * 0.4;
      const rightDepth = right * model.halfExtents.x * 0.4;
      const damaged = noseDepth + tailDepth + leftDepth + rightDepth > 0;
      const scaleX = 1 - (leftDepth + rightDepth) / (model.halfExtents.x * 2);
      const scaleZ = 1 - (noseDepth + tailDepth) / (model.halfExtents.z * 2);
      const shiftX = (leftDepth - rightDepth) / 2;
      const shiftZ = (tailDepth - noseDepth) / 2;
      const worstDamage = Math.max(front, rear, left, right);
      // A shortened end alone disappears behind the player's car. Bend the
      // roof out of the undamaged outline, even for a light knock. A direct
      // front/rear hit picks a stable lean side from the encounter colour;
      // side hits lean away from the struck side.
      const leanSide =
        left > right
          ? 1
          : right > left
            ? -1
            : paletteColorIndex(colorIndex) % 2 === 0
              ? 1
              : -1;
      for (let partIndex = 0; partIndex < meshes[kind].length; partIndex++) {
        const mesh = meshes[kind][partIndex]!;
        const part = model.parts[partIndex]!;
        let silhouetteDamage = 0;
        if (damaged) {
          const endDamage =
            part.zone === 'front'
              ? front
              : part.zone === 'rear'
                ? rear
                : (front + rear) * 0.35;
          const roofDrop =
            part.tone === 'body'
              ? 0
              : Math.min(0.3, 0.16 * (endDamage + (left + right) * 0.4));
          // Lengthwise crush disappears when seen straight from behind. Drop
          // the struck face too, pivoting each part around its lower edge so
          // its body stays on the road instead of floating as it buckles.
          silhouetteDamage =
            part.zone === 'front'
              ? Math.max(front, left * 0.8, right * 0.8)
              : part.zone === 'rear'
                ? Math.max(rear, left * 0.8, right * 0.8)
                : Math.max(front, rear, left, right) * 0.75;
          // A small dent vanishes from the moving chase camera if the struck
          // face stays tall. Spend more height early, while keeping distinct
          // silhouettes for a solid hit and a full-speed wreck.
          const compression =
            0.9 * Math.min(silhouetteDamage, 0.45) +
            0.7 * Math.max(0, silhouetteDamage - 0.45);
          const scaleY = 1 - compression;
          const partBottom = part.offset[1] - model.ride - part.size[1] / 2;
          // Shear about the part's lower edge: the base stays near its
          // collider while the roof leans into a clear chase-view silhouette.
          // The struck edge also folds up into a slanted hood or roof. These
          // are per-instance matrices, so all kinds keep their shared boxes
          // and the same number of draws.
          const bendX =
            leanSide * 0.6 * worstDamage * (part.tone === 'body' ? 0.55 : 1);
          const bendZ = (rear - front) * 0.18 * silhouetteDamage;
          const fold = (part.tone === 'body' ? 0.1 : 0.25) * silhouetteDamage;
          const foldX = (right > left ? 1 : left > right ? -1 : 0) * fold;
          const foldZ = (front > rear ? 1 : rear > front ? -1 : 0) * fold;
          const foldClearance =
            Math.abs(foldX) * part.size[0] * 0.5 +
            Math.abs(foldZ) * part.size[2] * 0.5;
          const shiftY = (1 - scaleY) * partBottom - roofDrop + foldClearance;
          localDamage.set(
            scaleX,
            bendX,
            0,
            shiftX - bendX * partBottom,
            foldX,
            scaleY,
            foldZ,
            shiftY - foldX * part.offset[0] - foldZ * part.offset[2],
            0,
            bendZ,
            scaleZ,
            shiftZ - bendZ * partBottom,
            0,
            0,
            0,
            1,
          );
          damagedMatrix.multiplyMatrices(helper.matrix, localDamage);
          mesh.setMatrixAt(index, damagedMatrix);
        } else mesh.setMatrixAt(index, helper.matrix);
        const scuff = 1 - SCUFF_TINT_STRENGTH * Math.sqrt(silhouetteDamage);
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
        }
    },
    dispose() {
      for (const kind of CAR_MODEL_KINDS)
        for (const mesh of meshes[kind]) scene.remove(mesh);
      for (const geometry of geometries) geometry.dispose();
      for (const material of Object.values(materials)) material.dispose();
    },
  };
}
