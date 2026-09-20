import { describe, expect, it, vi } from 'vitest';
import { GamepadInput } from '../src/input/gamepad';
import { KeyboardInput } from '../src/input/keyboard';
import { InputMapper } from '../src/input/mapper';
import { keyEvent, makePad } from './input-helpers';

describe('standard gamepad mapping', () => {
  it('preserves analog triggers and raw stick values, with positive-left steering', () => {
    const poll = vi.fn(() => [
      null,
      makePad({
        axis: -0.4,
        throttle: 0.73,
        brake: 0.21,
        buttons: [0, 2, 3, 9],
      }),
    ]);
    const gamepad = new GamepadInput(poll);
    expect(gamepad.sampleForStep()).toMatchObject({
      throttle: 0.73,
      brake: 0.21,
      steer: 0.4,
      handbrake: true,
      boost: true,
      respawnPresses: 1,
      pauseMenuPresses: 1,
    });
    gamepad.sampleForStep();
    expect(gamepad.state.respawnPresses).toBe(1);
    expect(gamepad.state.pauseMenuPresses).toBe(1);
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it('clears disconnected controllers and clamps or rejects invalid analog values', () => {
    let pad: Gamepad | null = makePad({ axis: 5, throttle: 3, brake: NaN });
    const gamepad = new GamepadInput(() => [pad]);
    expect(gamepad.sampleForStep()).toMatchObject({
      steer: -1,
      throttle: 1,
      brake: 0,
    });
    pad = makePad({ axis: Infinity, connected: false });
    expect(gamepad.sampleForStep()).toMatchObject({
      connected: false,
      throttle: 0,
      steer: 0,
    });
    pad = null;
    expect(gamepad.sampleForStep().index).toBe(-1);
    pad = makePad({ axis: NaN, mapping: '' });
    expect(gamepad.sampleForStep().connected).toBe(false);
    pad = makePad({ axis: NaN });
    expect(gamepad.sampleForStep().steer).toBe(0);
  });

  it('keeps the selected controller stable and safely handles blocked Gamepad access', () => {
    const first = makePad({ index: 2, throttle: 0.4 });
    const second = makePad({ index: 3, throttle: 0.8 });
    let pads = [first, second];
    const gamepad = new GamepadInput(() => pads);
    expect(gamepad.sampleForStep().index).toBe(2);
    pads = [second, first];
    expect(gamepad.sampleForStep().index).toBe(2);
    pads = [second];
    expect(gamepad.sampleForStep().index).toBe(3);
    expect(
      new GamepadInput(() => {
        throw new Error('Permissions Policy');
      }).sampleForStep().connected,
    ).toBe(false);
  });

  it('polls exactly once per step, prioritizes held keyboard driving keys, and merges command edges', () => {
    const target = new EventTarget();
    const keyboard = new KeyboardInput(target, { visibilityTarget: null });
    const poll = vi.fn(() => [makePad({ throttle: 0.8, buttons: [3, 9] })]);
    const mapper = new InputMapper(keyboard, new GamepadInput(poll));
    const state = mapper.sampleForStep();
    expect(state.source).toBe('gamepad');
    expect(state.throttle).toBe(0.8);
    expect(state.actions.respawn).toBe(1);
    expect(state.actions.pauseMenu).toBe(1);
    keyEvent(target, 'keydown', 'KeyA');
    keyEvent(target, 'keydown', 'KeyR');
    expect(mapper.sampleForStep()).toBe(state);
    expect(state).toMatchObject({ source: 'keyboard', steer: 1, throttle: 0 });
    expect(state.actions.respawn).toBe(1);
    expect(state.actions.options).toBe(0);
    keyEvent(target, 'keyup', 'KeyA');
    expect(mapper.sampleForStep().source).toBe('gamepad');
    expect(poll).toHaveBeenCalledTimes(3);
    keyboard.dispose();
  });
});

it('exposes menu directions and edge counts without a second browser poll', () => {
  let pad = makePad({ buttons: [0, 1, 9, 12], axis: 0.6 });
  const poll = vi.fn(() => [pad]);
  const input = new GamepadInput(poll);
  const state = input.sampleForStep();
  expect(state).toMatchObject({
    menuX: 1,
    menuY: -1,
    confirmPresses: 1,
    backPresses: 1,
    pauseMenuPresses: 1,
  });
  expect(input.sampleForStep()).toBe(state);
  expect(state.confirmPresses).toBe(1);
  pad = makePad({ verticalAxis: 0.8, axis: 0.2 });
  input.sampleForStep();
  expect(state).toMatchObject({ menuX: 0, menuY: 1 });
  pad = makePad({ buttons: [0, 1, 9] });
  input.sampleForStep();
  expect(state).toMatchObject({
    confirmPresses: 2,
    backPresses: 2,
    pauseMenuPresses: 2,
  });
  pad = makePad({ connected: false });
  input.sampleForStep();
  expect(state).toMatchObject({ connected: false, menuX: 0, menuY: 0 });
  expect(poll).toHaveBeenCalledTimes(5);
});
