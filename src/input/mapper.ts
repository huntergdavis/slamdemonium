import { GamepadInput } from './gamepad';
import { KeyboardInput } from './keyboard';
import { LatencyProbe } from './latencyProbe';
import { INPUT_ACTIONS, createActionCounts, type StepInput } from './types';

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
  private previousPadRespawn = 0;
  private previousPadOptions = 0;
  private scriptProcessor: ((sample: StepInput) => void) | undefined;

  constructor(
    readonly keyboard: KeyboardInput,
    readonly gamepad: GamepadInput = new GamepadInput(),
    readonly latency: LatencyProbe = new LatencyProbe(keyboard.state),
  ) {}

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
    const pad = this.gamepad.sampleForStep(); // exactly one browser poll per physics step
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
      this.state.throttle = pad.throttle;
      this.state.brake = pad.brake;
      this.state.steer = pad.steer;
      this.state.handbrake = pad.handbrake;
      this.state.boost = pad.boost;
    }
    for (let index = 0; index < INPUT_ACTIONS.length; index++) {
      const action = INPUT_ACTIONS[index];
      if (action === undefined) continue;
      const count = keyboard.presses[action];
      this.state.actions[action] = count - this.previousKeys[action];
      this.previousKeys[action] = count;
    }
    this.state.actions.respawn += pad.respawnPresses - this.previousPadRespawn;
    this.state.actions.options += pad.optionsPresses - this.previousPadOptions;
    this.previousPadRespawn = pad.respawnPresses;
    this.previousPadOptions = pad.optionsPresses;
    this.latency.sampleForStep();
    this.scriptProcessor?.(this.state);
    return this.state;
  }

  /** Call after drawing the resulting state, using that frame's rAF timestamp. */
  framePresented(timestamp: number): void {
    this.latency.framePresented(timestamp);
  }
}
