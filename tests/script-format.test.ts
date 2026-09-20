import { expect, it, vi } from 'vitest';
import { DEFAULT_VALUES } from '../src/tuning/schema';
import { TuningStore } from '../src/tuning/store';
import { parseInputScript, InputScriptPlayer } from '../src/input/script';
import { scriptFixture, emptySample } from './scriptFixtures';

it('copies and freezes a full step-indexed document so later author edits cannot alter an armed replay', () => {
  const raw = scriptFixture();
  const script = parseInputScript(JSON.stringify(raw));
  raw.tuning.mass = 2000;
  raw.frames[0]!.input.throttle = 0;
  expect(script.tuning.mass).toBe(DEFAULT_VALUES.mass);
  expect(script.frames[0]!.input.throttle).toBe(1);
  expect(Object.isFrozen(script.tuning)).toBe(true);
  expect(Object.isFrozen(script.frames[0]!.input)).toBe(true);
});

it('refuses incomplete, clamped, unknown or non-finite tuning instead of silently changing the drive', () => {
  const script = scriptFixture();
  const missing = { ...script.tuning };
  Reflect.deleteProperty(missing, 'mass');
  for (const tuning of [
    missing,
    { ...script.tuning, mass: NaN },
    { ...script.tuning, mass: 999999 },
    { ...script.tuning, physicsHz: 121 },
    { ...script.tuning, unknown: 1 },
  ]) {
    expect(() => parseInputScript({ ...script, tuning })).toThrow();
  }
  expect(() => parseInputScript({ ...script, version: 2 })).toThrow(/version/);
  expect(() =>
    parseInputScript({
      ...script,
      spawn: { ...script.spawn, rotation: { x: 0, y: 0, z: 0, w: 0 } },
    }),
  ).toThrow(/quaternion/);
});

it('requires complete inputs starting at step zero, ordered uniquely inside the exact duration', () => {
  const script = scriptFixture();
  const first = script.frames[0]!;
  for (const frames of [
    [],
    [{ ...first, step: 1 }],
    [first, first],
    [first, { ...first, step: 4 }],
    [{ ...first, step: -1 }],
    [{ ...first, input: { ...first.input, throttle: 2 } }],
    [{ ...first, input: { ...first.input, boost: undefined } }],
  ]) {
    expect(() => parseInputScript({ ...script, frames })).toThrow();
  }
});

it('requires apply or verify, rejects mismatch before reset, and only reports EOF after final postStep', () => {
  const store = new TuningStore({ mass: 2000 });
  const reset = vi.fn();
  const player = new InputScriptPlayer(store, reset);
  const script = scriptFixture();
  expect(() => player.load(script, undefined as never)).toThrow(/explicit/);
  expect(() => player.load(script, { tuning: 'verify' })).toThrow(/mass/);
  expect(reset).not.toHaveBeenCalled();
  player.load(script, { tuning: 'apply' });
  expect(store.snapshot()).toEqual(script.tuning);
  expect(reset).toHaveBeenCalledWith(script.spawn, script.seed);
  const state = player.progress();
  const sample = emptySample();
  for (let step = 0; step < 4; step++) {
    sample.actions.respawn = 1;
    player.sampleInto(sample);
    expect(player.progress().completedSteps).toBe(step);
    expect(player.progress().done).toBe(false);
    expect(sample.throttle).toBe(step < 2 ? 1 : 0);
    expect(sample.actions.respawn).toBe(0);
    player.afterStep();
    expect(player.progress()).toBe(state);
  }
  expect(state).toEqual({ completedSteps: 4, totalSteps: 4, done: true });
  expect(() => player.sampleInto(sample)).toThrow(/EOF/);
  player.dispose();
});

it('fails on tuning edits during playback and rejects duplicate sampling or completion', () => {
  const store = new TuningStore();
  const player = new InputScriptPlayer(store, () => {});
  player.load(scriptFixture(), { tuning: 'verify' });
  expect(() => player.afterStep()).toThrow(/sampled/);
  player.sampleInto(emptySample());
  expect(() => player.sampleInto(emptySample())).toThrow(/twice/);
  player.afterStep();
  store.set('gravity', 20);
  expect(() => player.progress()).toThrow(/tuning changed/);
  player.cancel();
  expect(player.progress()).toEqual({
    completedSteps: 0,
    totalSteps: 0,
    done: false,
  });
  player.dispose();
});
