import { beforeAll, describe, expect, it, vi } from 'vitest';

type Processor = {
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
};
let Engine: new () => Processor;
const SAMPLE_RATE = 48000;

function render(rpm: number, load: number, seconds: number): Float32Array {
  const engine = new Engine();
  const out = new Float32Array(Math.round(seconds * SAMPLE_RATE));
  const block = new Float32Array(128);
  const params = {
    rpm: new Float32Array([rpm]),
    load: new Float32Array([load]),
  };
  for (let offset = 0; offset < out.length; offset += 128) {
    expect(engine.process([], [[block]], params)).toBe(true);
    out.set(block.subarray(0, Math.min(128, out.length - offset)), offset);
  }
  return out;
}
const rms = (x: Float32Array): number =>
  Math.sqrt(x.reduce((sum, v) => sum + v * v, 0) / x.length);
/** Dominant frequency from the largest autocorrelation lag after zero. */
function periodHz(x: Float32Array): number {
  const start = Math.floor(x.length / 2);
  let best = 0;
  let bestLag = 1;
  for (let lag = 40; lag < 2400; lag++) {
    let sum = 0;
    for (let i = start; i < x.length - lag; i += 4) sum += x[i]! * x[i + lag]!;
    if (sum > best) {
      best = sum;
      bestLag = lag;
    }
  }
  return SAMPLE_RATE / bestLag;
}

beforeAll(async () => {
  vi.stubGlobal('sampleRate', SAMPLE_RATE);
  vi.stubGlobal('AudioWorkletProcessor', class {});
  vi.stubGlobal(
    'registerProcessor',
    (_name: string, ctor: new () => Processor) => {
      Engine = ctor;
    },
  );
  await import('../src/audio/engineProcessor');
});

describe('procedural engine voice', () => {
  it('produces bounded, non-silent output that grows with load', () => {
    const idle = render(900, 0, 1);
    const full = render(5000, 1, 1);
    for (const sample of [...idle.subarray(-4800), ...full.subarray(-4800)]) {
      expect(Number.isFinite(sample)).toBe(true);
      expect(Math.abs(sample)).toBeLessThanOrEqual(0.5);
    }
    expect(rms(idle.subarray(-24000))).toBeGreaterThan(0.02);
    expect(rms(full.subarray(-24000))).toBeGreaterThan(
      rms(idle.subarray(-24000)),
    );
  });
  it('tracks the firing rate of the requested RPM', () => {
    // Four-stroke four: two firings per revolution; the half-order lope may
    // win the autocorrelation, so accept the firing rate or its half.
    for (const rpm of [1200, 3000]) {
      const firing = (rpm / 60) * 2;
      const measured = periodHz(render(rpm, 0.5, 1));
      const nearest = [firing, firing / 2].reduce((a, b) =>
        Math.abs(b - measured) < Math.abs(a - measured) ? b : a,
      );
      expect(Math.abs(measured / nearest - 1)).toBeLessThan(0.06);
    }
  });
  it('has energy above the sub-bass band, unlike the removed sample', () => {
    const x = render(3000, 0.8, 1).subarray(-16384);
    // One-pole high-pass at ~300 Hz, compare energies.
    const k = Math.exp((-2 * Math.PI * 300) / SAMPLE_RATE);
    let lp = 0;
    let high = 0;
    let total = 0;
    for (const v of x) {
      lp = k * lp + (1 - k) * v;
      high += (v - lp) ** 2;
      total += v * v;
    }
    expect(high / total).toBeGreaterThan(0.1);
  });
});
