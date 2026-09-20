import { DEFAULT_TRACK_CONFIG } from '../world/trackConfig';

interface Point {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}
export interface RingLapOptions {
  physicsHz: number;
  checkpointCount?: number;
  centerLineRadius?: number;
  innerRadius?: number;
  outerRadius?: number;
}
export interface LapProgress {
  readonly completedLaps: number;
  readonly nextCheckpoint: number;
  readonly lastLapSteps: number | null;
  readonly lastLapSeconds: number | null;
  readonly invalidated: boolean;
}

/** Counter-clockwise ring gates, including the start line at (radius, 0, 0). No wall clock. */
export class RingLapTimer {
  private readonly gates: readonly {
    x: number;
    z: number;
    nx: number;
    nz: number;
  }[];
  private readonly inner: number;
  private readonly outer: number;
  private readonly radius: number;
  private readonly hz: number;
  private readonly previous = { x: 0, y: 0, z: 0 };
  private previousStep = 0;
  private started = false;
  private startStep = 0;
  private readonly state = {
    completedLaps: 0,
    nextCheckpoint: 0,
    lastLapSteps: null as number | null,
    lastLapSeconds: null as number | null,
    invalidated: false,
  };

  constructor(options: RingLapOptions) {
    this.hz = options.physicsHz;
    this.radius =
      options.centerLineRadius ?? DEFAULT_TRACK_CONFIG.centerLineRadius;
    this.inner = options.innerRadius ?? DEFAULT_TRACK_CONFIG.ringInnerRadius;
    this.outer = options.outerRadius ?? DEFAULT_TRACK_CONFIG.pavedRadius;
    const count = options.checkpointCount ?? 8;
    if (
      !Number.isFinite(this.hz) ||
      this.hz <= 0 ||
      !Number.isFinite(this.radius) ||
      !Number.isFinite(this.inner) ||
      !Number.isFinite(this.outer) ||
      this.inner <= 0 ||
      this.inner >= this.radius ||
      this.radius >= this.outer ||
      !Number.isInteger(count) ||
      count < 4 ||
      count > 128
    )
      throw new RangeError('Invalid ring lap configuration.');
    this.gates = Array.from({ length: count }, (_, index) => {
      const angle = (index * 2 * Math.PI) / count;
      return {
        x: this.radius * Math.cos(angle),
        z: -this.radius * Math.sin(angle),
        nx: -Math.sin(angle),
        nz: -Math.cos(angle),
      };
    });
  }

  reset(position: Point, completedStep = 0): void {
    this.validate(position, completedStep);
    this.previous.x = position.x;
    this.previous.y = position.y;
    this.previous.z = position.z;
    this.previousStep = completedStep;
    this.state.completedLaps = 0;
    this.state.lastLapSteps = null;
    this.state.lastLapSeconds = null;
    this.state.invalidated = false;
    // A known fresh spawn on the start line begins a standing-start lap at step zero.
    this.started =
      position.x >= this.inner &&
      position.x <= this.outer &&
      Math.abs(position.z) <= 1e-6;
    this.startStep = completedStep;
    this.state.nextCheckpoint = this.started ? 1 : 0;
  }

  update(position: Point, completedStep: number): Readonly<LapProgress> {
    this.validate(position, completedStep);
    if (completedStep !== this.previousStep + 1)
      throw new RangeError(
        'Lap timer requires each consecutive completed physics step.',
      );
    const radius = Math.hypot(position.x, position.z);
    const distance = Math.hypot(
      position.x - this.previous.x,
      position.z - this.previous.z,
    );
    // Leaving the ring or teleporting invalidates the current attempt; reacquire the start line.
    if (
      radius < this.inner ||
      radius > this.outer ||
      distance >
        Math.min(
          this.outer - this.inner,
          (Math.PI * this.radius) / this.gates.length,
        )
    ) {
      this.started = false;
      this.state.nextCheckpoint = 0;
      this.state.invalidated = true;
    } else {
      const gate = this.gates[this.state.nextCheckpoint]!;
      const before =
        (this.previous.x - gate.x) * gate.nx +
        (this.previous.z - gate.z) * gate.nz;
      const after =
        (position.x - gate.x) * gate.nx + (position.z - gate.z) * gate.nz;
      if (before < -1e-9 && after >= -1e-9) {
        const fraction = -before / (after - before);
        const x = this.previous.x + (position.x - this.previous.x) * fraction;
        const z = this.previous.z + (position.z - this.previous.z) * fraction;
        const crossRadius = Math.hypot(x, z);
        if (
          crossRadius >= this.inner &&
          crossRadius <= this.outer &&
          x * gate.x + z * gate.z > 0
        ) {
          if (this.state.nextCheckpoint === 0) {
            if (this.started) {
              this.state.completedLaps++;
              this.state.lastLapSteps = completedStep - this.startStep;
              this.state.lastLapSeconds = this.state.lastLapSteps / this.hz;
            }
            this.started = true;
            this.startStep = completedStep;
            this.state.invalidated = false;
          }
          this.state.nextCheckpoint =
            (this.state.nextCheckpoint + 1) % this.gates.length;
        }
      }
    }
    this.previous.x = position.x;
    this.previous.y = position.y;
    this.previous.z = position.z;
    this.previousStep = completedStep;
    return this.state;
  }

  get progress(): Readonly<LapProgress> {
    return this.state;
  }

  private validate(point: Point, step: number): void {
    if (
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) ||
      !Number.isFinite(point.z) ||
      !Number.isSafeInteger(step) ||
      step < 0
    )
      throw new RangeError(
        'Lap position and completed step must be finite and valid.',
      );
  }
}

export function assertCompletedLap(
  progress: Readonly<LapProgress>,
  maximumSteps?: number,
): void {
  if (
    progress.completedLaps < 1 ||
    progress.lastLapSteps === null ||
    progress.lastLapSeconds === null
  )
    throw new Error('No complete ordered ring lap was recorded.');
  if (
    !Number.isFinite(progress.lastLapSteps) ||
    !Number.isFinite(progress.lastLapSeconds)
  )
    throw new Error('Lap timing is non-finite.');
  if (maximumSteps !== undefined) {
    if (!Number.isSafeInteger(maximumSteps) || maximumSteps < 1)
      throw new RangeError('Maximum lap steps must be a positive integer.');
    if (progress.lastLapSteps > maximumSteps)
      throw new Error('Lap exceeded the step budget.');
  }
}
