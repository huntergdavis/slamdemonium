import { VEHICLE_GEOMETRY, type VehicleGeometry } from './constants';
import { HERO_SEDAN } from './vehicleDefinition';
import type { EngineProfile } from './engineProfile';
import type { ParamPatch } from '../tuning/schema';

export type GarageClassId = 'compact' | 'muscle' | 'sports';
export const GARAGE_STORAGE_KEY = 'slamdemonium.garageClass.v1';

export interface GarageClass {
  readonly id: GarageClassId;
  readonly label: string;
  readonly trait: string;
  readonly geometry: VehicleGeometry;
  readonly tuning: Readonly<ParamPatch>;
  readonly engineProfile: EngineProfile;
}

function scaledGeometry(
  width: number,
  height: number,
  length: number,
): VehicleGeometry {
  const sx = width / VEHICLE_GEOMETRY.width;
  const sy = height / VEHICLE_GEOMETRY.height;
  const sz = length / VEHICLE_GEOMETRY.length;
  return {
    width,
    height,
    length,
    wheelbase: VEHICLE_GEOMETRY.wheelbase * sz,
    track: VEHICLE_GEOMETRY.track * sx,
    wheelRadius: VEHICLE_GEOMETRY.wheelRadius * sy,
    maxDroop: VEHICLE_GEOMETRY.maxDroop * sy,
    mounts: VEHICLE_GEOMETRY.mounts.map((mount) => ({
      x: mount.x * sx,
      y: mount.y * sy,
      z: mount.z * sz,
    })),
  };
}

export const GARAGE_CLASSES: Readonly<Record<GarageClassId, GarageClass>> = {
  compact: {
    id: 'compact',
    label: 'Compact',
    trait: 'Quick launch · tight turn · light shove',
    geometry: scaledGeometry(1.95, 1.16, 4.05),
    tuning: {
      mass: 1050,
      accel0: 17,
      topSpeed: 50,
      boostTopSpeedAdd: 18,
      steerMaxLowSpeed: 48,
      steerMaxTopSpeed: 8,
    },
    engineProfile: HERO_SEDAN.engineProfile,
  },
  muscle: {
    id: 'muscle',
    label: 'Muscle',
    trait: 'Heavy shove · broad turn · strong straight',
    geometry: scaledGeometry(2.35, 1.25, 5.4),
    tuning: {
      mass: 1650,
      accel0: 15,
      topSpeed: 54,
      boostTopSpeedAdd: 20,
      steerMaxLowSpeed: 32,
      steerMaxTopSpeed: 3.5,
    },
    engineProfile: HERO_SEDAN.engineProfile,
  },
  sports: {
    id: 'sports',
    label: 'Sports',
    trait: 'Balanced launch · strong corner exit',
    geometry: VEHICLE_GEOMETRY,
    tuning: {},
    engineProfile: HERO_SEDAN.engineProfile,
  },
};

export const GARAGE_CLASS_IDS: readonly GarageClassId[] = [
  'compact',
  'muscle',
  'sports',
];

export function isGarageClassId(value: unknown): value is GarageClassId {
  return typeof value === 'string' && Object.hasOwn(GARAGE_CLASSES, value);
}

export function readGarageClass(
  storage: Pick<Storage, 'getItem'> | null,
  search = '',
): GarageClassId {
  const explicit = new URLSearchParams(search).get('car');
  if (isGarageClassId(explicit)) return explicit;
  try {
    const stored = storage?.getItem(GARAGE_STORAGE_KEY);
    if (isGarageClassId(stored)) return stored;
  } catch {
    // A blocked storage API still leaves the URL and Sports default usable.
  }
  return 'sports';
}

export function storeGarageClass(
  storage: Pick<Storage, 'setItem' | 'removeItem'> | null,
  id: GarageClassId,
  workingSetKey: string,
): void {
  try {
    storage?.setItem(GARAGE_STORAGE_KEY, id);
    // Tuning a prior car must not become the next car's base profile.
    storage?.removeItem(workingSetKey);
  } catch {
    // The URL selector still carries the chosen car for this navigation.
  }
}
