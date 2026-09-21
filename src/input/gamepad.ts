import type { GameInput } from '../core/gameApi';
import { PROBE_QUEUE_CAPACITY } from './keyboard';
import {
  createActionCounts,
  type ActionCounts,
  type InputAction,
} from './types';

export type GamepadPoll = () => ArrayLike<Gamepad | null>;
export interface GamepadState extends GameInput {
  /** Monotonic command counts, consumed by the mapper's shared step/UI history. */
  presses: ActionCounts;
  modifier: boolean;
  coarse: boolean;
  resetPresses: number;
  searchPresses: number;
  previousSectionPresses: number;
  nextSectionPresses: number;
  activitySequence: number;
  lastActivityTime: number;
  connectionSequence: number;
  actuator: GamepadHapticActuator | null;
  probeTimes: Float64Array;
  probeSequence: number;
  connected: boolean;
  index: number;
  respawnPresses: number;
  pauseMenuPresses: number;
  menuX: number;
  menuY: number;
  confirmPresses: number;
  backPresses: number;
}
/** LB is a discoverable command layer; B remains Back in every UI. */
export const PAD_COMMANDS: readonly {
  button: number;
  action: InputAction;
  label: string;
  glyph: string;
}[] = [
  { button: 12, action: 'hud', label: 'HUD', glyph: '↑' },
  { button: 15, action: 'camera', label: 'Camera', glyph: '→' },
  { button: 13, action: 'slowMotion', label: 'Slow motion', glyph: '↓' },
  { button: 14, action: 'swapAB', label: 'A/B tune', glyph: '←' },
  { button: 0, action: 'recordTelemetry', label: 'Telemetry CSV', glyph: 'A' },
  { button: 2, action: 'gizmos', label: 'Gizmos', glyph: 'X' },
  { button: 3, action: 'latencyProbe', label: 'Latency probe', glyph: 'Y' },
  { button: 5, action: 'muteAudio', label: 'Mute', glyph: 'RB' },
];
const FACE_DRIVING = (1 << 0) | (1 << 2) | (1 << 3);
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

function axisActivity(value: number, previous: number): boolean {
  return Math.abs(value) > 0.15 && Math.abs(value - previous) > 0.08;
}

/** Standard layout only. Axis/trigger curves and smoothing belong to the vehicle. */
export class GamepadInput {
  readonly state: GamepadState = {
    throttle: 0,
    brake: 0,
    steer: 0,
    handbrake: false,
    boost: false,
    presses: createActionCounts(),
    modifier: false,
    coarse: false,
    resetPresses: 0,
    searchPresses: 0,
    previousSectionPresses: 0,
    nextSectionPresses: 0,
    activitySequence: 0,
    lastActivityTime: -Infinity,
    connectionSequence: 0,
    actuator: null,
    probeTimes: new Float64Array(PROBE_QUEUE_CAPACITY),
    probeSequence: 0,
    connected: false,
    index: -1,
    respawnPresses: 0,
    pauseMenuPresses: 0,
    menuX: 0,
    menuY: 0,
    confirmPresses: 0,
    backPresses: 0,
  };
  private previousButtons = 0;
  private blockedButtons = 0;
  private previousAxisX = 0;
  private previousAxisY = 0;
  private previousThrottle = 0;
  private previousBrake = 0;
  private everConnected = false;
  private padId = '';

  constructor(
    private readonly poll: GamepadPoll = pollBrowserGamepads,
    private readonly now: () => number = () => performance.now(),
  ) {}

  /** One browser poll. UI mode still publishes navigation, but consumes gameplay
   * button edges so leaving a menu cannot replay them later. */
  sampleForStep(uiCaptured = false): Readonly<GamepadState> {
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
    const state = this.state;
    if (!pad) {
      state.connected = false;
      state.index = -1;
      state.actuator = null;
      state.lastActivityTime = -Infinity;
      state.throttle = state.brake = state.steer = 0;
      state.handbrake = state.boost = state.modifier = state.coarse = false;
      state.menuX = state.menuY = 0;
      this.previousButtons = this.blockedButtons = 0;
      this.previousAxisX = this.previousAxisY = 0;
      this.previousThrottle = this.previousBrake = 0;
      return state;
    }
    let held = 0;
    for (let index = 0; index < 17; index++)
      if (
        pad.buttons[index]?.pressed ||
        ((index === 6 || index === 7) && trigger(pad.buttons[index]) > 0.55)
      )
        held |= 1 << index;
    const changedPad = pad.index !== state.index || pad.id !== this.padId;
    if (changedPad) {
      state.connectionSequence++;
      // First poll retains the original input contract. Reconnection/switching
      // requires releasing held command buttons, avoiding a surprise respawn.
      this.previousButtons = this.everConnected ? held : 0;
      this.blockedButtons = this.everConnected ? held & FACE_DRIVING : 0;
      this.everConnected = true;
      this.padId = pad.id;
    }
    const pressed = held & ~this.previousButtons;
    const modifier = (held & (1 << 4)) !== 0;
    this.blockedButtons &= held;
    if (modifier || uiCaptured) this.blockedButtons |= held & FACE_DRIVING;
    const transition = (pressed & (1 << 8)) !== 0;
    if (transition) this.blockedButtons |= held & FACE_DRIVING;
    state.connected = true;
    state.index = pad.index;
    state.actuator = pad.vibrationActuator ?? null;
    state.modifier = modifier;
    state.coarse = !modifier && (held & (1 << 5)) !== 0;
    state.throttle = trigger(pad.buttons[7]);
    state.brake = trigger(pad.buttons[6]);
    const horizontal = finiteAxis(pad.axes[0]);
    const vertical = finiteAxis(pad.axes[1]);
    state.steer = horizontal === 0 ? 0 : -horizontal;
    state.handbrake = (held & (1 << 0) & ~this.blockedButtons) !== 0;
    state.boost = (held & (1 << 2) & ~this.blockedButtons) !== 0;
    state.menuX =
      Number((held & (1 << 15)) !== 0 || horizontal > 0.55) -
      Number((held & (1 << 14)) !== 0 || horizontal < -0.55);
    state.menuY =
      Number((held & (1 << 13)) !== 0 || vertical > 0.55) -
      Number((held & (1 << 12)) !== 0 || vertical < -0.55);
    if (pressed & (1 << 0)) state.confirmPresses++;
    if (pressed & (1 << 1)) state.backPresses++;
    if (pressed & (1 << 2)) state.resetPresses++;
    if (pressed & (1 << 3)) state.searchPresses++;
    if (pressed & (1 << 6)) state.previousSectionPresses++;
    if (pressed & (1 << 7)) state.nextSectionPresses++;
    if (pressed & (1 << 9)) state.presses.pauseMenu++;
    if (pressed & (1 << 8)) state.presses.options++;
    // Room mute is global, including menus. Fresh RB edges only: holding RB
    // then pressing LB cannot toggle, and releasing LB never replays the edge.
    if (modifier && pressed & (1 << 5)) state.presses.muteAudio++;
    if (!uiCaptured && !transition) {
      if (modifier) {
        for (const command of PAD_COMMANDS) {
          if (
            command.action === 'muteAudio' ||
            !(pressed & (1 << command.button))
          )
            continue;
          state.presses[command.action]++;
          if (command.action === 'latencyProbe') {
            state.probeTimes[state.probeSequence % PROBE_QUEUE_CAPACITY] =
              this.now();
            state.probeSequence++;
          }
        }
      } else if (pressed & (1 << 3) & ~this.blockedButtons)
        state.presses.respawn++;
    }
    // Compatibility aliases for existing independent observers.
    state.respawnPresses = state.presses.respawn;
    state.pauseMenuPresses = state.presses.pauseMenu;
    if (
      pressed ||
      axisActivity(horizontal, this.previousAxisX) ||
      axisActivity(vertical, this.previousAxisY) ||
      axisActivity(state.throttle, this.previousThrottle) ||
      axisActivity(state.brake, this.previousBrake)
    ) {
      state.activitySequence++;
      state.lastActivityTime = this.now();
    }
    this.previousButtons = held;
    this.previousAxisX = horizontal;
    this.previousAxisY = vertical;
    this.previousThrottle = state.throttle;
    this.previousBrake = state.brake;
    return state;
  }
}
