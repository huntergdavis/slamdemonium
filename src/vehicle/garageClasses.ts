import { VEHICLE_GEOMETRY, type VehicleGeometry } from './constants';
import {
  DEFAULT_ENGINE,
  SPORTS_SEDAN_ENGINE,
  type EngineProfile,
} from './engineProfile';
import type { ParamPatch } from '../tuning/schema';

export type GarageClassId = 'compact' | 'muscle' | 'coupe' | 'sports' | 'super';
export const GARAGE_STORAGE_KEY = 'slamdemonium.garageClass.v1';

export interface GarageClass {
  readonly id: GarageClassId;
  readonly label: string;
  readonly trait: string;
  readonly geometry: VehicleGeometry;
  readonly tuning: Readonly<ParamPatch>;
  readonly engineProfile: EngineProfile;
}

const COMPACT_ENGINE: EngineProfile = {
  ...SPORTS_SEDAN_ENGINE,
  idleRpm: 1150,
  redlineRpm: 7900,
  boostRpm: 9250,
  firingStrength: [1, 0.8, 0.91, 0.76],
  firingGap: [1.08, 0.92, 1.04, 0.96],
  pipeSeconds: 0.0058,
  pipeFeedback: 0.38,
  pipeLossHz: 2900,
  mufflerSeconds: 0.0019,
  mufflerFeedback: 0.22,
  mufflerLossHz: 1800,
};

const COUPE_ENGINE: EngineProfile = {
  ...SPORTS_SEDAN_ENGINE,
  idleRpm: 1020,
  redlineRpm: 7450,
  boostRpm: 8850,
  firingStrength: [1, 0.72, 0.88, 0.79],
  firingGap: [1.12, 0.88, 1.06, 0.94],
  pipeSeconds: 0.0074,
  pipeFeedback: 0.52,
  pipeLossHz: 1900,
  mufflerSeconds: 0.0027,
  mufflerFeedback: 0.32,
  mufflerLossHz: 1250,
};

const SUPER_ENGINE: EngineProfile = {
  ...SPORTS_SEDAN_ENGINE,
  idleRpm: 1200,
  redlineRpm: 8600,
  boostRpm: 9900,
  firingsPerRevolution: 3,
  firingStrength: [1, 0.93, 0.98, 0.91, 0.96, 0.94],
  firingGap: [1, 1, 1, 1, 1, 1],
  pipeSeconds: 0.0045,
  pipeFeedback: 0.3,
  pipeLossHz: 3400,
  mufflerSeconds: 0.0016,
  mufflerFeedback: 0.16,
  mufflerLossHz: 2200,
};

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
    engineProfile: COMPACT_ENGINE,
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
    engineProfile: DEFAULT_ENGINE,
  },
  coupe: {
    id: 'coupe',
    label: 'Coupe',
    trait: 'Balanced drift · tidy recovery · flowing speed',
    geometry: scaledGeometry(2.12, 1.14, 4.65),
    tuning: {
      mass: 1200,
      accel0: 15,
      topSpeed: 58,
      boostTopSpeedAdd: 20,
      steerMaxLowSpeed: 44,
      steerMaxTopSpeed: 6.5,
    },
    engineProfile: COUPE_ENGINE,
  },
  sports: {
    id: 'sports',
    label: 'Sports',
    trait: 'Balanced launch · strong corner exit',
    geometry: VEHICLE_GEOMETRY,
    tuning: {},
    engineProfile: SPORTS_SEDAN_ENGINE,
  },
  super: {
    id: 'super',
    label: 'Super',
    trait: 'High top end · deliberate turn · sharp boost',
    geometry: scaledGeometry(2.25, 1.1, 4.95),
    tuning: {
      mass: 1400,
      accel0: 14.5,
      topSpeed: 65,
      boostTopSpeedAdd: 22,
      steerMaxLowSpeed: 36,
      steerMaxTopSpeed: 4.5,
    },
    engineProfile: SUPER_ENGINE,
  },
};

export const GARAGE_CLASS_IDS: readonly GarageClassId[] = [
  'compact',
  'muscle',
  'coupe',
  'sports',
  'super',
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
