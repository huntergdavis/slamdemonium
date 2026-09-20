import type { GameInput } from '../core/gameApi';

export type GamepadPoll = () => ArrayLike<Gamepad | null>;
export interface GamepadState extends GameInput {
  connected: boolean;
  index: number;
  respawnPresses: number;
  pauseMenuPresses: number;
  menuX: number;
  menuY: number;
  confirmPresses: number;
  backPresses: number;
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
    pauseMenuPresses: 0,
    menuX: 0,
    menuY: 0,
    confirmPresses: 0,
    backPresses: 0,
  };
  private respawnHeld = false;
  private pauseMenuHeld = false;

  private confirmHeld = false;
  private backHeld = false;

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
      this.pauseMenuHeld = false;
      this.confirmHeld = false;
      this.backHeld = false;
      this.state.menuX = this.state.menuY = 0;
      return this.state;
    }
    if (pad.index !== this.state.index) {
      this.respawnHeld = false;
      this.pauseMenuHeld = false;
      this.confirmHeld = false;
      this.backHeld = false;
      this.state.menuX = this.state.menuY = 0;
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
    const pauseMenu = pad.buttons[9]?.pressed === true;
    const confirm = pad.buttons[0]?.pressed === true;
    const back = pad.buttons[1]?.pressed === true;
    const horizontal = finiteAxis(pad.axes[0]);
    const vertical = finiteAxis(pad.axes[1]);
    this.state.menuX =
      Number(pad.buttons[15]?.pressed === true || horizontal > 0.55) -
      Number(pad.buttons[14]?.pressed === true || horizontal < -0.55);
    this.state.menuY =
      Number(pad.buttons[13]?.pressed === true || vertical > 0.55) -
      Number(pad.buttons[12]?.pressed === true || vertical < -0.55);
    if (confirm && !this.confirmHeld) this.state.confirmPresses++;
    if (back && !this.backHeld) this.state.backPresses++;
    this.confirmHeld = confirm;
    this.backHeld = back;
    if (respawn && !this.respawnHeld) this.state.respawnPresses++;
    if (pauseMenu && !this.pauseMenuHeld) this.state.pauseMenuPresses++;
    this.respawnHeld = respawn;
    this.pauseMenuHeld = pauseMenu;
    return this.state;
  }
}
