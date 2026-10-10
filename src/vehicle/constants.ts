export interface VehicleGeometry {
  readonly width: number;
  readonly height: number;
  readonly length: number;
  readonly wheelbase: number;
  readonly track: number;
  readonly wheelRadius: number;
  readonly maxDroop: number;
  readonly mounts: readonly {
    readonly x: number;
    readonly y: number;
    readonly z: number;
  }[];
}

export const VEHICLE_GEOMETRY = {
  width: 2.16,
  height: 1.2,
  length: 4.8,
  wheelbase: 3.12,
  track: 1.92,
  wheelRadius: 0.44,
  maxDroop: 0.1,
  // Lowering the wheel mounts keeps the taller chassis clear of loop arcs.
  mounts: [
    { x: -0.96, y: -0.3, z: -1.56 },
    { x: 0.96, y: -0.3, z: -1.56 },
    { x: -0.96, y: -0.3, z: 1.56 },
    { x: 0.96, y: -0.3, z: 1.56 },
  ],
} as const;
export const DEG = Math.PI / 180;
