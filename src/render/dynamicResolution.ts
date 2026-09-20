/** Wall-time controller. Simulation timeScale must not affect GPU budgeting. */
export class DynamicResolution {
  scale = 1;
  smoothedFrameMs = 0;
  private overloadedSeconds = 0;
  private headroomSeconds = 0;
  private lastMs: number | undefined;

  resetClock(): void {
    this.lastMs = undefined;
    this.overloadedSeconds = 0;
    this.headroomSeconds = 0;
    this.smoothedFrameMs = 0;
  }

  update(nowMs: number): boolean {
    const previousScale = this.scale;
    if (this.lastMs === undefined) {
      this.lastMs = nowMs;
      return false;
    }
    const frameMs = nowMs - this.lastMs;
    this.lastMs = nowMs;
    if (frameMs <= 0 || frameMs > 1000) {
      this.resetClock();
      return false;
    }
    const dt = frameMs / 1000;
    this.smoothedFrameMs =
      this.smoothedFrameMs === 0
        ? frameMs
        : this.smoothedFrameMs +
          (frameMs - this.smoothedFrameMs) * (1 - Math.exp(-dt / 0.5));
    this.overloadedSeconds =
      this.smoothedFrameMs > 18 ? this.overloadedSeconds + dt : 0;
    this.headroomSeconds =
      this.smoothedFrameMs < 17 ? this.headroomSeconds + dt : 0;
    if (this.overloadedSeconds >= 2) {
      this.scale = Math.max(0.6, Math.round((this.scale - 0.1) * 10) / 10);
      this.overloadedSeconds = 0;
    } else if (this.headroomSeconds >= 2) {
      this.scale = Math.min(1, Math.round((this.scale + 0.1) * 10) / 10);
      this.headroomSeconds = 0;
    }
    return this.scale !== previousScale;
  }
}
