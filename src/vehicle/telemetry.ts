import { Quaternion, Vector3 } from 'three';
import type { RayHit } from '../physics/adapter';
import type {
  SurfaceId,
  SurfaceResolverDiagnostics,
} from '../content/surfaces';

export class WheelState {
  readonly mount = new Vector3();
  readonly centerLocal = new Vector3();
  readonly tireForceWorld = new Vector3();
  readonly contactPoint = new Vector3();
  readonly contactPointWorld = this.contactPoint;
  readonly contactNormal = new Vector3(0, 1, 0);
  readonly hit: RayHit = {
    distance: 0,
    point: this.contactPoint,
    normal: this.contactNormal,
    bodyId: 0,
    surfaceId: 0,
  };
  readonly forward = new Vector3();
  readonly right = new Vector3();
  readonly applyPoint = new Vector3();
  grounded = false;
  /** Canonical world classification; RayHit retains the raw collider metadata. */
  surfaceId: SurfaceId | null = null;
  /** Null means no tyre surface; zero is a valid ground grip multiplier. */
  surfaceGripMultiplier: number | null = null;
  compression = 0;
  suspensionLength = 0;
  springForce = 0;
  Fz = 0;
  alpha = 0;
  rawAlpha = 0;
  Fx = 0;
  Fy = 0;
  mu = 0;
  gripUsage = 0;
  spinning = false;
  locked = false;
  steerAngle = 0;
  spinAngle = 0;
  spinDelta = 0;
  vx = 0;
  vy = 0;
}
export class VehicleTelemetry {
  /** Live resolver-owned diagnostics. Copy for snapshots; a rebuilt world owns
   * a new record and the old resolver reports disposed. Vehicle respawn keeps it. */
  constructor(
    readonly surfaceDiagnostics: SurfaceResolverDiagnostics | null = null,
  ) {}

  readonly position = new Vector3();
  readonly rotation = new Quaternion();
  readonly velocity = new Vector3();
  readonly angularVelocity = new Vector3();
  readonly wheels = [
    new WheelState(),
    new WheelState(),
    new WheelState(),
    new WheelState(),
  ] as const;
  speed = 0;
  speedKmh = 0;
  vLong = 0;
  vLat = 0;
  beta = 0;
  yawRate = 0;
  longitudinalAcceleration = 0;
  lateralAcceleration = 0;
  groundedWheels = 0;
  steerAngle = 0;
  throttle = 0;
  brake = 0;
  handbrake = false;
  brake01 = 0;
  handbrake01 = 0;
  boostMeter = 0;
  driftMeter = 0;
  boostEnvelope = 0;
  charging = false;
  driftLatched = false;
  driftTarget = 0;
  yawAssistTorque = 0;
  physicsStepMs = 0;
  totalSteps = 0;
  stepsPerFrame = 0;
  alpha = 0;
  physicsHz = 120;
  timeScale = 1;
  recoveryCount = 0;
  /** Derived engine state from the rpm model (see vehicle/rpmModel.ts):
   * presentation only, never an input to the drivetrain. The shift counters
   * are monotonic so any polling rate detects every shift by diffing. */
  rpm = 0;
  gear = 1;
  gearCount = 1;
  idleRpm = 0;
  redlineRpm = 0;
  upshiftCount = 0;
  downshiftCount = 0;
  /** Derived airborne state (see vehicle/airState.ts): presentation only.
   * landingCount is monotonic so any polling rate sees every landing. */
  airborne = false;
  airTime = 0;
  lastAirTime = 0;
  landingCount = 0;
}
