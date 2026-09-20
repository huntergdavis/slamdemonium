import type { ParamSet } from '../tuning/schema';
import type { TuningChange, TuningStore } from '../tuning/store';
import type { HudRenderTelemetry, HudTelemetry } from './hudTelemetry';

export const CSV_COLUMNS = [
  'time_s',
  'sample',
  'dt_s',
  'speed_m_s',
  'speed_km_h',
  'v_long_m_s',
  'v_lat_m_s',
  'beta_rad',
  'yaw_rate_rad_s',
  'longitudinal_accel_m_s2',
  'lateral_accel_m_s2',
  'steer_angle_rad',
  'throttle',
  'brake',
  'handbrake',
  'boost_meter',
  'drift_meter',
  'grounded_wheels',
  'physics_step_ms',
  'steps_per_frame',
  'physics_hz',
  'time_scale',
  'brake01',
  'handbrake01',
  'boost_envelope',
  'camera_fov_deg',
  'camera_fov_requested_deg',
  'camera_fov_capped',
  'render_scale',
  ...['FL', 'FR', 'RL', 'RR'].flatMap((wheel) => [
    wheel + '_Fz_N',
    wheel + '_alpha_rad',
    wheel + '_grip_usage',
    wheel + '_spinning',
    wheel + '_locked',
    wheel + '_grounded',
  ]),
] as const;

export type RecordingStopReason =
  'manual' | 'capacity' | 'physics-rate-changed' | 'step-rate-mismatch';
export interface RecordingExport {
  blob: Blob;
  filename: string;
  reason: RecordingStopReason;
  samples: number;
  elapsedSeconds: number;
}
export interface RecorderOptions {
  /** Simulated seconds. Allocated at start using the then-current physicsHz. */
  durationSeconds?: number;
}

/** Numeric writes only in sample(). Serialization is deferred until takeExport(). */
export class TelemetryRecorder {
  recording = false;
  sampleCount = 0;
  elapsedSeconds = 0;
  capacity = 0;
  stopReason: RecordingStopReason | null = null;
  private buffer: Float64Array | null = null;
  private pending = false;
  private physicsHz = 0;
  private parameters: ParamSet | null = null;
  private changes: TuningChange[] = [];
  private startedAt = '';
  private readonly unsubscribe: () => void;
  private readonly duration: number;

  constructor(
    private readonly store: TuningStore,
    options: RecorderOptions = {},
  ) {
    this.duration = options.durationSeconds ?? 600;
    if (!Number.isFinite(this.duration) || this.duration <= 0)
      throw new RangeError(
        'Recording duration must be a finite positive number.',
      );
    this.unsubscribe = store.onChange((change) => {
      if (!this.recording) return;
      // Tuning events are outside sampling; preserve live changes in the header.
      this.changes.push({ ...change });
      if (change.key === 'physicsHz') this.stop('physics-rate-changed');
    });
  }

  start(): void {
    if (this.recording || this.pending) return;
    const physicsHz = this.store.get('physicsHz');
    const capacity = Math.max(1, Math.ceil(this.duration * physicsHz));
    // Commit the new state only after allocation succeeds.
    const buffer = new Float64Array(capacity * CSV_COLUMNS.length);
    this.physicsHz = physicsHz;
    this.capacity = capacity;
    this.buffer = buffer;
    this.parameters = this.store.snapshot();
    this.changes = [];
    this.startedAt = new Date().toISOString();
    this.sampleCount = 0;
    this.elapsedSeconds = 0;
    this.stopReason = null;
    this.recording = true;
  }

  stop(reason: RecordingStopReason = 'manual'): void {
    if (!this.recording) return;
    this.recording = false;
    this.stopReason = reason;
    this.pending = true;
  }

  sample(
    telemetry: HudTelemetry,
    dt: number,
    render?: HudRenderTelemetry,
  ): void {
    if (!this.recording || !this.buffer) return;
    if (!Number.isFinite(dt) || Math.abs(dt - 1 / this.physicsHz) > 1e-9) {
      this.stop('step-rate-mismatch');
      return;
    }
    this.elapsedSeconds += dt;
    let p = this.sampleCount * CSV_COLUMNS.length;
    const b = this.buffer;
    b[p++] = this.elapsedSeconds;
    b[p++] = this.sampleCount;
    b[p++] = dt;
    b[p++] = telemetry.speed;
    b[p++] = telemetry.speedKmh;
    b[p++] = telemetry.vLong;
    b[p++] = telemetry.vLat;
    b[p++] = telemetry.beta;
    b[p++] = telemetry.yawRate;
    b[p++] = telemetry.longitudinalAcceleration;
    b[p++] = telemetry.lateralAcceleration;
    b[p++] = telemetry.steerAngle;
    b[p++] = telemetry.throttle;
    b[p++] = telemetry.brake;
    b[p++] = +telemetry.handbrake;
    b[p++] = telemetry.boostMeter;
    b[p++] = telemetry.driftMeter;
    b[p++] = telemetry.groundedWheels;
    b[p++] = telemetry.physicsStepMs;
    b[p++] = telemetry.stepsPerFrame;
    b[p++] = this.physicsHz;
    b[p++] = this.store.get('timeScale');
    b[p++] = telemetry.brake01;
    b[p++] = telemetry.handbrake01;
    b[p++] = telemetry.boostEnvelope;
    b[p++] = render?.cameraFov ?? NaN;
    b[p++] = render?.cameraFovRequested ?? NaN;
    b[p++] = render ? +render.cameraFovCapped : NaN;
    b[p++] = render?.renderScale ?? NaN;
    for (let i = 0; i < 4; i++) {
      const wheel = telemetry.wheels[i];
      b[p++] = wheel?.Fz ?? NaN;
      b[p++] = wheel?.alpha ?? NaN;
      b[p++] = wheel?.gripUsage ?? NaN;
      b[p++] = wheel ? +wheel.spinning : NaN;
      b[p++] = wheel ? +wheel.locked : NaN;
      b[p++] = wheel ? +wheel.grounded : NaN;
    }
    this.sampleCount++;
    if (this.sampleCount === this.capacity) this.stop('capacity');
  }

  /** Call from the UI/command owner after a stop, never inside a physics step. */
  takeExport(): RecordingExport | null {
    if (!this.pending || !this.buffer || !this.stopReason) return null;
    const header = {
      version: 1,
      stepsPerFrameSemantics:
        'Total physics steps in the last completed rendered frame; stable during the current frame catch-up loop.',
      startedAt: this.startedAt,
      parameters: this.parameters,
      physicsHz: this.physicsHz,
      sampleCount: this.sampleCount,
      elapsedSeconds: this.elapsedSeconds,
      capacitySamples: this.capacity,
      stopReason: this.stopReason,
      parameterChanges: this.changes,
      missingValues:
        'Empty numeric cells mean unavailable or nonfinite telemetry.',
    };
    const parts: string[] = [
      '# ' + JSON.stringify(header) + '\n',
      CSV_COLUMNS.join(',') + '\n',
    ];
    // Batch at export only, avoiding a second recording-sized numeric buffer.
    let chunk = '';
    for (let row = 0; row < this.sampleCount; row++) {
      for (let column = 0; column < CSV_COLUMNS.length; column++) {
        if (column) chunk += ',';
        const value = this.buffer[row * CSV_COLUMNS.length + column]!;
        if (Number.isFinite(value)) chunk += String(value);
      }
      chunk += '\n';
      if (row % 1024 === 1023) {
        parts.push(chunk);
        chunk = '';
      }
    }
    if (chunk) parts.push(chunk);
    const result: RecordingExport = {
      blob: new Blob(parts, { type: 'text/csv;charset=utf-8' }),
      filename:
        'slamdemonium-telemetry-' +
        this.startedAt.replace(/[:.]/g, '-') +
        '.csv',
      reason: this.stopReason,
      samples: this.sampleCount,
      elapsedSeconds: this.elapsedSeconds,
    };
    this.pending = false;
    this.buffer = null;
    this.changes = [];
    this.parameters = null;
    return result;
  }

  dispose(): void {
    this.unsubscribe();
    this.recording = false;
    this.pending = false;
    this.buffer = null;
    this.parameters = null;
    this.changes = [];
  }
}
