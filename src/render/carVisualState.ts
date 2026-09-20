import type { Quat, V3 } from '../physics/adapter';

/** Render-ready state; SI units, +X right, +Y up, -Z forward. No engine types. */
export interface WheelVisualState {
  /** Chassis-local wheel center, including suspension travel (not ray mount). */
  readonly centerLocal: Readonly<V3>;
  /** Radians about local +Y; positive steers left. Rear wheels render at zero. */
  readonly steerAngle: number;
  /**
   * Radians about the steered local +X axle, wrapped into [0, 2*pi).
   * Forward travel DECREASES angle. Producer interpolates before wrapping,
   * holds angle when locked, and advances faster when spinning.
   */
  readonly spinAngle: number;
  readonly grounded: boolean;
  readonly spinning: boolean;
  readonly locked: boolean;
  readonly contactPointWorld: Readonly<V3>;
  /** Combined longitudinal/lateral tire force in world Newtons; excludes spring. */
  readonly tireForceWorld: Readonly<V3>;
}

export interface VehicleVisualState {
  /** Interpolated geometric chassis center and unit quaternion. */
  readonly position: Readonly<V3>;
  readonly rotation: Readonly<Quat>;
  readonly velocityWorld: Readonly<V3>;
  /** Filtered actual braking in [0,1]; reverse throttle alone is NOT braking. */
  readonly brake01: number;
  readonly handbrake01: number;
  /** Fixed FL, FR, RL, RR order. Records may be reused and mutated by producer. */
  readonly wheels: readonly [
    WheelVisualState,
    WheelVisualState,
    WheelVisualState,
    WheelVisualState,
  ];
}
