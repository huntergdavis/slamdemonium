import { GamepadInput } from './gamepad';
import { KeyboardInput } from './keyboard';
import { LatencyProbeView } from './latencyProbe';
import { InputMapper } from './mapper';
import type { StepInput } from './types';

export interface InputTestFixture {
  sample(): Readonly<StepInput>;
  presented(timestamp: number): void;
  paintProbe(timestamp: number): void;
  dispose(): void;
}

declare global {
  interface Window {
    /** Only installed in builds explicitly enabled with VITE_TEST_API=1. */
    __inputFixture: InputTestFixture;
  }
}

/** Independent mapper keeps game-loop sampling from consuming test action edges. */
export function installInputTestFixture(): InputTestFixture {
  const keyboard = new KeyboardInput(window);
  const noGamepads: (Gamepad | null)[] = [];
  const input = new InputMapper(keyboard, new GamepadInput(() => noGamepads));
  const probeView = new LatencyProbeView(input.latency, document.body);
  const canvas = document.querySelector('canvas');
  if (!canvas) throw new Error('Missing driving surface.');
  canvas.tabIndex = 0;
  const panel = document.createElement('div');
  panel.setAttribute('data-options-panel', '');
  panel.style.cssText =
    'position:fixed;right:0;top:0;background:white;z-index:10;';
  panel.innerHTML =
    '<input id="test-number" type="number" aria-label="Test parameter"><button id="test-a">A</button><button id="test-b">B</button><input id="test-range" type="range" aria-label="Test slider">';
  document.body.append(panel);
  const fixture: InputTestFixture = {
    sample: () => input.sampleForStep(),
    presented: (timestamp) => input.framePresented(timestamp),
    paintProbe: (timestamp) => probeView.render(timestamp),
    dispose: () => {
      keyboard.dispose();
      probeView.dispose();
      panel.remove();
    },
  };
  window.__inputFixture = fixture;
  canvas.focus();
  return fixture;
}
