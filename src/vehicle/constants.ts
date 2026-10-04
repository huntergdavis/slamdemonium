export const VEHICLE_GEOMETRY = {
  width: 2.43,
  height: 1.3,
  length: 5.4,
  wheelbase: 3.51,
  track: 2.16,
  wheelRadius: 0.44,
  maxDroop: 0.1,
  mounts: [
    { x: -1.08, y: -0.27, z: -1.755 },
    { x: 1.08, y: -0.27, z: -1.755 },
    { x: -1.08, y: -0.27, z: 1.755 },
    { x: 1.08, y: -0.27, z: 1.755 },
  ],
} as const;
export const DEG = Math.PI / 180;
