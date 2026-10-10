import { expect, it } from 'vitest';
import {
  GARAGE_CLASSES,
  GARAGE_CLASS_IDS,
  GARAGE_STORAGE_KEY,
  RACE_GARAGE_CLASS_IDS,
  garageClassAllowedOnMap,
  readGarageClass,
  storeGarageClass,
} from '../src/vehicle/garageClasses';
import { VEHICLE_GEOMETRY } from '../src/vehicle/constants';
import { PARAM_BY_KEY } from '../src/tuning/schema';
import {
  garageSilhouettePoint,
  heavyCabinProfile,
} from '../src/render/garageSilhouette';

it('keeps Sports as the default and every heavyweight Crash-only', () => {
  expect(readGarageClass(null)).toBe('sports');
  expect(RACE_GARAGE_CLASS_IDS).toHaveLength(5);
  expect(GARAGE_CLASS_IDS).toHaveLength(8);
  for (const id of ['pickup', 'suv', 'bus'] as const) {
    expect(garageClassAllowedOnMap(id, 'crash-south')).toBe(true);
    expect(garageClassAllowedOnMap(id, 'crash-west')).toBe(true);
    expect(garageClassAllowedOnMap(id, 'circuit-race')).toBe(false);
  }
  expect(garageClassAllowedOnMap('sports', 'circuit-race')).toBe(true);
  expect(GARAGE_CLASSES.sports.geometry).toBe(VEHICLE_GEOMETRY);
  expect(GARAGE_CLASSES.compact.geometry.length).toBeLessThan(
    GARAGE_CLASSES.sports.geometry.length,
  );
  expect(GARAGE_CLASSES.muscle.geometry.length).toBeGreaterThan(
    GARAGE_CLASSES.sports.geometry.length,
  );
  expect(GARAGE_CLASSES.super.tuning.topSpeed).toBe(65);
  expect(GARAGE_CLASSES.coupe.tuning.topSpeed).toBe(58);
});

it('changes the roofline without pulling wheel arches or body edges off the collider', () => {
  const source: [number, number, number] = [0.75, 0.55, 1];
  const shapes = RACE_GARAGE_CLASS_IDS.map((id) =>
    garageSilhouettePoint(id, ...source),
  );
  expect(new Set(shapes.map((point) => point.join(','))).size).toBe(5);
  expect(garageSilhouettePoint('coupe', ...source)[1]).toBeLessThan(
    garageSilhouettePoint('sports', ...source)[1] - 0.15,
  );
  expect(garageSilhouettePoint('muscle', ...source)[0]).toBeGreaterThan(
    garageSilhouettePoint('super', ...source)[0] + 0.15,
  );
  for (const id of RACE_GARAGE_CLASS_IDS) {
    const dimensions = GARAGE_CLASSES[id].geometry;
    const scale = [
      dimensions.width / VEHICLE_GEOMETRY.width,
      dimensions.height / VEHICLE_GEOMETRY.height,
      dimensions.length / VEHICLE_GEOMETRY.length,
    ];
    for (const x of [-1.08, 0, 1.08])
      for (const y of [-0.6, -0.2, 0.2, 0.6])
        for (const z of [-2.4, -1.2, 0, 1.2, 2.4]) {
          const point: [number, number, number] = [x, y, z];
          const shaped = garageSilhouettePoint(id, ...point);
          for (let axis = 0; axis < 3; axis++)
            expect(
              Math.abs((shaped[axis]! - point[axis]!) * scale[axis]!),
            ).toBeLessThan(0.3);
        }
    expect(garageSilhouettePoint(id, 0.9, -0.2, -1.5)).toEqual([
      0.9, -0.2, -1.5,
    ]);
  }
});

it('gives the pickup a bed behind its cab without moving the wheel arches', () => {
  const pickup = GARAGE_CLASSES.pickup;
  expect(pickup.geometry.length).toBeGreaterThan(
    GARAGE_CLASSES.muscle.geometry.length,
  );
  expect(pickup.geometry.width).toBeGreaterThan(
    GARAGE_CLASSES.muscle.geometry.width,
  );
  expect(garageSilhouettePoint('pickup', 0, 0.55, 1)[1]).toBeLessThan(0.2);
  expect(garageSilhouettePoint('pickup', 0.9, -0.2, 1)).toEqual([0.9, -0.2, 1]);
  expect(garageSilhouettePoint('pickup', 0.9, 0.2, 1.2)).toEqual([
    0.9, 0.2, 1.2,
  ]);
});

it('keeps the SUV and bus silhouettes inside their collider envelopes', () => {
  expect(GARAGE_CLASSES.bus.geometry.length).toBeGreaterThanOrEqual(
    GARAGE_CLASSES.suv.geometry.length + 2,
  );
  expect(GARAGE_CLASSES.bus.geometry.width).toBeGreaterThan(
    GARAGE_CLASSES.suv.geometry.width,
  );
  for (const id of ['suv', 'bus'] as const) {
    const geometry = GARAGE_CLASSES[id].geometry;
    const heightScale = geometry.height / VEHICLE_GEOMETRY.height;
    const cab = heavyCabinProfile(id)!;
    const scales = [
      geometry.width / VEHICLE_GEOMETRY.width,
      heightScale,
      geometry.length / VEHICLE_GEOMETRY.length,
    ];
    const extents = [
      cab.width / 2,
      cab.centerY + cab.height / 2,
      Math.abs(cab.centerZ) + cab.length / 2,
    ];
    for (let axis = 0; axis < 3; axis++)
      expect(extents[axis]! * scales[axis]!).toBeLessThan(
        [geometry.width, geometry.height, geometry.length][axis]! / 2 + 0.3,
      );
    for (const y of [-0.2, 0.2, 0.55]) {
      const shaped = garageSilhouettePoint(id, 0.8, y, 1);
      expect(Math.abs((shaped[1] - y) * heightScale)).toBeLessThan(0.3);
    }
    expect(garageSilhouettePoint(id, 0.9, -0.2, 1)).toEqual([0.9, -0.2, 1]);
  }
});

it('gives Compact, Muscle, Sports and Super distinct engine identities', () => {
  const signatures = GARAGE_CLASS_IDS.map((id) => {
    const profile = GARAGE_CLASSES[id].engineProfile;
    return [
      profile.firingsPerRevolution,
      profile.pipeSeconds,
      profile.pipeLossHz,
      profile.firingStrength.join(','),
    ].join('/');
  });
  expect(new Set(signatures).size).toBe(GARAGE_CLASS_IDS.length);
});

it('keeps every authored class mass inside the real tuning range', () => {
  for (const id of GARAGE_CLASS_IDS) {
    const mass = GARAGE_CLASSES[id].tuning.mass ?? PARAM_BY_KEY.mass.default;
    expect(mass).toBeGreaterThanOrEqual(PARAM_BY_KEY.mass.min);
    expect(mass).toBeLessThanOrEqual(PARAM_BY_KEY.mass.max);
  }
});

it('persists the selected class and discards tuning from the previous car', () => {
  const values = new Map<string, string>([['working', '{"topSpeed":120}']]);
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
  storeGarageClass(storage, 'compact', 'working');
  expect(values.get('working')).toBeUndefined();
  expect(values.get(GARAGE_STORAGE_KEY)).toBe('compact');
  expect(readGarageClass(storage)).toBe('compact');
  expect(readGarageClass(storage, '?car=muscle')).toBe('muscle');
  expect(readGarageClass(storage, '?car=unknown')).toBe('compact');
});
