import type { GameInput } from '../core/gameApi';

export type GamepadPoll = () => ArrayLike<Gamepad | null>;
export interface GamepadState extends GameInput {
  connected: boolean;
  index: number;
  respawnPresses: number;
  optionsPresses: number;
}
const NO_GAMEPADS: readonly (Gamepad | null)[] = [];

function pollBrowserGamepads(): ArrayLike<Gamepad | null> {
  return typeof navigator !== 'undefined' &&
    typeof navigator.getGamepads === 'function'
    ? navigator.getGamepads()
    : NO_GAMEPADS;
}

function finiteAxis(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value)
    ? Math.max(-1, Math.min(1, value))
    : 0;
}

function trigger(button: GamepadButton | undefined): number {
  return button && Number.isFinite(button.value)
    ? Math.max(0, Math.min(1, button.value))
    : 0;
}

/** Standard layout only. Axis/trigger curves and smoothing belong to the vehicle. */
export class GamepadInput {
  readonly state: GamepadState = {
    throttle: 0,
    brake: 0,
    steer: 0,
    handbrake: false,
    boost: false,
    connected: false,
    index: -1,
    respawnPresses: 0,
    optionsPresses: 0,
  };
  private respawnHeld = false;
  private optionsHeld = false;

  constructor(private readonly poll: GamepadPoll = pollBrowserGamepads) {}

  sampleForStep(): Readonly<GamepadState> {
    let pads: ArrayLike<Gamepad | null>;
    try {
      pads = this.poll();
    } catch {
      pads = NO_GAMEPADS;
    }
    let pad: Gamepad | null = null;
    // Keep the selected pad stable if the browser returns a sparse or reordered list.
    for (let index = 0; index < pads.length; index++) {
      const candidate = pads[index];
      if (!candidate?.connected || candidate.mapping !== 'standard') continue;
      if (pad === null || candidate.index === this.state.index) pad = candidate;
      if (candidate.index === this.state.index) break;
    }
    if (!pad) {
      this.state.connected = false;
      this.state.index = -1;
      this.state.throttle = 0;
      this.state.brake = 0;
      this.state.steer = 0;
      this.state.handbrake = false;
      this.state.boost = false;
      this.respawnHeld = false;
      this.optionsHeld = false;
      return this.state;
    }
    if (pad.index !== this.state.index) {
      this.respawnHeld = false;
      this.optionsHeld = false;
    }
    this.state.connected = true;
    this.state.index = pad.index;
    this.state.throttle = trigger(pad.buttons[7]);
    this.state.brake = trigger(pad.buttons[6]);
    const axis = finiteAxis(pad.axes[0]);
    this.state.steer = axis === 0 ? 0 : -axis; // stick left -> positive-left steering
    this.state.handbrake = pad.buttons[0]?.pressed === true;
    this.state.boost = pad.buttons[2]?.pressed === true;
    const respawn = pad.buttons[3]?.pressed === true;
    const options = pad.buttons[9]?.pressed === true;
    if (respawn && !this.respawnHeld) this.state.respawnPresses++;
    if (options && !this.optionsHeld) this.state.optionsPresses++;
    this.respawnHeld = respawn;
    this.optionsHeld = options;
    return this.state;
  }
}
