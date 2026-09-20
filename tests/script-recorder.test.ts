import { expect, it } from 'vitest';
import {
  InputScriptRecorder,
  InputScriptPlayer,
  exportInputScript,
  parseInputScript,
  parseScriptInput,
} from '../src/input/script';
import { TuningStore } from '../src/tuning/store';
import { scriptFixture, emptySample } from './scriptFixtures';

it('refuses initial or mid-drive recording and consumes fresh-respawn eligibility on every completed step', () => {
  const store = new TuningStore();
  const recorder = new InputScriptRecorder(store, 10);
  expect(() => recorder.start('No reset')).toThrow(/fresh respawn/);
  recorder.noteRespawn(scriptFixture().spawn, 7);
  recorder.recordStep(emptySample());
  expect(() => recorder.start('Mid-drive')).toThrow(/mid-drive/);
  recorder.noteRespawn(scriptFixture().spawn, 7);
  store.set('mass', 2000);
  expect(() => recorder.start('Changed after reset')).toThrow(/fresh respawn/);
  recorder.noteRespawn(scriptFixture().spawn, 7);
  recorder.start('Fresh');
  expect(() => recorder.stop()).toThrow(/No completed/);
  recorder.recordStep(emptySample());
  expect(recorder.stop().durationSteps).toBe(1);
  expect(() => recorder.start('No new reset')).toThrow(/fresh respawn/);
  recorder.dispose();
});

it('round-trips all sampled values, source changes and flags while compressing unchanged steps', () => {
  const store = new TuningStore();
  const recorder = new InputScriptRecorder(store, 10);
  recorder.noteRespawn(scriptFixture().spawn, 123);
  recorder.start('Gamepad and keyboard');
  const sample = emptySample();
  const recorded = [];
  for (let step = 0; step < 5; step++) {
    if (step === 2)
      Object.assign(sample, {
        throttle: 0.123456789,
        steer: -0.8,
        brake: 0.4,
        handbrake: true,
        boost: true,
        source: 'gamepad',
      });
    if (step === 4) sample.source = 'keyboard';
    recorder.recordStep(sample);
    recorded.push(parseScriptInput(sample));
  }
  const exported = recorder.stop();
  expect(exported.frames.map((frame) => frame.step)).toEqual([0, 2, 4]);
  expect(exported.seed).toBe(123);
  const json = exportInputScript(exported);
  expect(parseInputScript(json)).toEqual(exported);
  const player = new InputScriptPlayer(store, () => {});
  player.load(json, { tuning: 'verify' });
  for (const expected of recorded) {
    player.sampleInto(sample);
    expect(sample).toMatchObject(expected);
    player.afterStep();
  }
  recorder.noteRespawn(scriptFixture().spawn, 1);
  recorder.start('Another recording');
  recorder.recordStep(emptySample());
  recorder.stop();
  expect(exportInputScript(exported)).toBe(json);
  player.dispose();
  recorder.dispose();
});

it('does not export a partial recording after tuning edits, respawn or exhausted capacity', () => {
  for (const cause of ['tuning', 'respawn', 'capacity'] as const) {
    const store = new TuningStore();
    const recorder = new InputScriptRecorder(store, 1);
    recorder.noteRespawn(scriptFixture().spawn, 1);
    recorder.start(cause);
    recorder.recordStep(emptySample());
    if (cause === 'tuning') store.set('mass', 2000);
    if (cause === 'respawn')
      expect(() => recorder.noteRespawn(scriptFixture().spawn, 1)).toThrow(
        /interrupted/,
      );
    if (cause === 'capacity')
      expect(() => recorder.recordStep(emptySample())).toThrow(/capacity/);
    expect(() => recorder.stop()).toThrow();
    recorder.cancel();
    recorder.noteRespawn(scriptFixture().spawn, 1);
    recorder.start('Recovered');
    recorder.recordStep(emptySample());
    expect(recorder.stop().durationSteps).toBe(1);
    recorder.dispose();
  }
});
