import { FixedStepLoop } from '../../src/core/loop';
import { GamepadInput } from '../../src/input/gamepad';
import { KeyboardInput } from '../../src/input/keyboard';
import { InputMapper } from '../../src/input/mapper';
import type { ActionCounts } from '../../src/input/types';
import { TuningStore } from '../../src/tuning/store';
import { mountOptionsPanel } from '../../src/ui/optionsPanel';
import { mountPauseMenu } from '../../src/ui/pauseMenu';
import { makePad } from '../input-helpers';

const host = document.querySelector<HTMLElement>('#app')!;
const canvas = document.querySelector<HTMLCanvasElement>('canvas')!;
const store = new TuningStore();
let pad = makePad();
let lastEscape: KeyboardEvent | null = null;
window.addEventListener(
  'keydown',
  (event) => {
    if (event.code === 'Escape') lastEscape = event;
  },
  true,
);
const input = new InputMapper(
  new KeyboardInput(),
  new GamepadInput(() => [pad]),
);
const state = {
  menuPaused: false,
  optionsPaused: false,
  userPaused: false,
  externalPaused: false,
  restarts: 0,
  scriptSamples: 0,
  frames: 0,
};
input.attachScriptProcessor(() => {
  state.scriptSamples++;
});
const paused = () =>
  state.menuPaused ||
  state.optionsPaused ||
  state.userPaused ||
  state.externalPaused;
const syncPause = () => loop.setPaused(paused());
function dispatch(actions: Readonly<ActionCounts>): void {
  if (actions.pauseMenu % 2) menu.toggle();
  if (actions.pause % 2) {
    state.userPaused = !state.userPaused;
    syncPause();
  }
  if (actions.options % 2) options.toggle();
  if (actions.swapAB % 2) options.session.swapSlots();
}
const loop = new FixedStepLoop(
  { physicsHz: 120, timeScale: 1 },
  {
    sampleForStep: () => dispatch(input.sampleForStep().actions),
    preStep() {},
    stepPhysics() {},
    postStep() {},
    render() {},
  },
);
const options = mountOptionsPanel({
  host,
  drivingSurface: canvas,
  store,
  onPauseChange(paused) {
    state.optionsPaused = paused;
    syncPause();
  },
});
const menu = mountPauseMenu({
  host,
  drivingSurface: canvas,
  options,
  readPaused: paused,
  onPauseChange(paused) {
    state.menuPaused = paused;
    syncPause();
  },
  onRespawn() {
    state.restarts++;
  },
  readGamepad: () => input.gamepad.state,
});
let running = true;
function frame(now: number): void {
  if (!running) return;
  state.frames++;
  if (paused()) dispatch(input.sampleActions());
  loop.frame(now);
  options.update(now);
  menu.update(now);
  requestAnimationFrame(frame);
}
document.querySelector('#fullscreen')!.addEventListener('click', () => {
  void document.documentElement.requestFullscreen();
});
document.querySelector('#pointer')!.addEventListener('click', () => {
  void canvas.requestPointerLock();
});
window.__pauseTest = {
  escapePrevented: () => lastEscape?.defaultPrevented,
  menu,
  options,
  store,
  input,
  loop,
  state,
  setPad(buttons, x = 0, y = 0) {
    pad = makePad({ buttons, axis: x, verticalAxis: y });
  },
  setExternalPaused(value) {
    state.externalPaused = value;
    syncPause();
  },
  dispose() {
    running = false;
    menu.dispose();
    options.dispose();
    input.keyboard.dispose();
  },
};
requestAnimationFrame(frame);

declare global {
  interface Window {
    __pauseTest: {
      escapePrevented(): boolean | undefined;
      menu: typeof menu;
      options: typeof options;
      store: typeof store;
      input: typeof input;
      loop: typeof loop;
      state: typeof state;
      setPad(buttons: number[], x?: number, y?: number): void;
      setExternalPaused(value: boolean): void;
      dispose(): void;
    };
  }
}
