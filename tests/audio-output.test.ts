import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HowlOptions } from 'howler';
const harness = vi.hoisted(() => ({
  sounds: [] as {
    options: HowlOptions;
    live: Set<number>;
    fades: number[][];
    loads: number;
  }[],
  next: 1000,
  running: false,
  muted: false,
}));
vi.mock('howler', () => ({
  Howler: {
    usingWebAudio: true,
    mute: (value: boolean) => {
      harness.muted = value;
    },
    ctx: {
      get state() {
        return harness.running ? 'running' : 'suspended';
      },
      resume: async () => {
        harness.running = true;
      },
      addEventListener() {},
      removeEventListener() {},
    },
  },
  Howl: class {
    live = new Set<number>();
    fades: number[][] = [];
    loads = 0;
    constructor(readonly options: HowlOptions) {
      harness.sounds.push(this);
    }
    play() {
      const id = harness.next++;
      this.live.add(id);
      return id;
    }
    load() {
      this.loads++;
      this.options.onload?.(0);
      return this;
    }
    volume() {
      return this;
    }
    rate() {
      return this;
    }
    stereo() {
      return this;
    }
    fade(from: number, to: number, ms: number, id: number) {
      this.fades.push([from, to, ms, id]);
      return this;
    }
    stop(id: number) {
      this.live.delete(id);
      return this;
    }
    unload() {
      this.live.clear();
    }
  },
}));
import { HowlerOutput } from '../src/audio/howlerOutput';
import { DEFAULT_ENGINE } from '../src/vehicle/engineProfile';
import type { AudioMix } from '../src/audio/types';
const mix: AudioMix = {
  engineIdle: 0.2,
  engineLoad: 0.3,
  engineRpm: 3000,
  engineLevel: 1,
  engineCharacter: 1,
  exhaustSeconds: 0.009,
  exhaustFeedback: 0.72,
  firingUnevenness: 1,
  firingRateScale: 1,
  wind: 0,
  tyres: new Float64Array([0.2, 0, 0]),
  boost: 0,
  rate: 1,
  volume: 0.7,
};
async function ready() {
  harness.sounds.length = 0;
  harness.running = false;
  harness.muted = false;
  const output = new HowlerOutput(DEFAULT_ENGINE);
  for (const sound of harness.sounds)
    if (sound.options.preload !== false) sound.options.onload?.(0);
  output.unlock();
  await Promise.resolve();
  output.apply(mix);
  return output;
}
afterEach(() => vi.useRealTimers());

describe('bounded Web Audio output', () => {
  it('drops decorative near-miss cues before taking crash voice slots', async () => {
    const output = await ready();
    for (let index = 0; index < 7; index++)
      expect(output.playImpact('asphalt', 0.3, 1)).toBe(true);
    expect(output.state.activeVoices).toBe(11);
    expect(output.playNearMiss(0.25, 1, -0.8)).toBe(true);
    expect(output.playNearMiss(0.25, 1, 0.8)).toBe(false);
    expect(
      output.playCrash({
        tier: 'medium',
        kind: 'contact',
        gain: 0.5,
        rate: 1,
        pan: 0,
        glass: false,
        debris: false,
      }),
    ).toBe(true);
    expect(output.state.activeVoices).toBe(14); // Mock omits the worklet voice.
    output.dispose();
  });
  it('does not play before gesture even when browser autoplay policy permits it', () => {
    harness.sounds.length = 0;
    harness.running = true;
    const output = new HowlerOutput(DEFAULT_ENGINE);
    for (const sound of harness.sounds) sound.options.onload?.(0);
    output.apply(mix);
    expect(output.state.status).toBe('locked');
    expect(harness.sounds.every((sound) => sound.live.size === 0)).toBe(true);
    output.dispose();
  });
  it('caps overlapping continuous, impact and boost voices at the fifteen-voice limit and recycles completed slots', async () => {
    const output = await ready();
    // The mocked context has no AudioWorklet, so the engine voice is absent.
    expect(output.state.activeVoices).toBe(4);
    for (let index = 0; index < 100; index++) {
      if (index % 2) output.playBoostAttack(0.5, 1);
      else output.playImpact('concrete', 0.7, 1);
    }
    expect(output.state).toMatchObject({
      activeVoices: 14,
      peakVoices: 14,
      droppedVoices: 90,
    });
    expect(
      harness.sounds.reduce((sum, sound) => sum + sound.live.size, 0),
    ).toBe(14);
    const sound = harness.sounds[6]!;
    const id = [...sound.live][0]!;
    sound.live.delete(id);
    sound.options.onend?.(id);
    expect(output.playImpact('kerb', 0.4, 1)).toBe(true);
    expect(output.state.activeVoices).toBe(14);
    output.dispose();
    expect(harness.sounds.every((item) => item.live.size === 0)).toBe(true);
  });
  it('schedules thirty-millisecond fades and never revives old events on a rapid resume', async () => {
    vi.useFakeTimers();
    const output = await ready();
    output.playImpact('concrete', 0.7, 1);
    output.pause(30);
    expect(
      harness.sounds
        .flatMap((sound) => sound.fades)
        .every((fade) => fade[1] === 0 && fade[2] === 30),
    ).toBe(true);
    expect(output.playBoostAttack(0.5, 1)).toBe(false);
    output.apply(mix); // Resume before the old fade completion callback.
    expect(output.state.activeVoices).toBe(4);
    expect(output.playBoostAttack(0.5, 1)).toBe(true);
    vi.advanceTimersByTime(50);
    expect(output.state.activeVoices).toBe(5); // Old pause cannot kill the new attack.
    output.apply({ ...mix, volume: 0 });
    expect(output.state.activeVoices).toBe(4);
    output.setMasterMuted(true);
    expect(harness.muted).toBe(true);
    expect(output.playImpact('asphalt', 1, 1)).toBe(false);
    output.dispose();
  });
  it('loads hard alternatives only after a hard hit and counts two grind loops in the same voice ceiling', async () => {
    const output = await ready();
    const lazy = harness.sounds.filter(
      (sound) => sound.options.preload === false,
    );
    expect(lazy).toHaveLength(2);
    expect(lazy.map((sound) => sound.loads)).toEqual([0, 0]);
    output.setGrind(0, 0.3, 1, -0.6);
    output.setGrind(1, 0.2, 1.1, 0.6);
    expect(output.state.activeVoices).toBe(6);
    const cue = {
      tier: 'hard',
      kind: 'contact',
      gain: 0.6,
      rate: 1,
      pan: 0,
      glass: true,
      debris: true,
    } as const;
    output.playCrash(cue);
    expect(lazy.map((sound) => sound.loads)).toEqual([1, 1]);
    for (let i = 0; i < 20; i++) output.playCrash(cue);
    expect(output.state.activeVoices).toBeLessThanOrEqual(15);
    expect(output.state.droppedVoices).toBeGreaterThan(0);
    output.pause(30);
    output.apply(mix);
    expect(output.state.activeVoices).toBe(4);
    output.dispose();
  });
});
