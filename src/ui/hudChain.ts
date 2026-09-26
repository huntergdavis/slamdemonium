import type { CrashScoreState } from '../core/crashScore';

/** The transient chain readout's timing, as pure state so it is testable
 * without a DOM. The CTO's spec: the score appears only when it is
 * happening. It fades in on the first smash, stays while the chain is
 * alive, and fades out a few seconds after the chain dies, so the screen is
 * clean while cruising and the multiplier is in his eye line exactly when
 * "I am on 3x and it is about to lapse" is the question. */
export const HUD_CHAIN_LINGER_MS = 3000;

export function isChainAlive(score: Readonly<CrashScoreState>): boolean {
  return score.chainCount > 0 && score.chainRemainingSeconds > 0;
}

export class HudChainState {
  private visible = false;
  private diedAt = NaN;

  /** Call once per HUD read with the wall clock; returns whether the
   * readout shows. A respawn ends the chain the same way a lapse does. */
  update(nowMs: number, score: Readonly<CrashScoreState>): boolean {
    if (!Number.isFinite(nowMs)) return this.visible;
    if (isChainAlive(score)) {
      this.visible = true;
      this.diedAt = NaN;
      return true;
    }
    if (!this.visible) return false;
    if (Number.isNaN(this.diedAt)) this.diedAt = nowMs;
    if (nowMs - this.diedAt >= HUD_CHAIN_LINGER_MS) {
      this.visible = false;
      this.diedAt = NaN;
    }
    return this.visible;
  }
}
