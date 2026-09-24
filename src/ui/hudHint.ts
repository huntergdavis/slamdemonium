/** The "press H for HUD" reminder's timing, as pure state so it is testable
 * without a DOM. The CTO's spec: the game boots with the HUD off and the
 * hint showing; it disappears after five seconds; it comes back after five
 * seconds of user inactivity and vanishes the moment he touches anything.
 * Clean screen while driving, reminder waiting whenever he stops. */
export const HUD_HINT_SHOW_MS = 5000;
export const HUD_HINT_IDLE_MS = 5000;
/** Below this a resting stick or pedal is inactivity, not input: a slightly
 * drifting controller must not keep the hint away forever. */
export const HUD_HINT_INPUT_THRESHOLD = 0.05;

export interface HudHintInput {
  readonly throttle: number;
  readonly brake: number;
  readonly steer: number;
  readonly handbrake: boolean;
  readonly boost: boolean;
}

export function isHudInputActive(
  input: Readonly<HudHintInput>,
  actionCount = 0,
): boolean {
  return (
    actionCount > 0 ||
    input.handbrake ||
    input.boost ||
    Math.abs(input.throttle) >= HUD_HINT_INPUT_THRESHOLD ||
    Math.abs(input.brake) >= HUD_HINT_INPUT_THRESHOLD ||
    Math.abs(input.steer) >= HUD_HINT_INPUT_THRESHOLD
  );
}

export class HudHintState {
  private shownAt = NaN;
  private lastActivity = NaN;
  private visible = false;
  private started = false;

  /** Call with the wall clock whenever the driver does something. */
  noteActivity(nowMs: number): void {
    this.lastActivity = nowMs;
    this.visible = false;
  }

  /** Call once per frame with the wall clock; returns whether the hint shows. */
  update(nowMs: number, hudOff: boolean): boolean {
    if (!Number.isFinite(nowMs)) return this.visible;
    if (!this.started) {
      this.started = true;
      this.lastActivity = nowMs;
      this.show(nowMs);
    }
    if (!hudOff) {
      this.visible = false;
      return false;
    }
    if (this.visible) {
      if (nowMs - this.shownAt >= HUD_HINT_SHOW_MS) this.visible = false;
      return this.visible;
    }
    // Hidden: come back once the driver has been idle long enough, and stay
    // (the show timer only applies to the boot reminder and each return).
    if (nowMs - this.lastActivity >= HUD_HINT_IDLE_MS) this.show(nowMs);
    return this.visible;
  }

  private show(nowMs: number): void {
    this.visible = true;
    this.shownAt = Infinity; // Idle returns stay until touched.
    if (!this.hasReturned) {
      this.shownAt = nowMs; // The boot reminder times out on its own.
      this.hasReturned = true;
    }
  }
  private hasReturned = false;
}
