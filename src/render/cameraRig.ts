import { MathUtils, PerspectiveCamera, Vector3 } from 'three';
import type { TransformState } from '../core/transforms';
import type { TuningStore } from '../tuning/store';
import type { VehicleTelemetry } from '../vehicle/telemetry';

export const MAX_CAMERA_FOV = 115;
export type CameraPreset = 'chase' | 'far' | 'hood';
const axes = ['x', 'y', 'z'] as const;
const up = new Vector3(0, 1, 0);

/** Exact constant-target solution; followTime is the 2/omega damping time. */
export function criticallyDamp(
  position: Vector3,
  velocity: Vector3,
  target: Vector3,
  followTime: number,
  dt: number,
): void {
  const omega = 2 / Math.max(followTime, 0.001);
  const decay = Math.exp(-omega * dt);
  for (const axis of axes) {
    const offset = position[axis] - target[axis];
    const impulse = velocity[axis] + omega * offset;
    position[axis] = target[axis] + (offset + impulse * dt) * decay;
    velocity[axis] = (velocity[axis] - omega * impulse * dt) * decay;
  }
}

export function requestedFov(
  base: number,
  speedGain: number,
  boostKick: number,
  speed: number,
  topSpeed: number,
  boostEnvelope: number,
): number {
  return (
    base +
    speedGain * (Math.max(0, speed) / topSpeed) ** 1.5 +
    boostKick * boostEnvelope
  );
}

/** Final projection guard, including invalid/non-finite input at this boundary. */
export function boundedFov(requested: number): number {
  if (Number.isNaN(requested)) return 70;
  return MathUtils.clamp(requested, 1, MAX_CAMERA_FOV);
}

/** Planar spherical interpolation, without passing through a zero vector. */
export function blendDirection(
  heading: Vector3,
  velocity: Vector3,
  blend: number,
  out: Vector3,
): void {
  const headingAngle = Math.atan2(heading.x, -heading.z);
  let angle = headingAngle;
  if (Math.hypot(velocity.x, velocity.z) > 8) {
    const velocityAngle = Math.atan2(velocity.x, -velocity.z);
    const delta = Math.atan2(
      Math.sin(velocityAngle - headingAngle),
      Math.cos(velocityAngle - headingAngle),
    );
    angle += delta * blend;
  }
  out.set(Math.sin(angle), 0, -Math.cos(angle));
}

export class CameraRig {
  readonly position = new Vector3();
  readonly direction = new Vector3(0, 0, -1);
  readonly lookTarget = new Vector3();
  readonly telemetry = {
    cameraFov: 70,
    cameraFovRequested: 70,
    cameraFovCapped: false,
    cameraRoll: 0,
  };
  preset: CameraPreset = 'chase';
  private readonly velocity = new Vector3();
  private readonly target = new Vector3();
  private readonly heading = new Vector3(0, 0, -1);
  private initialized = false;
  private elapsed = 0;
  private meanCompression = 0;
  private impact = 0;

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly tuning: TuningStore,
  ) {}

  reset(): void {
    this.initialized = false;
    this.velocity.set(0, 0, 0);
    this.impact = 0;
  }

  setPreset(preset: CameraPreset): void {
    if (preset !== 'chase' && preset !== 'far' && preset !== 'hood')
      throw new RangeError('Unknown camera preset.');
    this.preset = preset;
    this.reset();
  }

  cyclePreset(count = 1): void {
    const presets = ['chase', 'far', 'hood'] as const;
    this.setPreset(
      presets[(presets.indexOf(this.preset) + count) % presets.length]!,
    );
  }

  /** Hook for engines with real solved impulses; Jolt's null remains absent. */
  addImpact(impulse: number | null, mass: number): void {
    if (impulse !== null && Number.isFinite(impulse) && mass > 0)
      this.impact = Math.min(
        0.25,
        this.impact + (Math.max(0, impulse) / mass) * 0.01,
      );
  }

  update(
    pose: Readonly<Pick<TransformState, 'position' | 'rotation'>>,
    state: VehicleTelemetry,
    dt: number,
  ): void {
    const t = this.tuning;
    this.elapsed += dt;
    this.heading.set(0, 0, -1).applyQuaternion(pose.rotation);
    // Keep the previous heading if the chassis points straight up/down.
    this.heading.y = 0;
    if (this.heading.lengthSq() < 1e-10) this.heading.copy(this.direction);
    this.heading.normalize();
    blendDirection(
      this.heading,
      state.velocity,
      this.preset === 'hood' ? 0 : t.get('camVelocityBlend'),
      this.direction,
    );
    const far = this.preset === 'far';
    if (this.preset === 'hood') {
      this.target
        .set(0, 0.65, -1.55)
        .applyQuaternion(pose.rotation)
        .add(pose.position);
    } else {
      this.target
        .copy(pose.position)
        .addScaledVector(
          this.direction,
          -t.get('camDistance') * (far ? 1.6 : 1),
        );
      this.target.y += t.get('camHeight') * (far ? 1.5 : 1);
    }
    let compression = 0;
    for (const wheel of state.wheels) compression += wheel.compression * 0.25;
    if (!this.initialized) {
      this.position.copy(this.target);
      this.meanCompression = compression;
      this.initialized = true;
    }
    if (this.preset === 'hood') this.position.copy(this.target);
    else
      criticallyDamp(
        this.position,
        this.velocity,
        this.target,
        t.get('camFollowTime'),
        dt,
      );
    this.meanCompression +=
      (compression - this.meanCompression) * (1 - Math.exp(-dt * 6));
    this.impact *= Math.exp(-dt * 12);
    const speedFactor = MathUtils.clamp(state.speed / t.get('topSpeed'), 0, 2);
    const amplitude = t.get('camShake') * (0.025 * speedFactor + this.impact);
    const noiseX =
      Math.sin(this.elapsed * 47) * 0.6 + Math.sin(this.elapsed * 79) * 0.4;
    const noiseY =
      Math.sin(this.elapsed * 61) * 0.6 + Math.sin(this.elapsed * 103) * 0.4;
    this.camera.position.copy(this.position);
    this.camera.position.x += noiseX * amplitude;
    this.camera.position.y +=
      noiseY * amplitude +
      t.get('camShake') * (compression - this.meanCompression) * 0.25;
    this.lookTarget
      .copy(pose.position)
      .addScaledVector(this.direction, 4 + 0.1 * state.speed);
    this.lookTarget.y += 0.8;
    this.camera.up.copy(up);
    this.camera.lookAt(this.lookTarget);
    // G is the conventional 9.81 m/s² unit, independent of the gravity slider.
    const roll =
      (MathUtils.degToRad(t.get('camRollGain')) * state.lateralAcceleration) /
      9.81;
    this.camera.rotateZ(roll);
    const requested = requestedFov(
      t.get('fovBase'),
      t.get('fovSpeedGain'),
      t.get('fovBoostKick'),
      state.speed,
      t.get('topSpeed'),
      state.boostEnvelope,
    );
    const fov = boundedFov(requested);
    if (this.camera.fov !== fov) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    this.telemetry.cameraFov = fov;
    this.telemetry.cameraFovRequested = requested;
    this.telemetry.cameraFovCapped = fov !== requested;
    this.telemetry.cameraRoll = roll;
  }
}
