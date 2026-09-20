import { describe, expect, it } from 'vitest';
import { KeyboardInput } from '../src/input/keyboard';
import { InputMapper } from '../src/input/mapper';
import { GamepadInput } from '../src/input/gamepad';
import { keyEvent } from './input-helpers';

function setup() {
  const target = new EventTarget();
  const keyboard = new KeyboardInput(target, { visibilityTarget: null });
  const mapper = new InputMapper(keyboard, new GamepadInput(() => []));
  return { target, keyboard, mapper };
}

describe('event-owned keyboard input', () => {
  it('maps driving keys and aliases, using positive-left steering and only Left Shift', () => {
    const { target, keyboard, mapper } = setup();
    keyEvent(target, 'keydown', 'KeyW');
    keyEvent(target, 'keydown', 'ArrowUp');
    keyEvent(target, 'keyup', 'KeyW');
    keyEvent(target, 'keydown', 'KeyA');
    keyEvent(target, 'keydown', 'Space');
    keyEvent(target, 'keydown', 'ShiftRight');
    expect(mapper.sampleForStep()).toMatchObject({
      throttle: 1,
      brake: 0,
      steer: 1,
      handbrake: true,
      boost: false,
    });
    keyEvent(target, 'keydown', 'ShiftLeft');
    keyEvent(target, 'keydown', 'KeyS');
    keyEvent(target, 'keydown', 'KeyD');
    expect(mapper.sampleForStep()).toMatchObject({
      throttle: 1,
      brake: 1,
      steer: 0,
      boost: true,
    });
    keyEvent(target, 'keyup', 'KeyA');
    expect(mapper.sampleForStep().steer).toBe(-1);
    keyboard.dispose();
  });

  it('retains command presses between steps and suppresses repeat events', () => {
    const { target, keyboard, mapper } = setup();
    const commands = {
      KeyR: 'respawn',
      KeyO: 'options',
      KeyH: 'hud',
      KeyG: 'gizmos',
      KeyC: 'camera',
      KeyT: 'slowMotion',
      KeyP: 'pause',
      KeyL: 'latencyProbe',
      Tab: 'swapAB',
      F9: 'recordTelemetry',
    } as const;
    for (const [code, action] of Object.entries(commands)) {
      keyEvent(target, 'keydown', code);
      keyEvent(target, 'keydown', code, { repeat: true });
      keyEvent(target, 'keyup', code);
      expect(mapper.sampleForStep().actions[action]).toBe(1);
      expect(mapper.sampleForStep().actions[action]).toBe(0);
    }
    keyEvent(target, 'keydown', 'KeyR');
    keyEvent(target, 'keyup', 'KeyR');
    keyEvent(target, 'keydown', 'KeyR');
    keyEvent(target, 'keyup', 'KeyR');
    expect(mapper.sampleForStep().actions.respawn).toBe(2);
    keyboard.dispose();
  });

  it('prevents default for game Tab, but preserves Tab inside Options', () => {
    const target = new EventTarget();
    let optionsFocused = false;
    const keyboard = new KeyboardInput(target, {
      isOptionsTarget: () => optionsFocused,
      visibilityTarget: null,
    });
    expect(keyEvent(target, 'keydown', 'Tab').defaultPrevented).toBe(true);
    keyEvent(target, 'keyup', 'Tab');
    optionsFocused = true;
    expect(keyEvent(target, 'keydown', 'Tab').defaultPrevented).toBe(false);
    expect(keyEvent(target, 'keydown', 'Space').defaultPrevented).toBe(false);
    expect(keyboard.state.held.Space).toBe(false);
    expect(keyboard.state.presses.swapAB).toBe(1);
    keyboard.dispose();
  });

  it('clears held keys on editing focus, window blur and hidden-tab events', () => {
    const target = new EventTarget();
    const visibility = new EventTarget();
    Object.defineProperty(visibility, 'hidden', { value: true });
    let editing = false;
    const keyboard = new KeyboardInput(target, {
      isEditingTarget: () => editing,
      visibilityTarget: visibility as Document,
    });
    keyEvent(target, 'keydown', 'KeyW');
    editing = true;
    target.dispatchEvent(new Event('focusin'));
    expect(keyboard.state.held.KeyW).toBe(false);
    expect(keyEvent(target, 'keydown', 'KeyW').defaultPrevented).toBe(false);
    expect(keyboard.state.held.KeyW).toBe(false);
    editing = false;
    keyEvent(target, 'keydown', 'KeyW');
    target.dispatchEvent(new Event('blur'));
    expect(keyboard.state.held.KeyW).toBe(false);
    keyEvent(target, 'keydown', 'KeyW');
    visibility.dispatchEvent(new Event('visibilitychange'));
    expect(keyboard.state.held.KeyW).toBe(false);
    keyboard.dispose();
  });

  it('does not capture browser shortcuts, composition or unbound keys; disposal removes handlers', () => {
    const { target, keyboard } = setup();
    for (const modifier of [
      { ctrlKey: true },
      { metaKey: true },
      { altKey: true },
      { isComposing: true },
    ]) {
      expect(
        keyEvent(target, 'keydown', 'KeyW', modifier).defaultPrevented,
      ).toBe(false);
      expect(keyboard.state.held.KeyW).toBe(false);
    }
    expect(keyEvent(target, 'keydown', 'KeyZ').defaultPrevented).toBe(false);
    keyboard.dispose();
    keyEvent(target, 'keydown', 'KeyW');
    expect(keyboard.state.held.KeyW).toBe(false);
  });

  it('reuses step state and never consumes or mutates the keyboard event state', () => {
    const { target, keyboard, mapper } = setup();
    keyEvent(target, 'keydown', 'KeyR', { timeStamp: 42 });
    const eventState = keyboard.state;
    const first = mapper.sampleForStep();
    const actions = first.actions;
    expect(mapper.sampleForStep()).toBe(first);
    expect(mapper.sampleForStep().actions).toBe(actions);
    expect(keyboard.state).toBe(eventState);
    expect(eventState.presses.respawn).toBe(1);
    expect(eventState.held.KeyR).toBe(true);
    expect(eventState.lastEventTime).toBe(42);
    keyboard.dispose();
  });
});

it('shares command consumption across paused polls and steps without sampling replay or latency', () => {
  const target = new EventTarget();
  const keyboard = new KeyboardInput(target, { visibilityTarget: null });
  let polls = 0;
  const mapper = new InputMapper(
    keyboard,
    new GamepadInput(() => {
      polls++;
      return [];
    }),
  );
  let scriptSamples = 0;
  const detach = mapper.attachScriptProcessor(() => {
    scriptSamples++;
  });
  keyEvent(target, 'keydown', 'KeyP');
  keyEvent(target, 'keyup', 'KeyP');
  expect(mapper.sampleActions().pause).toBe(1);
  expect(mapper.sampleActions().pause).toBe(0);
  expect(scriptSamples).toBe(0);
  const before = polls;
  expect(mapper.sampleForStep().actions.pause).toBe(0);
  expect(polls - before).toBe(1);
  expect(scriptSamples).toBe(1);
  keyEvent(target, 'keydown', 'KeyH');
  keyEvent(target, 'keyup', 'KeyH');
  expect(mapper.sampleForStep().actions.hud).toBe(1);
  expect(mapper.sampleActions().hud).toBe(0);
  expect(scriptSamples).toBe(2);
  detach();
  keyboard.dispose();
});
