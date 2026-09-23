import type { ImpactSeverity } from '../core/impactSeverity';
import { MathUtils, PerspectiveCamera, Quaternion, Vector3 } from 'three';
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

/** Optional world query: distance from `from` toward `to` at which static
 * geometry blocks the segment, or null when clear. Boot supplies it from the
 * physics adapter's ray cast, ignoring the car's own body. */
export type LineOfSight = (from: Vector3, to: Vector3) => number | null;
export interface CameraRigOptions {
  lineOfSight?: LineOfSight;
}

/** Ordinary turning never approaches this; a 180 degree flip in one frame
 * is 10800 degrees per second. */
const MAX_TURN_RATE = MathUtils.degToRad(720);
/** The reverse swing takes about a second to go round the car. */
const SWING_RATE = MathUtils.degToRad(180);
/** Reverse must be sustained before the swing starts, so a blip after a
 * crash never throws the view around. */
const REVERSE_HOLD_SECONDS = 0.33;
const REVERSE_SPEED = 2;
/** Ground tilted past this is a bank or a loop, not a bump. */
const TRACK_TILT_COS = Math.cos(MathUtils.degToRad(20));
const FOLLOW_TAU = 0.15;
const EASE_BACK_TAU = 0.5;
/** Pull in to this far short of the blocking surface. */
const OCCLUSION_MARGIN = 0.5;

export class CameraRig {
  readonly position = new Vector3();
  readonly direction = new Vector3(0, 0, -1);
  readonly lookTarget = new Vector3();
  /** The camera's sense of up: world up on flat ground, the track's normal
   * on a bank or a loop. */
  readonly referenceUp = new Vector3(0, 1, 0);
  readonly telemetry = {
    cameraFov: 70,
    cameraFovRequested: 70,
    cameraFovCapped: false,
    cameraRoll: 0,
    /** 0..1 fraction the camera is pulled toward the car to keep sight of it. */
    cameraOccluded: 0,
    /** World-up component of the camera's reference up; 1 on flat ground. */
    cameraUpY: 1,
    cameraReversing: false,
  };
  preset: CameraPreset = 'chase';
  private readonly velocity = new Vector3();
  private readonly target = new Vector3();
  private readonly heading = new Vector3(0, 0, -1);
  private readonly candidate = new Vector3();
  private readonly groundNormal = new Vector3();
  private readonly upTarget = new Vector3();
  private readonly travel = new Vector3();
  private readonly axisRotation = new Quaternion();
  private readonly scratch = new Vector3();
  private initialized = false;
  private elapsed = 0;
  private meanCompression = 0;
  private impact = 0;
  private reverseSeconds = 0;
  private swinging = false;
  private occlusion = 0;
  private readonly lineOfSight: LineOfSight | null;

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly tuning: TuningStore,
    options: CameraRigOptions = {},
  ) {
    this.lineOfSight = options.lineOfSight ?? null;
  }

  reset(): void {
    this.initialized = false;
    this.velocity.set(0, 0, 0);
    this.impact = 0;
    this.referenceUp.copy(up);
    this.reverseSeconds = 0;
    this.swinging = false;
    this.occlusion = 0;
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

  /** Kick from the shared severity: about a centimetre of shake per m/s of
   * closing speed, capped. Estimated severity counts, so wall hits and
   * landings kick on Jolt, which reports no solved impulse. */
  addImpact(impact: Readonly<ImpactSeverity>): void {
    this.impact = Math.min(0.25, this.impact + impact.approachSpeed * 0.01);
  }

  /** The camera's sense of up. Flat ground (or three wheels on a kerb) keeps
   * world up exactly, so ordinary driving is untouched to the bit. Ground
   * tilted past twenty degrees blends toward the track normal, scaled by
   * camTrackFollow; no wheel contact holds the current frame (airborne, or on
   * the roof); coming back to level eases toward world up over half a second. */
  private updateReferenceUp(state: VehicleTelemetry, dt: number): void {
    let contacts = 0;
    this.groundNormal.set(0, 0, 0);
    for (const wheel of state.wheels)
      if (wheel.grounded) {
        this.groundNormal.add(wheel.contactNormal);
        contacts++;
      }
    const flatUp = this.referenceUp.y === 1;
    if (contacts === 0) return; // Hold.
    this.groundNormal.normalize();
    const follow = this.tuning.get('camTrackFollow');
    if (this.groundNormal.y >= TRACK_TILT_COS || follow <= 0) {
      if (flatUp) return; // Exactly world up already: nothing to do.
      this.upTarget.copy(up);
      this.blendUp(this.upTarget, dt, EASE_BACK_TAU);
      return;
    }
    this.upTarget.copy(up).lerp(this.groundNormal, follow).normalize();
    this.blendUp(this.upTarget, dt, FOLLOW_TAU);
  }

  private blendUp(target: Vector3, dt: number, tau: number): void {
    const k = 1 - Math.exp(-dt / tau);
    this.referenceUp.lerp(target, k).normalize();
    // Snap the last millimetre so flat ground returns to the exact fast path.
    if (this.referenceUp.y > 1 - 1e-9) this.referenceUp.copy(up);
  }

  /** Where the camera should look from: the car's heading, blended toward
   * the direction of travel, or swung round to face the reversing path. */
  private updateDirection(
    pose: Readonly<Pick<TransformState, 'position' | 'rotation'>>,
    state: VehicleTelemetry,
    dt: number,
  ): void {
    const t = this.tuning;
    const blend = this.preset === 'hood' ? 0 : t.get('camVelocityBlend');
    const flatUp = this.referenceUp.y === 1;
    // Reverse detection: sustained backwards travel before anything swings.
    if (state.vLong < -REVERSE_SPEED) this.reverseSeconds += dt;
    else this.reverseSeconds = 0;
    const swing = t.get('camReverseSwing');
    const reversing =
      this.reverseSeconds >= REVERSE_HOLD_SECONDS && this.preset !== 'hood';
    this.telemetry.cameraReversing = reversing;

    this.heading.set(0, 0, -1).applyQuaternion(pose.rotation);
    if (flatUp) {
      // The original planar path, bit for bit, so forward driving is untouched.
      this.heading.y = 0;
      if (this.heading.lengthSq() < 1e-10) this.heading.copy(this.direction);
      this.heading.normalize();
      blendDirection(this.heading, state.velocity, blend, this.candidate);
      if (reversing && swing > 0) {
        // Face the reversing path: rotate from the heading toward travel by
        // the swing fraction of the (roughly 180 degree) angle between them.
        this.travel.set(state.velocity.x, 0, state.velocity.z);
        if (this.travel.lengthSq() > 1) {
          this.travel.normalize();
          const headingAngle = Math.atan2(this.heading.x, -this.heading.z);
          const travelAngle = Math.atan2(this.travel.x, -this.travel.z);
          const delta = Math.atan2(
            Math.sin(travelAngle - headingAngle),
            Math.cos(travelAngle - headingAngle),
          );
          // Reversing is within a few degrees of dead astern, where the
          // sign of `delta` flips frame to frame; swing through the side the
          // camera is already nearer to, so it never turns back on itself.
          const currentAngle = Math.atan2(this.direction.x, -this.direction.z);
          const side = Math.sin(currentAngle - headingAngle) < 0 ? -1 : 1;
          const magnitude = Math.abs(delta) * swing;
          const angle = headingAngle + side * magnitude;
          this.candidate.set(Math.sin(angle), 0, -Math.cos(angle));
        }
      }
    } else {
      // Track frame: heading and travel projected onto the plane across the
      // reference up, blended the same way, then rate-limited about that up.
      this.direction.addScaledVector(
        this.referenceUp,
        -this.direction.dot(this.referenceUp),
      );
      if (this.direction.lengthSq() < 1e-10) this.direction.copy(this.heading);
      this.direction.normalize();
      this.heading.addScaledVector(
        this.referenceUp,
        -this.heading.dot(this.referenceUp),
      );
      if (this.heading.lengthSq() < 1e-10) this.heading.copy(this.direction);
      this.heading.normalize();
      this.candidate.copy(this.heading);
      this.travel
        .copy(state.velocity)
        .addScaledVector(
          this.referenceUp,
          -state.velocity.dot(this.referenceUp),
        );
      if (this.travel.lengthSq() > 64 && blend > 0) {
        this.travel.normalize();
        const angle = signedAngleAbout(
          this.heading,
          this.travel,
          this.referenceUp,
        );
        this.axisRotation.setFromAxisAngle(this.referenceUp, angle * blend);
        this.candidate.applyQuaternion(this.axisRotation);
      }
    }
    if (!this.initialized) {
      this.direction.copy(this.candidate);
      return;
    }
    // Rate limit toward the candidate about the reference up. Inside the
    // limit the candidate is copied exactly, which is every ordinary frame.
    const delta = signedAngleAbout(
      this.direction,
      this.candidate,
      this.referenceUp,
    );
    this.swinging =
      (reversing && swing > 0) ||
      (this.swinging && Math.abs(delta) > MathUtils.degToRad(5));
    const maxStep = (this.swinging ? SWING_RATE : MAX_TURN_RATE) * dt;
    if (Math.abs(delta) <= maxStep) this.direction.copy(this.candidate);
    else {
      this.axisRotation.setFromAxisAngle(
        this.referenceUp,
        Math.sign(delta) * maxStep,
      );
      this.direction.applyQuaternion(this.axisRotation).normalize();
    }
  }

  update(
    pose: Readonly<Pick<TransformState, 'position' | 'rotation'>>,
    state: VehicleTelemetry,
    dt: number,
  ): void {
    const t = this.tuning;
    this.elapsed += dt;
    this.updateReferenceUp(state, dt);
    this.updateDirection(pose, state, dt);
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
        )
        .addScaledVector(
          this.referenceUp,
          t.get('camHeight') * (far ? 1.5 : 1),
        );
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
    // Line of sight: if static geometry sits between the car and the camera,
    // pull the camera in to just short of it, quickly in and slowly out. At
    // zero pull the damped position is copied exactly, so a clear view
    // leaves ordinary driving untouched to the bit.
    this.updateOcclusion(pose.position, dt);
    if (this.occlusion === 0) this.camera.position.copy(this.position);
    else
      this.camera.position
        .copy(this.position)
        .sub(pose.position)
        .multiplyScalar(1 - this.occlusion)
        .add(pose.position);
    this.camera.position.x += noiseX * amplitude;
    this.camera.position.y +=
      noiseY * amplitude +
      t.get('camShake') * (compression - this.meanCompression) * 0.25;
    this.lookTarget
      .copy(pose.position)
      .addScaledVector(this.direction, 4 + 0.1 * state.speed)
      .addScaledVector(this.referenceUp, 0.8);
    this.camera.up.copy(this.referenceUp);
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
    this.telemetry.cameraOccluded = this.occlusion;
    this.telemetry.cameraUpY = this.referenceUp.y;
  }

  private updateOcclusion(carPosition: Vector3, dt: number): void {
    let wanted = 0;
    if (this.lineOfSight && this.preset !== 'hood') {
      const blockedAt = this.lineOfSight(carPosition, this.position);
      if (blockedAt !== null) {
        const span = this.scratch.copy(this.position).sub(carPosition).length();
        if (span > 1e-6)
          wanted = MathUtils.clamp(
            1 - Math.max(0, blockedAt - OCCLUSION_MARGIN) / span,
            0,
            1,
          );
      }
    }
    if (wanted === this.occlusion) return;
    const tau = wanted > this.occlusion ? 0.05 : 0.4;
    this.occlusion += (wanted - this.occlusion) * (1 - Math.exp(-dt / tau));
    if (this.occlusion < 1e-4 && wanted === 0) this.occlusion = 0;
  }
}

/** Signed angle from `a` to `b` about `axis`, both roughly in its plane. */
function signedAngleAbout(a: Vector3, b: Vector3, axis: Vector3): number {
  const cross =
    a.x * (b.y * axis.z - b.z * axis.y) +
    a.y * (b.z * axis.x - b.x * axis.z) +
    a.z * (b.x * axis.y - b.y * axis.x);
  return Math.atan2(cross, a.dot(b));
}
