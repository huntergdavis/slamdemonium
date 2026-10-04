import { Box3, InstancedMesh, Matrix4, Scene } from 'three';
import { describe, expect, it } from 'vitest';
import {
  CAR_MODELS,
  CAR_MODEL_KINDS,
  CAR_PALETTE,
  ORIGINAL_TRAFFIC_BOX,
  carHalfWidth,
  createCarModelInstances,
  paletteColorIndex,
  pickCarModelKind,
} from '../src/world/carModels';

describe('car model catalogue', () => {
  it('has six kinds, every one 30 to 40 percent longer and wider than the first traffic box, with distinct shapes', () => {
    expect(CAR_MODEL_KINDS).toHaveLength(6);
    const lengths = new Set<number>();
    for (const kind of CAR_MODEL_KINDS) {
      const m = CAR_MODELS[kind];
      const length = m.halfExtents.z * 2;
      const width = m.halfExtents.x * 2;
      // Every kind, the small ones included, is at least 1.3 times the old
      // box in both length and width; the bus and truck run much longer.
      expect(width / ORIGINAL_TRAFFIC_BOX.width).toBeGreaterThanOrEqual(1.3);
      expect(width / ORIGINAL_TRAFFIC_BOX.width).toBeLessThanOrEqual(1.6);
      expect(length / ORIGINAL_TRAFFIC_BOX.length).toBeGreaterThanOrEqual(1.3);
      lengths.add(Math.round(length * 10));
      expect(m.parts.length).toBeGreaterThanOrEqual(2);
      expect(m.share).toBeGreaterThan(0);
    }
    expect(lengths.size).toBe(6);
    expect(CAR_MODELS.sedan.halfExtents.z * 2).toBeCloseTo(
      ORIGINAL_TRAFFIC_BOX.length * 1.357,
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
  it('visibly crushes the struck end of every kind without extra draws or shared geometry changes', () => {
    const scene = new Scene();
    const cars = createCarModelInstances(scene, 3);
    const draws = cars.drawCalls;
    const q = { x: 0, y: 0, z: 0, w: 1 };
    const matrix = new Matrix4();
    const extent = (kind: (typeof CAR_MODEL_KINDS)[number], index: number) => {
      const mesh = scene.getObjectByName(
        `traffic.${kind}.body`,
      ) as InstancedMesh;
      mesh.getMatrixAt(index, matrix);
      mesh.geometry.computeBoundingBox();
      return new Box3().copy(mesh.geometry.boundingBox!).applyMatrix4(matrix);
    };
    for (const kind of CAR_MODEL_KINDS) {
      const position = { x: 0, y: CAR_MODELS[kind].ride, z: 0 };
      cars.begin();
      cars.push(kind, position, q, 1);
      cars.push(kind, position, q, 2, {
        front: 1,
        rear: 0,
        left: 0,
        right: 0,
      });
      cars.push(kind, position, q, 3, {
        front: 0,
        rear: 1,
        left: 0,
        right: 0,
      });
      cars.end();
      const intact = extent(kind, 0);
      const front = extent(kind, 1);
      const rear = extent(kind, 2);
      expect(front.max.z).toBeLessThan(intact.max.z - 0.5);
      expect(front.min.z).toBeCloseTo(intact.min.z, 5);
      expect(rear.min.z).toBeGreaterThan(intact.min.z + 0.5);
      expect(rear.max.z).toBeCloseTo(intact.max.z, 5);
      cars.begin();
      cars.push(kind, position, q, 1);
      cars.push(kind, position, q, 2, {
        front: 0,
        rear: 0,
        left: 0,
        right: 1,
      });
      cars.end();
      const sideIntact = extent(kind, 0);
      const sideCrushed = extent(kind, 1);
      expect(sideCrushed.max.x).toBeLessThan(sideIntact.max.x - 0.4);
      expect(sideCrushed.min.x).toBeCloseTo(sideIntact.min.x, 5);
      expect(cars.drawCalls).toBe(draws);
    }
    cars.dispose();
  });
});
