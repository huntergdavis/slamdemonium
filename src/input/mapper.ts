import { GamepadInput, type GamepadState } from './gamepad';
import { KeyboardInput } from './keyboard';
import { LatencyProbe } from './latencyProbe';
import {
  INPUT_ACTIONS,
  createActionCounts,
  type StepInput,
  type ActionCounts,
} from './types';

/** One mapper per driver. The returned state and nested action object are reused;
 * callers recording a replay must copy outside the physics hot path.
 */
export class InputMapper {
  readonly state: StepInput = {
    throttle: 0,
    brake: 0,
    steer: 0,
    handbrake: false,
    boost: false,
    source: 'keyboard',
    actions: createActionCounts(),
  };
  private readonly previousKeys = createActionCounts();
  private readonly previousPad = createActionCounts();
  private readUiCapture: (() => boolean) | undefined;
  private scriptProcessor: ((sample: StepInput) => void) | undefined;

  constructor(
    readonly keyboard: KeyboardInput,
    readonly gamepad: GamepadInput = new GamepadInput(),
    readonly latency: LatencyProbe = new LatencyProbe(keyboard.state),
  ) {
    this.latency.attachPolledSource(gamepad.state);
  }

  /** One UI coordinator gates pad driving and chords. Keyboard focus guards
   * remain event-owned; scripts still process the real per-step sample. */
  attachUiCapture(read: () => boolean): () => void {
    if (this.readUiCapture)
      throw new Error('An input UI owner is already attached.');
    this.readUiCapture = read;
    return () => {
      if (this.readUiCapture === read) this.readUiCapture = undefined;
    };
  }

  /** One replay/recording controller per mapper; processing still occurs inside sampleForStep. */
  attachScriptProcessor(processor: (sample: StepInput) => void): () => void {
    if (this.scriptProcessor)
      throw new Error('An input script controller is already attached.');
    this.scriptProcessor = processor;
    return () => {
      if (this.scriptProcessor === processor) this.scriptProcessor = undefined;
    };
  }

  sampleForStep(): Readonly<StepInput> {
    const keyboard = this.keyboard.state;
    const keys = keyboard.held;
    const captured = this.readUiCapture?.() ?? false;
    const pad = this.gamepad.sampleForStep(captured); // one browser poll per step
    this.consumeActions(pad);
    const captureDriving = captured || this.state.actions.options > 0;
    const throttle = keys.KeyW || keys.ArrowUp;
    const brake = keys.KeyS || keys.ArrowDown;
    const left = keys.KeyA || keys.ArrowLeft;
    const right = keys.KeyD || keys.ArrowRight;
    const keyboardActive =
      throttle || brake || left || right || keys.Space || keys.ShiftLeft;
    if (keyboardActive || !pad.connected) {
      this.state.source = 'keyboard';
      this.state.throttle = throttle ? 1 : 0;
      this.state.brake = brake ? 1 : 0;
      this.state.steer = (left ? 1 : 0) - (right ? 1 : 0);
      this.state.handbrake = keys.Space;
      this.state.boost = keys.ShiftLeft;
    } else {
      this.state.source = 'gamepad';
      this.state.throttle = captureDriving ? 0 : pad.throttle;
      this.state.brake = captureDriving ? 0 : pad.brake;
      this.state.steer = captureDriving ? 0 : pad.steer;
      this.state.handbrake = !captureDriving && pad.handbrake;
      this.state.boost = !captureDriving && pad.boost;
    }
    this.latency.sampleForStep();
    this.scriptProcessor?.(this.state);
    return this.state;
  }

  /** UI-only polling while physics is paused. Shares edge bookkeeping with steps;
   * does not advance driving samples, latency measurements, or script state. */
  sampleActions(): Readonly<ActionCounts> {
    this.consumeActions(
      this.gamepad.sampleForStep(this.readUiCapture?.() ?? false),
    );
    return this.state.actions;
  }

  private consumeActions(pad: Readonly<GamepadState>): void {
    for (let index = 0; index < INPUT_ACTIONS.length; index++) {
      const action = INPUT_ACTIONS[index];
      if (action === undefined) continue;
      const count = this.keyboard.state.presses[action];
      this.state.actions[action] = count - this.previousKeys[action];
      this.previousKeys[action] = count;
      const padCount = pad.presses[action];
      this.state.actions[action] += padCount - this.previousPad[action];
      this.previousPad[action] = padCount;
    }
  }

  /** Call after drawing the resulting state, using that frame's rAF timestamp. */
  framePresented(timestamp: number): void {
    this.latency.framePresented(timestamp);
  }
}
