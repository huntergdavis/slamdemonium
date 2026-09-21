import { describe, expect, it, vi } from 'vitest';
import { AudioDirector } from '../src/audio/director';
import { AudioSettings, MASTER_MUTE_KEY } from '../src/audio/settings';
import type {
  AudioMix,
  AudioOutput,
  AudioOutputState,
} from '../src/audio/types';
import { TuningStore } from '../src/tuning/store';

function setup() {
  const tuning = new TuningStore();
  const telemetry = {
    speed: 20,
    throttle: 1,
    boostEnvelope: 0,
    velocity: { x: 0, y: 0, z: -20 },
    wheels: Array.from({ length: 4 }, () => ({
      grounded: false,
      surfaceId: 0 as number | null,
      Fz: 5000,
      vx: 20,
      vy: 0,
      spinning: false,
      locked: false,
    })),
  };
  let paused = false;
  const state: AudioOutputState = {
    status: 'ready',
    activeVoices: 0,
    peakVoices: 0,
    droppedVoices: 0,
    error: null,
  };
  const mixes: AudioMix[] = [];
  const output = {
    state,
    unlock: vi.fn(),
    apply: vi.fn((mix: Readonly<AudioMix>) =>
      mixes.push({ ...mix, tyres: mix.tyres.slice() }),
    ),
    playImpact: vi.fn(() => true),
    playBoostAttack: vi.fn(() => true),
    pause: vi.fn(),
    setMasterMuted: vi.fn(),
    reset: vi.fn(),
    dispose: vi.fn(),
  } satisfies AudioOutput;
  const storage = new Map<string, string>();
  const settings = new AudioSettings({
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => {
      storage.set(key, value);
    },
  });
  const surfaces = [
    { audioProfile: 'asphalt' },
    { audioProfile: 'kerb' },
  ] as const;
  const director = new AudioDirector({
    tuning,
    output,
    settings,
    readTelemetry: () => telemetry,
    readPaused: () => paused,
    resolveGroundedSurface: (grounded, id) =>
      grounded && id !== null ? (surfaces[id] ?? null) : null,
  });
  return {
    director,
    telemetry,
    tuning,
    output,
    mixes,
    settings,
    storage,
    pause: (value: boolean) => {
      paused = value;
    },
  };
}
const normal = { x: 0, y: 0, z: 1 };

describe('audio stays outside simulation', () => {
  it('copies contact/telemetry scalars into fixed queues without calling any sound API from physics', () => {
    const r = setup();
    const borrowed = { ...normal };
    for (let step = 0; step < 300; step++) {
      r.director.afterStep(1 / 120);
      r.director.onImpact(10, 'concrete', null, borrowed, 1300);
    }
    expect(r.output.apply).not.toHaveBeenCalled();
    expect(r.output.playImpact).not.toHaveBeenCalled();
    expect(r.output.playBoostAttack).not.toHaveBeenCalled();
    borrowed.z = -1;
    r.telemetry.velocity.z = 0;
    r.director.update(0);
    expect(r.output.playImpact).toHaveBeenCalled();
    expect(r.output.playImpact.mock.calls[0]).toEqual(['concrete', 0.7, 1]);
    expect(r.output.playImpact.mock.calls.length).toBeLessThan(25); // Per-body 120 ms cooldown.
  });

  it('requires real grounded slip/load/speed and canonical material; airborne handbrake alone stays silent', () => {
    const r = setup();
    const wheel = r.telemetry.wheels[0]!;
    wheel.vy = 15;
    wheel.locked = true;
    wheel.spinning = true;
    r.director.afterStep(1 / 120);
    r.director.update(0);
    expect([...r.mixes.at(-1)!.tyres]).toEqual([0, 0, 0]);
    wheel.grounded = true;
    wheel.surfaceId = null;
    r.director.afterStep(1 / 120);
    r.director.update(16);
    expect([...r.mixes.at(-1)!.tyres]).toEqual([0, 0, 0]);
    expect(r.director.state.unresolvedWheels).toBe(1);
    wheel.surfaceId = 1;
    r.director.afterStep(1 / 120);
    r.director.update(32);
    expect(r.mixes.at(-1)!.tyres[0]).toBe(0);
    expect(r.mixes.at(-1)!.tyres[1]).toBeGreaterThan(0);
    const sounding = r.mixes.at(-1)!.tyres[1]!;
    wheel.grounded = false;
    r.director.afterStep(1 / 120);
    r.director.update(48);
    expect(r.mixes.at(-1)!.tyres[1]).toBeLessThan(sounding); // Smooth release, no step.
    for (let frame = 4; frame < 120; frame++) r.director.update(frame * 16);
    expect(r.mixes.at(-1)!.tyres[1]).toBeLessThan(0.0001);
    wheel.grounded = true;
    wheel.Fz = 0;
    r.director.afterStep(1 / 120);
    r.director.update(2000);
    expect(r.mixes.at(-1)!.tyres[1]).toBeLessThan(0.0001);
  });

  it('fades pause once in 30 ms, drops impacts and boost attacks, and resumes continuous layers without stale events', () => {
    const r = setup();
    r.director.afterStep(1 / 120);
    r.director.update(0);
    r.telemetry.boostEnvelope = 1;
    r.director.afterStep(1 / 120);
    r.director.onImpact(10, 'concrete', null, normal, 1300);
    r.pause(true);
    r.director.update(16);
    r.director.update(300000);
    expect(r.output.pause).toHaveBeenCalledExactlyOnceWith(30);
    r.pause(false);
    r.director.update(300016);
    expect(r.output.playImpact).not.toHaveBeenCalled();
    expect(r.output.playBoostAttack).not.toHaveBeenCalled();
    expect(r.mixes.at(-1)!.boost).toBeGreaterThan(0);
    r.telemetry.boostEnvelope = 0;
    r.director.afterStep(1 / 120);
    r.telemetry.boostEnvelope = 1;
    r.director.afterStep(1 / 120);
    r.director.update(300032);
    expect(r.output.playBoostAttack).toHaveBeenCalledOnce();
  });

  it('bounds queued impacts and skips unresolved surfaces without inventing an asphalt fallback', () => {
    const r = setup();
    for (let body = 0; body < 100; body++)
      r.director.onImpact(body, 'concrete', null, normal, 1300);
    expect(r.director.state.droppedImpacts).toBe(68);
    r.director.onImpact(101, null, null, normal, 1300);
    r.director.update(0);
    expect(r.output.playImpact).toHaveBeenCalledTimes(32);
    r.director.update(16);
    expect(r.output.playImpact).toHaveBeenCalledTimes(32);
  });

  it('smooths square-root slow-motion pitch in wall time, clamps it, and leaves tuning untouched', () => {
    const r = setup();
    r.tuning.set('timeScale', 0.05);
    r.director.update(0);
    expect(r.mixes.at(-1)!.rate).toBeGreaterThan(0.5);
    for (let frame = 1; frame < 100; frame++) r.director.update(frame * 16);
    expect(r.mixes.at(-1)!.rate).toBeCloseTo(0.5, 5);
    r.tuning.set('timeScale', 2);
    for (let frame = 100; frame < 200; frame++) r.director.update(frame * 16);
    expect(r.mixes.at(-1)!.rate).toBeCloseTo(Math.SQRT2, 5);
    expect(r.tuning.get('timeScale')).toBe(2);
  });

  it('keeps master mute outside presets/replay tuning and discards silent or locked transients', () => {
    const r = setup();
    const values = r.tuning.snapshot();
    r.director.toggleMasterMute();
    expect(r.tuning.snapshot()).toEqual(values);
    expect(r.storage.get(MASTER_MUTE_KEY)).toBe('true');
    expect(r.output.setMasterMuted).toHaveBeenLastCalledWith(true);
    for (const mode of ['muted', 'zero', 'locked'] as const) {
      r.director.setMasterMuted(mode === 'muted');
      r.tuning.set('sfxVolume', mode === 'zero' ? 0 : 0.7);
      r.output.state.status = mode === 'locked' ? 'locked' : 'ready';
      r.director.onImpact(1, 'concrete', null, normal, 1300);
      r.director.afterStep(1);
      r.director.update(0);
    }
    r.output.state.status = 'ready';
    r.director.update(16);
    expect(r.output.playImpact).not.toHaveBeenCalled();
    r.director.reset();
    r.director.dispose();
    r.output.apply.mockClear();
    r.director.afterStep(1);
    r.director.update(32);
    expect(r.output.apply).not.toHaveBeenCalled();
  });

  it('storage errors never prevent immediate mute and can recover on a later write', () => {
    const write = vi.fn().mockImplementationOnce(() => {
      throw new Error('quota');
    });
    const settings = new AudioSettings({
      getItem: () => 'false',
      setItem: write,
    });
    settings.setMasterMuted(true);
    expect(settings.masterMuted).toBe(true);
    expect(settings.persistenceAvailable).toBe(false);
    settings.setMasterMuted(false);
    expect(settings.persistenceAvailable).toBe(true);
    expect(settings.masterMuted).toBe(false);
  });
});
