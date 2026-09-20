import { KeyboardInput } from '../../src/input/keyboard';
import { InputMapper } from '../../src/input/mapper';
import { TuningStore } from '../../src/tuning/store';
import { mountOptionsPanel } from '../../src/ui/optionsPanel';
import type { TirePlotTelemetry } from '../../src/ui/tireCurvePlot';
import '../../src/style.css';

// Compiled by the browser spec as a standalone consumer of the public WP7 factory.
// This entry is never imported by main or included in the shipped application.
const host = document.querySelector<HTMLElement>('#app')!;
const drivingSurface = document.querySelector<HTMLCanvasElement>('canvas')!;
const store = new TuningStore();
const input = new InputMapper(new KeyboardInput());
const state = {
  telemetryReads: 0,
  rebuilds: 0,
  paused: false,
  telemetry: undefined as TirePlotTelemetry | undefined,
};
const panel = mountOptionsPanel({
  host,
  drivingSurface,
  store,
  applyMassProperties: () => {
    state.rebuilds++;
  },
  readTelemetry: () => {
    state.telemetryReads++;
    return state.telemetry;
  },
  onPauseChange: (paused) => {
    state.paused = paused;
  },
});
let automaticUpdates = true;
function frame(now: number): void {
  const sampled = input.sampleForStep();
  if (sampled.actions.options % 2) panel.toggle();
  if (sampled.actions.swapAB % 2) panel.session.swapSlots();
  if (automaticUpdates) panel.update(now);
  requestAnimationFrame(frame);
}
window.__optionsTest = {
  store,
  panel,
  input,
  state,
  setAutomaticUpdates: (enabled) => {
    automaticUpdates = enabled;
  },
};
requestAnimationFrame(frame);

declare global {
  interface Window {
    __optionsTest: {
      store: TuningStore;
      panel: ReturnType<typeof mountOptionsPanel>;
      input: InputMapper;
      state: typeof state;
      setAutomaticUpdates(enabled: boolean): void;
    };
  }
}
