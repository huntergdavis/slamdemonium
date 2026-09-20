export interface LoopSettings {
  physicsHz: number;
  timeScale: number;
  maxStepsPerFrame?: number;
}

export interface LoopHooks {
  sampleForStep(): void;
  preStep(dt: number): void;
  stepPhysics(dt: number): void;
  postStep(dt: number): void;
  render(alpha: number): void;
}

/** Settings may be updated live; the fixed dt changes only with physicsHz. */
export class FixedStepLoop {
  private lastMs: number | undefined;
  private accumulator = 0;
  private paused = false;
  alpha = 0;
  stepsThisFrame = 0;
  totalSteps = 0;
  droppedSeconds = 0;

  constructor(
    private readonly settings: LoopSettings,
    private readonly hooks: LoopHooks,
  ) {
    this.validate();
  }

  private validate(): void {
    const limit = this.settings.maxStepsPerFrame ?? 8;
    if (
      !Number.isFinite(this.settings.physicsHz) ||
      this.settings.physicsHz <= 0 ||
      !Number.isFinite(this.settings.timeScale) ||
      this.settings.timeScale < 0 ||
      !Number.isInteger(limit) ||
      limit < 1
    ) {
      throw new RangeError('Invalid fixed-step loop settings.');
    }
  }

  private step(dt: number): void {
    this.hooks.sampleForStep();
    this.hooks.preStep(dt);
    this.hooks.stepPhysics(dt);
    this.hooks.postStep(dt);
    this.totalSteps++;
  }

  /** Deterministic test stepping does not consume or invent wall-clock time. */
  stepMany(count: number): void {
    this.validate();
    if (!Number.isSafeInteger(count) || count < 0)
      throw new RangeError('Step count must be a non-negative integer.');
    const dt = 1 / this.settings.physicsHz;
    for (let i = 0; i < count; i++) this.step(dt);
    this.resetClock();
  }

  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    this.resetClock();
  }

  resetClock(): void {
    this.lastMs = undefined;
    this.accumulator = 0;
    this.alpha = 0;
    this.stepsThisFrame = 0;
  }

  frame(nowMs: number): void {
    this.validate();
    if (!Number.isFinite(nowMs))
      throw new RangeError('Frame timestamp must be finite.');
    this.stepsThisFrame = 0;
    if (this.lastMs === undefined || this.paused) {
      this.lastMs = nowMs;
      this.hooks.render(this.alpha);
      return;
    }
    const frameDt = Math.min(Math.max((nowMs - this.lastMs) / 1000, 0), 0.1);
    this.lastMs = nowMs;
    this.accumulator += frameDt * this.settings.timeScale;
    const dt = 1 / this.settings.physicsHz;
    const limit = this.settings.maxStepsPerFrame ?? 8;
    // Tolerance prevents an exact step boundary being lost to floating-point error.
    const epsilon = dt * 1e-10;
    while (this.accumulator + epsilon >= dt && this.stepsThisFrame < limit) {
      this.step(dt);
      this.accumulator = Math.max(0, this.accumulator - dt);
      this.stepsThisFrame++;
    }
    const excessSteps = Math.floor((this.accumulator + epsilon) / dt);
    if (excessSteps > 0) {
      const excess = excessSteps * dt;
      this.droppedSeconds += excess;
      this.accumulator = Math.max(0, this.accumulator - excess);
    }
    this.alpha = Math.min(this.accumulator / dt, 1 - Number.EPSILON);
    this.hooks.render(this.alpha);
  }
}
