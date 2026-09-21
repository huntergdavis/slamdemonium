import type { Page } from '@playwright/test';

declare global {
  interface Window {
    __audioProbe: { rms(): number };
  }
}

/** Test-only destination tap. Real Howler, files, decoders and AudioNodes remain
 * in use; no output/mixer stub can accidentally make a silence test pass. */
export async function installAudioProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const NativeContext = window.AudioContext;
    window.AudioContext = class extends NativeContext {
      private readonly analyser: AnalyserNode;
      constructor(options?: AudioContextOptions) {
        super(options);
        this.analyser = this.createAnalyser();
        this.analyser.fftSize = 256;
        const samples = new Float32Array(this.analyser.fftSize);
        window.__audioProbe = {
          rms: () => {
            this.analyser.getFloatTimeDomainData(samples);
            let sum = 0;
            for (let i = 0; i < samples.length; i++) sum += samples[i]! ** 2;
            return Math.sqrt(sum / samples.length);
          },
        };
      }
      override createGain(): GainNode {
        const gain = super.createGain();
        const connect = gain.connect.bind(gain);
        gain.connect = ((
          target: AudioNode | AudioParam,
          output: number = 0,
          input: number = 0,
        ) => {
          if (target === this.destination) {
            connect(this.analyser);
            return this.analyser.connect(this.destination);
          }
          return target instanceof AudioNode
            ? connect(target, output, input)
            : connect(target, output);
        }) as GainNode['connect'];
        return gain;
      }
    };
  });
}
