export const VEHICLE_GEOMETRY = {
  width: 2.43,
  height: 1.3,
  length: 5.4,
  wheelbase: 3.51,
  track: 2.16,
  wheelRadius: 0.44,
  maxDroop: 0.1,
  // The taller chassis needs this clearance over the R14/R18 loop arcs.
  // Scaling the old -0.2 m mount to -0.27 m narrowed R14 tolerance to 0°.
  mounts: [
    { x: -1.08, y: -0.4, z: -1.755 },
    { x: 1.08, y: -0.4, z: -1.755 },
    { x: -1.08, y: -0.4, z: 1.755 },
    { x: 1.08, y: -0.4, z: 1.755 },
  ],
} as const;
export const DEG = Math.PI / 180;
