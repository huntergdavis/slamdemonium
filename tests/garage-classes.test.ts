import { expect, it } from 'vitest';
import {
  GARAGE_CLASSES,
  GARAGE_STORAGE_KEY,
  readGarageClass,
  storeGarageClass,
} from '../src/vehicle/garageClasses';
import { VEHICLE_GEOMETRY } from '../src/vehicle/constants';

it('keeps Sports as the unchanged default while selecting different physical bodies', () => {
  expect(readGarageClass(null)).toBe('sports');
  expect(GARAGE_CLASSES.sports.geometry).toBe(VEHICLE_GEOMETRY);
  expect(GARAGE_CLASSES.compact.geometry.length).toBeLessThan(
    GARAGE_CLASSES.sports.geometry.length,
  );
  expect(GARAGE_CLASSES.muscle.geometry.length).toBeGreaterThan(
    GARAGE_CLASSES.sports.geometry.length,
  );
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
