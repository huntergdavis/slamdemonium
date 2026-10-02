import { Scene } from 'three';
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
      expect(width / ORIGINAL_TRAFFIC_BOX.width).toBeGreaterThanOrEqual(1.26);
      expect(width / ORIGINAL_TRAFFIC_BOX.width).toBeLessThanOrEqual(1.6);
      // The hatch is the short one and still longer than the old box; the
      // bus and truck are the long ones.
      expect(length).toBeGreaterThan(ORIGINAL_TRAFFIC_BOX.length);
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
});
