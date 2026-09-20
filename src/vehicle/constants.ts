export const VEHICLE_GEOMETRY = {
  width: 1.8,
  height: 1,
  length: 4,
  wheelbase: 2.6,
  track: 1.6,
  wheelRadius: 0.34,
  maxDroop: 0.1,
  mounts: [
    { x: -0.8, y: -0.2, z: -1.3 },
    { x: 0.8, y: -0.2, z: -1.3 },
    { x: -0.8, y: -0.2, z: 1.3 },
    { x: 0.8, y: -0.2, z: 1.3 },
  ],
} as const;
export const DEG = Math.PI / 180;
