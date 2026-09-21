import { describe, expect, it, vi } from 'vitest';
import { GamepadInput, PAD_COMMANDS } from '../src/input/gamepad';
import { KeyboardInput } from '../src/input/keyboard';
import { InputMapper } from '../src/input/mapper';
import { makePad } from './input-helpers';

describe('controller command ownership', () => {
  it.each(PAD_COMMANDS)(
    'fires $action once and retains one shared history across paused and live sampling',
    ({ button, action }) => {
      let pad = makePad();
      const input = new InputMapper(
        new KeyboardInput(null),
        new GamepadInput(() => [pad]),
      );
      input.sampleActions();
      pad = makePad({ buttons: [4] });
      input.sampleActions();
      pad = makePad({ buttons: [4, button] });
      expect(input.sampleActions()[action]).toBe(1);
      expect(input.sampleForStep().actions[action]).toBe(0);
      expect(input.sampleActions()[action]).toBe(0);
      expect(input.state.handbrake).toBe(false);
      expect(input.state.boost).toBe(false);
      expect(input.state.actions.respawn).toBe(0);
      pad = makePad({ buttons: [button] }); // LB released first
      expect(input.sampleForStep()).toMatchObject({
        handbrake: false,
        boost: false,
      });
      expect(input.state.actions.respawn).toBe(0);
      pad = makePad();
      input.sampleActions();
      pad = makePad({ buttons: [button] });
      const sample = input.sampleForStep();
      if (button === 0) expect(sample.handbrake).toBe(true);
      if (button === 2) expect(sample.boost).toBe(true);
      if (button === 3) expect(sample.actions.respawn).toBe(1);
    },
  );

  it('does not turn an already-held driving button into a command when LB is added', () => {
    let pad = makePad({ buttons: [0] });
    const input = new GamepadInput(() => [pad]);
    expect(input.sampleForStep().handbrake).toBe(true);
    pad = makePad({ buttons: [0, 4] });
    expect(input.sampleForStep()).toMatchObject({
      handbrake: false,
      presses: { recordTelemetry: 0 },
    });
    pad = makePad({ buttons: [0] });
    expect(input.sampleForStep().handbrake).toBe(false);
    pad = makePad();
    input.sampleForStep();
    pad = makePad({ buttons: [4, 0] });
    expect(input.sampleForStep().presses.recordTelemetry).toBe(1);
  });

  it('keeps B as Back and makes View a direct Options action without a Y or driving leak', () => {
    let pad = makePad({ buttons: [4, 1] });
    const input = new InputMapper(
      new KeyboardInput(null),
      new GamepadInput(() => [pad]),
    );
    expect(input.sampleActions().pause).toBe(0);
    expect(input.gamepad.state.backPresses).toBe(1);
    pad = makePad({ buttons: [8, 3, 0, 2], throttle: 1, axis: 1 });
    expect(input.sampleForStep()).toMatchObject({
      throttle: 0,
      steer: 0,
      handbrake: false,
      boost: false,
      actions: { options: 1, respawn: 0 },
    });
  });

  it('captures pad controls in Options while still publishing UI edges and sampling scripts once per real step', () => {
    let pad = makePad();
    let captured = true;
    const input = new InputMapper(
      new KeyboardInput(null),
      new GamepadInput(() => [pad]),
    );
    input.attachUiCapture(() => captured);
    const script = vi.fn();
    input.attachScriptProcessor(script);
    input.sampleActions();
    pad = makePad({
      buttons: [0, 2, 3, 4, 5, 12],
      throttle: 1,
      brake: 1,
      axis: -1,
    });
    const sample = input.sampleForStep();
    expect(sample).toMatchObject({
      throttle: 0,
      brake: 0,
      steer: 0,
      handbrake: false,
      boost: false,
    });
    expect(Object.values(sample.actions).every((value) => value === 0)).toBe(
      true,
    );
    expect(input.gamepad.state).toMatchObject({
      confirmPresses: 1,
      resetPresses: 1,
      searchPresses: 1,
      coarse: true,
      previousSectionPresses: 1,
      nextSectionPresses: 1,
    });
    input.sampleActions();
    expect(script).toHaveBeenCalledTimes(1);
    captured = false;
    pad = makePad({ buttons: [0, 2, 3] });
    expect(input.sampleForStep()).toMatchObject({
      handbrake: false,
      boost: false,
      actions: { respawn: 0 },
    });
  });

  it('clears disconnected input and requires fresh command presses when a controller reconnects', () => {
    let pad: Gamepad | null = makePad();
    const input = new GamepadInput(() => [pad]);
    input.sampleForStep();
    pad = null;
    expect(input.sampleForStep()).toMatchObject({
      actuator: null,
      lastActivityTime: -Infinity,
      connected: false,
      throttle: 0,
    });
    pad = makePad({ buttons: [3, 9, 8] });
    expect(input.sampleForStep().presses).toMatchObject({
      respawn: 0,
      pauseMenu: 0,
      options: 0,
    });
    pad = makePad();
    input.sampleForStep();
    pad = makePad({ buttons: [9] });
    expect(input.sampleForStep().presses.pauseMenu).toBe(1);
  });

  it('ignores stick noise for prompt activity and gives the pad latency command a polled-to-render sample', () => {
    let pad = makePad({ axis: 0.03 });
    const input = new InputMapper(
      new KeyboardInput(null),
      new GamepadInput(
        () => [pad],
        () => 100,
      ),
    );
    input.sampleActions();
    expect(input.gamepad.state.activitySequence).toBe(0);
    pad = makePad({ buttons: [4, 3] });
    input.sampleActions();
    input.framePresented(110);
    expect(input.latency.stats.count).toBe(0);
    input.sampleForStep();
    input.framePresented(116);
    expect(input.latency.stats).toMatchObject({ count: 1, lastMs: 16 });
  });
});
