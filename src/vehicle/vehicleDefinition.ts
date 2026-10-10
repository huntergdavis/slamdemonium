import { VEHICLE_GEOMETRY } from './constants';
import { SPORTS_SEDAN_ENGINE } from './engineProfile';

/** One player vehicle definition; the Jolt body and drivetrain remain unchanged. */
export const HERO_SEDAN = {
  id: 'hero-sedan',
  label: 'Sports sedan',
  visualAsset: 'kenney-car-kit-3.1/sedan-sports-embedded.glb',
  collider: {
    width: VEHICLE_GEOMETRY.width,
    height: VEHICLE_GEOMETRY.height,
    length: VEHICLE_GEOMETRY.length,
  },
  wheelMounts: VEHICLE_GEOMETRY.mounts,
  wheelRadius: VEHICLE_GEOMETRY.wheelRadius,
  soundProfile: 'sports-sedan',
  engineProfile: SPORTS_SEDAN_ENGINE,
} as const;

export type HeroPaint = 'orange' | 'blue' | 'green';
export const HERO_PAINTS: readonly HeroPaint[] = ['orange', 'blue', 'green'];
