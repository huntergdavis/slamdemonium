import type { VehicleTelemetry, WheelState } from '../vehicle/telemetry';

/** Borrowed records, never retained as historical samples. Angles are radians. */
export type HudTelemetry = Readonly<
  Pick<
    VehicleTelemetry,
    | 'speed'
    | 'position'
    | 'rotation'
    | 'speedKmh'
    | 'vLong'
    | 'vLat'
    | 'beta'
    | 'yawRate'
    | 'longitudinalAcceleration'
    | 'lateralAcceleration'
    | 'steerAngle'
    | 'throttle'
    | 'brake'
    | 'handbrake'
    | 'brake01'
    | 'handbrake01'
    | 'boostMeter'
    | 'driftMeter'
    | 'boostEnvelope'
    | 'charging'
    | 'groundedWheels'
    | 'physicsStepMs'
    | 'stepsPerFrame'
    | 'rpm'
    | 'gear'
    | 'gearCount'
    | 'idleRpm'
    | 'redlineRpm'
    | 'upshiftCount'
    | 'downshiftCount'
  >
> & {
  readonly wheels: readonly Readonly<
    Pick<
      WheelState,
      'Fz' | 'alpha' | 'gripUsage' | 'grounded' | 'spinning' | 'locked'
    >
  >[];
};

/** Boot updates one record in place from CameraRig.telemetry and view.resolution. */
export interface HudRenderTelemetry {
  readonly cameraFov: number;
  readonly cameraFovRequested: number;
  readonly cameraFovCapped: boolean;
  readonly renderScale: number;
  readonly smoothedFrameMs: number;
}

export const RAD_TO_DEG = 180 / Math.PI;
export const EARTH_GRAVITY = 9.81;
export const HUD_INTERVAL_MS = 1000 / 30;

/** Signed mean of loaded, grounded wheels; NaN means no axle observation. */
export function axleSlip(telemetry: HudTelemetry, first: number): number {
  let sum = 0;
  let count = 0;
  for (let i = first; i < first + 2; i++) {
    const wheel = telemetry.wheels[i];
    if (wheel?.grounded && wheel.Fz > 0 && Number.isFinite(wheel.alpha)) {
      sum += wheel.alpha;
      count++;
    }
  }
  return count ? (sum / count) * RAD_TO_DEG : NaN;
}

/** Fixed 10-second history at <=30 Hz, including both window endpoints. */
export class HudHistory {
  readonly capacity = 301;
  readonly stride = 8;
  readonly times = new Float64Array(this.capacity);
  // speed, beta degrees, yaw degrees/s, lateral Earth G, front/rear slip degrees,
  // longitudinal and lateral m/s2 for the G-G scatter.
  readonly values = new Float64Array(this.capacity * this.stride);
  count = 0;
  next = 0;

  push(seconds: number, telemetry: HudTelemetry): void {
    this.times[this.next] = seconds;
    const offset = this.next * this.stride;
    this.values[offset] = telemetry.speed;
    this.values[offset + 1] = telemetry.beta * RAD_TO_DEG;
    this.values[offset + 2] = telemetry.yawRate * RAD_TO_DEG;
    this.values[offset + 3] = telemetry.lateralAcceleration / EARTH_GRAVITY;
    this.values[offset + 4] = axleSlip(telemetry, 0);
    this.values[offset + 5] = axleSlip(telemetry, 2);
    this.values[offset + 6] = telemetry.longitudinalAcceleration;
    this.values[offset + 7] = telemetry.lateralAcceleration;
    this.next = (this.next + 1) % this.capacity;
    this.count = Math.min(this.count + 1, this.capacity);
  }

  index(oldestOffset: number): number {
    return (
      (this.next - this.count + oldestOffset + this.capacity) % this.capacity
    );
  }
}
