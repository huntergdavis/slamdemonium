import { describe, expect, it, vi } from 'vitest';
import { CrashEvents } from '../src/audio/crashEvents';
import type { AudioOutput, CrashCue } from '../src/audio/types';

function rig() {
  const output = {
    state: {
      status: 'ready' as const,
      activeVoices: 0,
      peakVoices: 0,
      droppedVoices: 0,
      error: null,
    },
    unlock: vi.fn(),
    apply: vi.fn(),
    playImpact: vi.fn(() => true),
    playBoostAttack: vi.fn(() => true),
    playNearMiss: vi.fn(() => true),
    playCrash: vi.fn<(cue: Readonly<CrashCue>) => boolean>(() => true),
    setGrind:
      vi.fn<(slot: 0 | 1, gain: number, rate: number, pan: number) => void>(),
    pause: vi.fn(),
    setMasterMuted: vi.fn(),
    reset: vi.fn(),
    dispose: vi.fn(),
  } satisfies AudioOutput;
  const crash = new CrashEvents();
  const flush = (dt = 1 / 60, audible = true) =>
    crash.flush(output, 0.7, 1, dt, 0, 0, 1, 0, audible);
  return { crash, output, flush };
}

describe('crash audio events', () => {
  it('does no sound work inside contact callbacks and classifies normal closing speed', () => {
    const { crash, output, flush } = rig();
    crash.noteContact(1, 2, 2, 0, 0, 0, 0, true);
    crash.noteContact(1, 3, 6, 0, 0, 0, 0, true);
    crash.noteContact(1, 4, 15, 0, 0, 0, 0, true);
    expect(output.playCrash).not.toHaveBeenCalled();
    crash.afterStep(1 / 120);
    flush();
    expect(output.playCrash.mock.calls.map(([cue]) => cue.tier)).toEqual([
      'light',
      'medium',
      'hard',
    ]);
    expect(output.playCrash.mock.calls.map(([cue]) => cue.glass)).toEqual([
      false,
      false,
      true,
    ]);
    flush();
    expect(output.playCrash).toHaveBeenCalledTimes(3);
  });

  it('holds a scrape for 80 ms, then releases it after contact ends', () => {
    const { crash, output, flush } = rig();
    for (let step = 0; step < 15; step++) {
      crash.noteContact(1, 2, 0, 8, 0, 0, 1, false);
      crash.afterStep(1 / 120);
      flush(1 / 120);
    }
    expect(output.playCrash).not.toHaveBeenCalled();
    expect(output.setGrind.mock.calls.some(([, gain]) => gain > 0)).toBe(true);
    for (let step = 0; step < 70; step++) {
      crash.afterStep(1 / 120);
      flush(1 / 120);
    }
    expect(output.setGrind.mock.lastCall?.[1]).toBe(0);
  });

  it('attenuates and pans distant AI crashes without crediting a takedown', () => {
    const { crash, output, flush } = rig();
    crash.noteContact(10, 11, 12, 0, 35, 0, 2, false);
    crash.afterStep(1 / 120);
    flush();
    const cue = output.playCrash.mock.lastCall?.[0];
    expect(cue).toMatchObject({
      kind: 'distant',
      tier: 'hard',
      pan: 1,
      glass: false,
    });
    expect(cue?.gain).toBeLessThan(0.2);
    expect(crash.duck(1 / 60)).toBe(1);
  });

  it('ducks only for credited takedowns and player wrecks, and discards muted cues', () => {
    const { crash, output, flush } = rig();
    crash.noteTakedown();
    expect(crash.duck(1 / 60)).toBeLessThan(1);
    flush();
    expect(output.playCrash.mock.lastCall?.[0].kind).toBe('takedown');
    crash.notePlayerWreck();
    flush();
    expect(output.playCrash.mock.lastCall?.[0].kind).toBe('wreck');
    crash.noteContact(1, 5, 20, 0, 0, 0, 0, true);
    flush(1 / 60, false);
    expect(output.playCrash).toHaveBeenCalledTimes(2);
    flush();
    expect(output.playCrash).toHaveBeenCalledTimes(2);
  });
});
