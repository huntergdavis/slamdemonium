import {
  Box3,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshDepthMaterial,
  MeshStandardMaterial,
  Quaternion,
  Scene,
  Vector3,
} from 'three';
import { describe, expect, it } from 'vitest';
import {
  CAR_MODELS,
  CAR_MODEL_KINDS,
  CAR_PALETTE,
  ORIGINAL_TRAFFIC_BOX,
  TRAFFIC_MODEL_SCALE,
  carHalfWidth,
  createCarModelInstances,
  dentSeedForId,
  paletteColorIndex,
  pickCarModelKind,
} from '../src/world/carModels';
import { trafficCrushShape } from '../src/world/trafficCrushShape';

describe('car model catalogue', () => {
  it('scales all six catalogue kinds and their parts by 20 percent', () => {
    expect(CAR_MODEL_KINDS).toHaveLength(6);
    expect(TRAFFIC_MODEL_SCALE).toBe(1.2);
    const original = {
      sedan: [5.7, 2.55, 1.9],
      hatch: [5.5, 2.5, 2.4],
      van: [6.0, 2.6, 2.3],
      pickup: [6.3, 2.6, 2.1],
      boxTruck: [8.5, 2.9, 3.4],
      bus: [12.0, 2.9, 3.2],
    } as const;
    const lengths = new Set<number>();
    for (const kind of CAR_MODEL_KINDS) {
      const m = CAR_MODELS[kind];
      const length = m.halfExtents.z * 2;
      const width = m.halfExtents.x * 2;
      expect(length).toBeCloseTo(original[kind][0] * 1.2);
      expect(width).toBeCloseTo(original[kind][1] * 1.2);
      expect(m.halfExtents.y * 2).toBeCloseTo(original[kind][2] * 1.2);
      expect(m.ride).toBeCloseTo((original[kind][2] / 2 + 0.04) * 1.2);
      lengths.add(Math.round(length * 10));
      expect(m.parts.length).toBeGreaterThanOrEqual(2);
      expect(m.share).toBeGreaterThan(0);
    }
    expect(lengths.size).toBe(6);
    expect(CAR_MODELS.sedan.halfExtents.z * 2).toBeCloseTo(
      ORIGINAL_TRAFFIC_BOX.length * 1.357 * TRAFFIC_MODEL_SCALE,
      1,
    );
    expect(CAR_MODELS.bus.halfExtents.z * 2).toBeGreaterThan(
      2 * CAR_MODELS.sedan.halfExtents.z * 2,
    );
    // Sedan and hatch differ in proportion, not only length: the hatch is
    // taller and its cabin runs to the tail, the sedan's sits mid-body.
    expect(CAR_MODELS.hatch.halfExtents.y).toBeGreaterThan(
      CAR_MODELS.sedan.halfExtents.y * 1.15,
    );
    const cabinOf = (kind: 'sedan' | 'hatch') =>
      CAR_MODELS[kind].parts.find((p) => p.tone === 'cabin')!;
    expect(
      cabinOf('hatch').size[2] / CAR_MODELS.hatch.halfExtents.z,
    ).toBeGreaterThan(
      cabinOf('sedan').size[2] / CAR_MODELS.sedan.halfExtents.z + 0.3,
    );
    expect(cabinOf('hatch').offset[2]).toBeLessThan(
      cabinOf('sedan').offset[2] - 0.5,
    );
    expect(CAR_MODELS.van.halfExtents.y).toBeGreaterThan(
      CAR_MODELS.sedan.halfExtents.y,
    );
    expect(CAR_MODELS.boxTruck.halfExtents.y).toBeGreaterThan(
      CAR_MODELS.van.halfExtents.y,
    );
  });
  it("keeps every visual part inside its kind's collision box, within a hand of the glass", () => {
    for (const kind of CAR_MODEL_KINDS) {
      const m = CAR_MODELS[kind];
      for (const part of m.parts) {
        const [sx, sy, sz] = part.size;
        const [ox, oy, oz] = part.offset;
        expect(Math.abs(ox) + sx / 2).toBeLessThanOrEqual(
          m.halfExtents.x + 0.05,
        );
        expect(Math.abs(oz) + sz / 2).toBeLessThanOrEqual(
          m.halfExtents.z + 0.05,
        );
        expect(oy - sy / 2).toBeGreaterThanOrEqual(-0.01); // Nothing below the road.
        expect(oy + sy / 2).toBeLessThanOrEqual(m.halfExtents.y * 2 + 0.05); // The roof is the box.
      }
    }
  });
  it('picks a deterministic mix by id that matches the authored shares', () => {
    const counts: Record<string, number> = {};
    const N = 20000;
    for (let id = 1; id <= N; id++) {
      const kind = pickCarModelKind(id);
      counts[kind] = (counts[kind] ?? 0) + 1;
      expect(pickCarModelKind(id)).toBe(kind); // Stable.
    }
    const total = CAR_MODEL_KINDS.reduce((a, k) => a + CAR_MODELS[k].share, 0);
    expect(total).toBeCloseTo(1, 6);
    for (const kind of CAR_MODEL_KINDS)
      expect((counts[kind] ?? 0) / N).toBeCloseTo(CAR_MODELS[kind].share, 1);
    expect(paletteColorIndex(13)).toBe(13 % CAR_PALETTE.length);
    expect(carHalfWidth('bus')).toBe(CAR_MODELS.bus.halfExtents.x);
    expect(carHalfWidth(undefined)).toBe(CAR_MODELS.sedan.halfExtents.x);
  });
  it('keeps the crushed front hull proportional to the larger sedan and bus', () => {
    for (const kind of ['sedan', 'bus'] as const) {
      const half = CAR_MODELS[kind].halfExtents;
      const shape = trafficCrushShape(kind, {
        front: 1,
        rear: 0,
        left: 0,
        right: 0,
      })!;
      expect(shape.halfExtents).toBe(half);
      const front = Math.min(...shape.vertices.map((v) => v.z));
      expect(front).toBeCloseTo(-half.z + Math.min(2.4, half.z * 0.4));
      expect(Math.max(...shape.vertices.map((v) => v.z))).toBeCloseTo(half.z);
    }
  });
  it('draws each kind through its own instanced parts, one matrix per car per frame, counts reset each frame', () => {
    const scene = new Scene();
    const cars = createCarModelInstances(scene, 4);
    expect(cars.drawCalls).toBe(
      CAR_MODEL_KINDS.reduce((a, k) => a + CAR_MODELS[k].parts.length, 0),
    );
    const q = { x: 0, y: 0, z: 0, w: 1 };
    cars.begin();
    expect(cars.push('sedan', { x: 0, y: 0.6, z: 0 }, q, 1)).toBe(true);
    expect(cars.push('sedan', { x: 5, y: 0.6, z: 0 }, q, 2)).toBe(true);
    expect(cars.push('bus', { x: 10, y: 1.6, z: 0 }, q, 3)).toBe(true);
    for (let i = 0; i < 5; i++) cars.push('van', { x: i, y: 1, z: 0 }, q, i);
    cars.end();
    expect(cars.counts.sedan).toBe(2);
    expect(cars.counts.bus).toBe(1);
    expect(cars.counts.van).toBe(4); // Capacity, the fifth was refused.
    const sedanBody = scene.getObjectByName('traffic.sedan.body') as {
      count: number;
    };
    const busCabin = scene.getObjectByName('traffic.bus.cabin') as {
      count: number;
    };
    expect(sedanBody.count).toBe(2);
    expect(busCabin.count).toBe(1);
    cars.begin();
    cars.end();
    expect(cars.counts.sedan).toBe(0);
    expect(sedanBody.count).toBe(0);
    cars.dispose();
    expect(scene.getObjectByName('traffic.sedan.body')).toBeUndefined();
  });
  it('draws the cab ahead of a moving traffic car at either heading', () => {
    const scene = new Scene();
    const cars = createCarModelInstances(scene, 1);
    const cabin = scene.getObjectByName(
      'traffic.boxTruck.cabin',
    ) as InstancedMesh;
    const instance = new Matrix4();
    cabin.geometry.computeBoundingBox();
    for (const yaw of [0, Math.PI / 2]) {
      const rotation = new Quaternion().setFromAxisAngle(
        new Vector3(0, 1, 0),
        yaw,
      );
      const velocity = new Vector3(0, 0, -1).applyQuaternion(rotation);
      cars.begin();
      cars.push(
        'boxTruck',
        { x: 0, y: CAR_MODELS.boxTruck.ride, z: 0 },
        rotation,
        0,
      );
      cars.end();
      cabin.getMatrixAt(0, instance);
      const cabCenter = new Box3()
        .copy(cabin.geometry.boundingBox!)
        .applyMatrix4(instance)
        .getCenter(new Vector3());
      expect(cabCenter.dot(velocity)).toBeGreaterThan(2);
    }
    cars.dispose();
  });
  it('subdivides every model for local dents without adding draws', () => {
    const scene = new Scene();
    const cars = createCarModelInstances(scene, 4);
    for (const kind of CAR_MODEL_KINDS) {
      const mesh = scene.getObjectByName(
        `traffic.${kind}.body`,
      ) as InstancedMesh;
      expect(mesh.geometry.getAttribute('position').count).toBe(294);
      expect(mesh.geometry.getAttribute('instanceCrush')).toBeInstanceOf(
        InstancedBufferAttribute,
      );
      const metrics = mesh.geometry.getAttribute('crushMetrics');
      expect(metrics.getX(0)).toBeCloseTo(CAR_MODELS[kind].halfExtents.x);
      expect(metrics.getY(0)).toBeCloseTo(CAR_MODELS[kind].halfExtents.z);
      expect(metrics.getZ(0)).toBeCloseTo(CAR_MODELS[kind].ride);
    }
    expect(cars.drawCalls).toBe(14);
    cars.dispose();
  });
  it('feeds four-sided per-instance damage to matching colour and shadow shaders', () => {
    const scene = new Scene();
    const cars = createCarModelInstances(scene, 4);
    const body = scene.getObjectByName(
      'traffic.boxTruck.body',
    ) as InstancedMesh;
    const cargo = scene.getObjectByName(
      'traffic.boxTruck.accent',
    ) as InstancedMesh;
    const sedan = scene.getObjectByName('traffic.sedan.body') as InstancedMesh;
    const position = { x: 0, y: CAR_MODELS.boxTruck.ride, z: 0 };
    const rotation = { x: 0, y: 0, z: 0, w: 1 };
    cars.begin();
    cars.push('boxTruck', position, rotation, 0);
    cars.push('boxTruck', position, rotation, 1, {
      front: 0,
      rear: 0.3,
      left: 0,
      right: 0,
    });
    cars.push('boxTruck', position, rotation, 2, {
      front: 0,
      rear: 1,
      left: 0,
      right: 0,
    });
    cars.push('boxTruck', position, rotation, 3, {
      front: 1,
      rear: 0,
      left: 1,
      right: 1,
    });
    cars.push('sedan', { x: 0, y: CAR_MODELS.sedan.ride, z: 0 }, rotation, 0, {
      front: 0,
      rear: 1,
      left: 0,
      right: 0,
    });
    cars.end();
    const crush = body.geometry.getAttribute(
      'instanceCrush',
    ) as InstancedBufferAttribute;
    expect([0, 1, 2, 3].map((i) => crush.getY(i))).toEqual([
      0, 0.30000001192092896, 1, 0,
    ]);
    expect([0, 1, 2, 3].map((i) => crush.getX(i))).toEqual([0, 0, 0, 1]);
    expect([0, 1, 2, 3].map((i) => crush.getZ(i))).toEqual([0, 0, 0, 1]);
    expect([0, 1, 2, 3].map((i) => crush.getW(i))).toEqual([0, 0, 0, 1]);
    const seeds = body.geometry.getAttribute(
      'instanceDentSeed',
    ) as InstancedBufferAttribute;
    for (let id = 0; id < 4; id++)
      expect(seeds.getX(id)).toBeCloseTo(dentSeedForId(id), 6);
    expect(new Set([0, 1, 2, 3].map((id) => seeds.getX(id))).size).toBe(4);
    expect(
      (
        sedan.geometry.getAttribute('instanceCrush') as InstancedBufferAttribute
      ).getY(0),
    ).toBe(1);
    const intact = new Matrix4();
    const dented = new Matrix4();
    const cargoDented = new Matrix4();
    body.getMatrixAt(0, intact);
    body.getMatrixAt(1, dented);
    cargo.getMatrixAt(1, cargoDented);
    // The vertex shader owns the dent: no whole-car lean, lift, or detached part.
    expect(Array.from(dented.elements)).toEqual(Array.from(intact.elements));
    expect(Array.from(cargoDented.elements)).toEqual(
      Array.from(intact.elements),
    );
    const source = (material: MeshStandardMaterial | MeshDepthMaterial) => {
      const shader = {
        vertexShader: '#include <common>\n#include <begin_vertex>',
      };
      material.onBeforeCompile(shader as never, {} as never);
      return shader.vertexShader;
    };
    const visible = source(body.material as MeshStandardMaterial);
    const shadow = source(body.customDepthMaterial as MeshDepthMaterial);
    expect(visible).toBe(shadow);
    expect(visible).toContain('attribute vec4 instanceCrush;');
    expect(visible).toContain('attribute float instanceDentSeed;');
    expect(visible).toContain(
      'transformed.z += 2.88 * (trafficRear - trafficFront)',
    );
    expect(visible).toContain(
      'transformed.x += 1.38 * (trafficLeft - trafficRight)',
    );
    expect(visible).toContain('transformed.y -= roof');
    cars.dispose();
  });
});
