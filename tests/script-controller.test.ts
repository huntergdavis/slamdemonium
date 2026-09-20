import { expect, it, vi } from 'vitest';
import { ScriptController, assertReplay } from '../src/input/script';
import { TuningStore } from '../src/tuning/store';
import { InputMapper } from '../src/input/mapper';
import { KeyboardInput } from '../src/input/keyboard';
import { GamepadInput } from '../src/input/gamepad';
import { FixedStepLoop } from '../src/core/loop';
import { scriptFixture } from './scriptFixtures';
import { keyEvent } from './input-helpers';

function setup() {
  const store = new TuningStore();
  const target = new EventTarget();
  const keyboard = new KeyboardInput(target, { visibilityTarget: null });
  const mapper = new InputMapper(keyboard, new GamepadInput(() => []));
  const telemetry = {
    ...structuredClone(scriptFixture().spawn),
    speed: 0,
    beta: 0,
    wheels: [{ Fz: 1 }],
  };
  const trace: number[][] = [];
  const readTelemetry = vi.fn(() => telemetry);
  const onComplete = vi.fn(() => loop.setPaused(true));
  const onError = vi.fn();
  const scripts = new ScriptController({
    store,
    mapper,
    readTelemetry,
    onComplete,
    onError,
    reset: (spawn) => {
      Object.assign(telemetry.position, spawn.position);
      Object.assign(telemetry.rotation, spawn.rotation);
      telemetry.speed = 0;
      telemetry.beta = 0;
      trace.length = 0;
    },
  });
  const loop = new FixedStepLoop(
    { physicsHz: store.get('physicsHz'), timeScale: 1 },
    {
      sampleForStep: () => {
        mapper.sampleForStep();
      },
      preStep: () => {},
      stepPhysics: (dt) => {
        // Deliberately small deterministic test dynamics; production vehicle coverage is separate.
        const input = mapper.state;
        trace.push([
          input.throttle,
          input.brake,
          input.steer,
          input.actions.respawn,
        ]);
        telemetry.speed += (input.throttle - input.brake) * dt;
        telemetry.position.z -= telemetry.speed * dt;
        telemetry.beta = input.steer;
      },
      postStep: () => scripts.afterStep(),
      render: () => {},
    },
  );
  return {
    store,
    target,
    keyboard,
    mapper,
    telemetry,
    trace,
    readTelemetry,
    onComplete,
    onError,
    scripts,
    loop,
    dispose: () => {
      scripts.dispose();
      keyboard.dispose();
    },
  };
}

it('invalidates both result reads and the next sample immediately when tuning changes', () => {
  for (const mode of ['record', 'play']) {
    const rig = setup();
    if (mode === 'play')
      rig.scripts.load(scriptFixture(), { tuning: 'verify' });
    else {
      rig.scripts.noteRespawn(scriptFixture().spawn, 1);
      rig.scripts.startRecording('Fresh');
    }
    rig.store.set('mass', 2000);
    expect(() => rig.scripts.result()).toThrow(/[Tt]uning changed/);
    expect(() => rig.loop.stepMany(1)).toThrow(/[Tt]uning changed/);
    expect(rig.trace).toHaveLength(0);
    expect(rig.onError).toHaveBeenCalledOnce();
    rig.dispose();
  }
});

it('replays identically through stepMany and variable RAF batches, stopping at the final postStep', () => {
  const direct = setup();
  const raf = setup();
  for (const rig of [direct, raf]) {
    keyEvent(rig.target, 'keydown', 'KeyS');
    keyEvent(rig.target, 'keydown', 'KeyR');
    rig.scripts.load(scriptFixture(), { tuning: 'verify' });
  }
  const stable = direct.mapper.state;
  direct.loop.stepMany(4);
  raf.loop.frame(0);
  raf.loop.frame(5);
  raf.loop.frame(100);
  raf.loop.frame(200);
  expect(raf.loop.totalSteps).toBe(4);
  expect(raf.trace).toEqual(direct.trace);
  expect(raf.scripts.result()).toEqual(direct.scripts.result());
  expect(direct.mapper.state).toBe(stable);
  expect(direct.scripts.progress()).toEqual({
    completedSteps: 4,
    totalSteps: 4,
    done: true,
  });
  expect(direct.readTelemetry).toHaveBeenCalledTimes(5); // reset baseline + four completed steps
  expect(direct.onComplete).toHaveBeenCalledOnce();
  expect(raf.onComplete).toHaveBeenCalledOnce();
  expect(direct.scripts.canStep()).toBe(false);
  expect(() => direct.loop.stepMany(1)).toThrow(/EOF/);
  expect(direct.trace).toHaveLength(4);
  assertReplay(direct.scripts.result(), {
    elapsedSteps: 4,
    peakAbsSlideAngle: { min: 0.25, max: 0.25 },
  });
  direct.dispose();
  raf.dispose();
});

it('records actual mapper samples only after an explicit respawn and replays the same completed steps', () => {
  const rig = setup();
  const spawn = scriptFixture().spawn;
  expect(() => rig.scripts.startRecording('Mid-drive')).toThrow(
    /fresh respawn/,
  );
  rig.scripts.noteRespawn(spawn, 42);
  rig.scripts.startRecording('Keys');
  keyEvent(rig.target, 'keydown', 'KeyW');
  rig.loop.stepMany(2);
  keyEvent(rig.target, 'keydown', 'KeyA');
  rig.loop.stepMany(3);
  keyEvent(rig.target, 'keyup', 'KeyW');
  rig.loop.stepMany(1);
  const recordedTrace = structuredClone(rig.trace);
  const recordedResult = rig.scripts.result();
  const script = rig.scripts.stopRecording();
  expect(script.durationSteps).toBe(6);
  rig.scripts.load(script, { tuning: 'apply' });
  rig.loop.stepMany(6);
  expect(rig.trace).toEqual(recordedTrace);
  expect(rig.scripts.result()).toEqual(recordedResult);
  rig.scripts.cancel();
  rig.scripts.noteRespawn(spawn, 42);
  rig.loop.stepMany(1);
  expect(() => rig.scripts.startRecording('Too late')).toThrow(/mid-drive/);
  rig.dispose();
});

it('rejects non-finite wheel telemetry and preserves final results independently of later captures', () => {
  const rig = setup();
  rig.scripts.load(scriptFixture(), { tuning: 'verify' });
  rig.loop.stepMany(4);
  const completed = rig.scripts.result();
  rig.scripts.load(scriptFixture(), { tuning: 'verify' });
  rig.telemetry.wheels[0]!.Fz = NaN;
  expect(() => rig.loop.stepMany(1)).toThrow(/Non-finite/);
  expect(rig.onError).toHaveBeenCalledOnce();
  expect(() => rig.scripts.canStep()).toThrow(/Non-finite/);
  expect(completed.completedSteps).toBe(4);
  expect(completed.allFinite).toBe(true);
  rig.dispose();
});
