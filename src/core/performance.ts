export interface PerformanceBatch {
  frameMs: number[];
  physicsStepMs: number[];
  engineStepMs: number[];
  droppedSamples: number;
}

/** Fixed storage: drain outside the hot path; overflow invalidates the run. */
export class PerformanceRecorder {
  enabled = false;
  private lastFrameMs: number | undefined;
  private readonly frames: Float64Array;
  private readonly steps: Float64Array;
  private readonly engine: Float64Array;
  private frameCount = 0;
  private stepCount = 0;
  private engineCount = 0;
  private dropped = 0;

  constructor(capacity = 4096) {
    if (!Number.isSafeInteger(capacity) || capacity < 1)
      throw new RangeError('Performance capacity must be a positive integer.');
    this.frames = new Float64Array(capacity);
    this.steps = new Float64Array(capacity);
    this.engine = new Float64Array(capacity);
  }

  start(): void {
    this.frameCount = this.stepCount = this.engineCount = this.dropped = 0;
    this.setPaused(false);
  }

  /** Exclude explicit measurement GC and the frame interval straddling it. */
  setPaused(paused: boolean): void {
    this.enabled = !paused;
    this.lastFrameMs = undefined;
  }

  recordFrame(nowMs: number): void {
    if (!this.enabled) return;
    if (this.lastFrameMs !== undefined) {
      if (this.frameCount < this.frames.length)
        this.frames[this.frameCount++] = nowMs - this.lastFrameMs;
      else this.dropped++;
    }
    this.lastFrameMs = nowMs;
  }

  recordStep(ms: number): void {
    if (!this.enabled) return;
    if (this.stepCount < this.steps.length) this.steps[this.stepCount++] = ms;
    else this.dropped++;
  }

  recordEngineStep(ms: number): void {
    if (!this.enabled) return;
    if (this.engineCount < this.engine.length)
      this.engine[this.engineCount++] = ms;
    else this.dropped++;
  }

  drain(): PerformanceBatch {
    const batch = {
      frameMs: Array.from(this.frames.subarray(0, this.frameCount)),
      physicsStepMs: Array.from(this.steps.subarray(0, this.stepCount)),
      engineStepMs: Array.from(this.engine.subarray(0, this.engineCount)),
      droppedSamples: this.dropped,
    };
    this.frameCount = this.stepCount = this.engineCount = this.dropped = 0;
    return batch;
  }
}
