import type { ImpactSeverity } from './impactSeverity';

/** Borrowed, read-only score state for the HUD and future run loop. */
export interface CrashScoreState {
  readonly total: number;
  readonly chainCount: number;
  readonly multiplier: number;
  readonly chainRemainingSeconds: number;
  readonly lastAward: number;
  readonly awardAgeSeconds: number;
  readonly awardSerial: number;
}

export const CRASH_CHAIN_WINDOW_SECONDS = 2;
export const CRASH_MAX_MULTIPLIER = 4;

/**
 * Free-drive destruction score. The impact estimator remains the only source
 * of hit severity; this model only converts its canonical scalar into points.
 */
export class CrashScore {
  private readonly values = {
    total: 0,
    chainCount: 0,
    multiplier: 1,
    chainRemainingSeconds: 0,
    lastAward: 0,
    awardAgeSeconds: Infinity,
    awardSerial: 0,
  };
  readonly state: CrashScoreState = this.values;

  recordBreak(impact: Readonly<ImpactSeverity>): void {
    this.recordBreakSeverity(impact.severity);
  }

  /** Uses the severity scalar copied by the deferred break queue. */
  recordBreakSeverity(rawSeverity: number): void {
    const severity = Number.isFinite(rawSeverity)
      ? Math.max(0, Math.min(1, rawSeverity))
      : 0;
    const continuing = this.values.chainRemainingSeconds > 0;
    const chainCount = continuing ? this.values.chainCount + 1 : 1;
    const multiplier = Math.min(
      CRASH_MAX_MULTIPLIER,
      continuing ? chainCount : 1,
    );
    const award = Math.round((100 + 400 * severity) * multiplier);
    this.values.total += award;
    this.values.chainCount = chainCount;
    this.values.multiplier = multiplier;
    this.values.chainRemainingSeconds = CRASH_CHAIN_WINDOW_SECONDS;
    this.values.lastAward = award;
    this.values.awardAgeSeconds = 0;
    this.values.awardSerial++;
  }

  update(dtSeconds: number): void {
    const dt = Number.isFinite(dtSeconds) ? Math.max(0, dtSeconds) : 0;
    this.values.awardAgeSeconds += dt;
    if (this.values.chainRemainingSeconds > 0) {
      this.values.chainRemainingSeconds = Math.max(
        0,
        this.values.chainRemainingSeconds - dt,
      );
      if (this.values.chainRemainingSeconds === 0) {
        this.values.chainCount = 0;
        this.values.multiplier = 1;
      }
    }
  }

  /** Respawn ends the current chain but preserves the free-drive total. */
  resetChain(): void {
    this.values.chainCount = 0;
    this.values.multiplier = 1;
    this.values.chainRemainingSeconds = 0;
  }

  /** Explicit session/run reset; the future run loop will call this. */
  reset(): void {
    this.values.total = 0;
    this.values.chainCount = 0;
    this.values.multiplier = 1;
    this.values.chainRemainingSeconds = 0;
    this.values.lastAward = 0;
    this.values.awardAgeSeconds = Infinity;
    this.values.awardSerial = 0;
  }
}
