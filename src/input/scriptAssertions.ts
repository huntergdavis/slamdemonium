import type { ScriptSpawn } from './scriptFormat';

export interface ReplayTelemetry extends ScriptSpawn {
  readonly speed: number;
  readonly beta: number; // radians
  /** Vehicle increments this when it repairs non-finite state before publication. */
  readonly recoveryCount?: number;
}
export interface ReplayResult {
  readonly completedSteps: number;
  readonly finalPose: ScriptSpawn;
  readonly peakSpeed: number;
  readonly peakAbsSlideAngle: number; // radians
  readonly allFinite: boolean;
  readonly firstNonFiniteStep: number | null;
}

function allNumbersFinite(value: unknown, depth = 0): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  if (value === null || typeof value !== 'object') return true;
  // Telemetry is a shallow tree; cycles or unexpectedly deep engine objects are invalid input.
  if (depth > 12) return false;
  for (const key in value) {
    if (
      Object.hasOwn(value, key) &&
      !allNumbersFinite((value as Record<string, unknown>)[key], depth + 1)
    )
      return false;
  }
  return true;
}

/** Mutable storage is private and reused in postStep; snapshot only at a result boundary. */
export class ReplayMetrics {
  private initialRecoveryCount = 0;
  private readonly pose = {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
  };
  private readonly state = {
    completedSteps: 0,
    finalPose: this.pose,
    peakSpeed: 0,
    peakAbsSlideAngle: 0,
    allFinite: true,
    firstNonFiniteStep: null as number | null,
  };

  reset(spawn: ScriptSpawn, recoveryCount = 0): void {
    this.initialRecoveryCount = recoveryCount;
    this.state.completedSteps = 0;
    this.state.peakSpeed = 0;
    this.state.peakAbsSlideAngle = 0;
    this.state.allFinite = true;
    this.state.firstNonFiniteStep = null;
    this.copyPose(spawn);
  }

  record(telemetry: ReplayTelemetry): void {
    this.state.completedSteps++;
    if (
      (telemetry.recoveryCount ?? this.initialRecoveryCount) !==
        this.initialRecoveryCount ||
      !Number.isFinite(telemetry.speed) ||
      !Number.isFinite(telemetry.beta) ||
      !allNumbersFinite(telemetry)
    ) {
      this.state.allFinite = false;
      this.state.firstNonFiniteStep ??= this.state.completedSteps;
    }
    this.copyPose(telemetry);
    if (Number.isFinite(telemetry.speed))
      this.state.peakSpeed = Math.max(
        this.state.peakSpeed,
        Math.abs(telemetry.speed),
      );
    if (Number.isFinite(telemetry.beta))
      this.state.peakAbsSlideAngle = Math.max(
        this.state.peakAbsSlideAngle,
        Math.abs(telemetry.beta),
      );
  }

  get current(): Readonly<ReplayResult> {
    return this.state;
  }

  snapshot(): ReplayResult {
    return {
      ...this.state,
      finalPose: {
        position: { ...this.pose.position },
        rotation: { ...this.pose.rotation },
      },
    };
  }

  private copyPose(pose: ScriptSpawn): void {
    this.pose.position.x = pose.position.x;
    this.pose.position.y = pose.position.y;
    this.pose.position.z = pose.position.z;
    this.pose.rotation.x = pose.rotation.x;
    this.pose.rotation.y = pose.rotation.y;
    this.pose.rotation.z = pose.rotation.z;
    this.pose.rotation.w = pose.rotation.w;
  }
}

export interface ReplayExpectations {
  elapsedSteps?: number;
  finalPose?: {
    pose: ScriptSpawn;
    positionTolerance: number;
    rotationTolerance: number;
  }; // metres/radians
  peakSpeed?: { min: number; max: number };
  peakAbsSlideAngle?: { min: number; max: number }; // radians
}

/** Framework-independent assertions for Vitest, Playwright, or the perf harness. */
export function assertReplay(
  result: ReplayResult,
  expected: ReplayExpectations,
): void {
  if (!result.allFinite || !allNumbersFinite(result))
    throw new Error(
      'Replay contains non-finite values at step ' + result.firstNonFiniteStep,
    );
  if (
    expected.elapsedSteps !== undefined &&
    result.completedSteps !== expected.elapsedSteps
  )
    throw new Error(
      `Expected ${expected.elapsedSteps} completed steps, received ${result.completedSteps}.`,
    );
  for (const key of ['peakSpeed', 'peakAbsSlideAngle'] as const) {
    const range = expected[key];
    if (!range) continue;
    if (
      !Number.isFinite(range.min) ||
      !Number.isFinite(range.max) ||
      range.min < 0 ||
      range.max < range.min
    )
      throw new RangeError('Invalid assertion range for ' + key);
    if (result[key] < range.min || result[key] > range.max)
      throw new Error(
        `${key} ${result[key]} is outside [${range.min}, ${range.max}].`,
      );
  }
  if (expected.finalPose) {
    const { pose, positionTolerance, rotationTolerance } = expected.finalPose;
    if (
      !Number.isFinite(positionTolerance) ||
      positionTolerance < 0 ||
      !Number.isFinite(rotationTolerance) ||
      rotationTolerance < 0 ||
      !allNumbersFinite(pose)
    )
      throw new RangeError('Invalid final-pose assertion.');
    const p = result.finalPose.position,
      q = result.finalPose.rotation;
    const distance = Math.hypot(
      p.x - pose.position.x,
      p.y - pose.position.y,
      p.z - pose.position.z,
    );
    const target = pose.rotation;
    const norm =
      Math.hypot(q.x, q.y, q.z, q.w) *
      Math.hypot(target.x, target.y, target.z, target.w);
    if (!Number.isFinite(norm) || norm === 0)
      throw new Error('Final rotation is not a valid quaternion.');
    const angle =
      2 *
      Math.acos(
        Math.min(
          1,
          Math.abs(
            q.x * target.x + q.y * target.y + q.z * target.z + q.w * target.w,
          ) / norm,
        ),
      );
    if (distance > positionTolerance || angle > rotationTolerance)
      throw new Error(`Final pose differs by ${distance} m and ${angle} rad.`);
  }
}
