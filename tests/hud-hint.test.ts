import { describe, expect, it } from 'vitest';
import {
  HUD_HINT_IDLE_MS,
  HUD_HINT_SHOW_MS,
  HudHintState,
  isHudInputActive,
} from '../src/ui/hudHint';

const idle = {
  throttle: 0,
  brake: 0,
  steer: 0,
  handbrake: false,
  boost: false,
};

describe('the press-H reminder', () => {
  it('shows on boot, disappears after five seconds, and stays hidden while the driver is busy', () => {
    const hint = new HudHintState();
    expect(hint.update(0, true)).toBe(true);
    expect(hint.update(HUD_HINT_SHOW_MS - 1, true)).toBe(true);
    expect(hint.update(HUD_HINT_SHOW_MS, true)).toBe(false);
    // Driving: activity every step keeps it away.
    for (let t = HUD_HINT_SHOW_MS; t < 60_000; t += 100) {
      hint.noteActivity(t);
      expect(hint.update(t, true)).toBe(false);
    }
  });

  it('comes back after five seconds of inactivity and stays until touched, then vanishes at once', () => {
    const hint = new HudHintState();
    hint.update(0, true);
    hint.noteActivity(10_000);
    expect(hint.update(10_000, true)).toBe(false);
    expect(hint.update(10_000 + HUD_HINT_IDLE_MS - 1, true)).toBe(false);
    expect(hint.update(10_000 + HUD_HINT_IDLE_MS, true)).toBe(true);
    // Waiting: no show timer on an idle return.
    expect(hint.update(10_000 + HUD_HINT_IDLE_MS + 30_000, true)).toBe(true);
    hint.noteActivity(50_000);
    expect(hint.update(50_000, true)).toBe(false);
    expect(hint.update(50_000 + HUD_HINT_IDLE_MS, true)).toBe(true);
  });

  it('never shows while the HUD is on, and returns to the idle rule when it is turned off again', () => {
    const hint = new HudHintState();
    hint.update(0, true);
    expect(hint.update(1000, false)).toBe(false);
    expect(hint.update(30_000, false)).toBe(false);
    // Turned off again after a long idle: it is waiting.
    expect(hint.update(30_001, true)).toBe(true);
  });

  it('treats a resting or slightly drifting stick as inactivity and any keypress as input', () => {
    expect(isHudInputActive(idle)).toBe(false);
    expect(isHudInputActive({ ...idle, steer: 0.03 })).toBe(false);
    expect(isHudInputActive({ ...idle, throttle: 0.04 })).toBe(false);
    expect(isHudInputActive({ ...idle, steer: -0.2 })).toBe(true);
    expect(isHudInputActive({ ...idle, throttle: 1 })).toBe(true);
    expect(isHudInputActive({ ...idle, brake: 0.5 })).toBe(true);
    expect(isHudInputActive({ ...idle, handbrake: true })).toBe(true);
    expect(isHudInputActive({ ...idle, boost: true })).toBe(true);
    expect(isHudInputActive(idle, 1)).toBe(true);
  });
});
