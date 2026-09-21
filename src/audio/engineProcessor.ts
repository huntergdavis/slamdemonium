/** AudioWorklet processor: a procedural four-cylinder engine voice. Runs on the
 * audio rendering thread; `process` allocates nothing. RPM stays synthetic and
 * arrives as a k-rate parameter, so there is no loop and no loop seam. */
declare const sampleRate: number;
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  abstract process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}
declare function registerProcessor(
  name: string,
  processor: new () => AudioWorkletProcessor,
): void;

const ENGINE_PROCESSOR = 'slamdemonium-engine';
/** Firing events per crank revolution for a four-stroke four. */
const FIRINGS_PER_REV = 2;
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Two voices, blended by `character`: 0 is an even small four-cylinder,
 * 1 is a muscle voice with uneven crossplane-style firing gaps, much deeper
 * per-cycle amplitude modulation, longer pulses and a lower, more resonant
 * exhaust. Uneven strengths and gaps give the half-order lope that reads as
 * throat; a slower pulse train gives each chug weight. */
const STRENGTH_EVEN = new Float32Array([1, 0.78, 0.92, 0.7]);
const STRENGTH_MUSCLE = new Float32Array([1, 0.45, 0.85, 0.35]);
const GAP_EVEN = new Float32Array([1, 1, 1, 1]);
const GAP_MUSCLE = new Float32Array([1.3, 0.7, 1.15, 0.85]);

/** Constant-skirt band-pass biquad; `tune` recomputes coefficients (per block
 * at most, only when the voice character moves). */
class Resonator {
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  private b0 = 0;
  private a1 = 0;
  private a2 = 0;
  tune(hz: number, q: number): void {
    const w = (2 * Math.PI * hz) / sampleRate;
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    this.b0 = alpha / a0;
    this.a1 = (-2 * Math.cos(w)) / a0;
    this.a2 = (1 - alpha) / a0;
  }
  run(x: number): number {
    const y = this.b0 * (x - this.x2) - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

class EngineProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: 'rpm',
        defaultValue: 900,
        minValue: 200,
        maxValue: 12000,
        automationRate: 'k-rate',
      },
      {
        name: 'load',
        defaultValue: 0,
        minValue: 0,
        maxValue: 1,
        automationRate: 'k-rate',
      },
      {
        name: 'character',
        defaultValue: 0,
        minValue: 0,
        maxValue: 1,
        automationRate: 'k-rate',
      },
    ] as const;
  }
  private phase = 0;
  private cylinder = 0;
  private sinceFiring = 0;
  private firingAmp = 1;
  private seed = 0x9e3779b9;
  private noiseState = 0;
  private lowpassState = 0;
  private tuned = -1;
  private readonly sub = new Resonator();
  private readonly exhaust = new Resonator();
  private readonly body = new Resonator();
  private readonly rasp = new Resonator();

  private random(): number {
    // xorshift32: deterministic, allocation free.
    let s = this.seed;
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    this.seed = s >>> 0;
    return this.seed / 4294967296;
  }

  process(
    _inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean {
    const out = outputs[0]?.[0];
    if (!out) return true;
    const rpm = parameters['rpm']?.[0] ?? 900;
    const load = parameters['load']?.[0] ?? 0;
    const c = parameters['character']?.[0] ?? 0;
    if (c !== this.tuned) {
      this.sub.tune(lerp(48, 34, c), 1.2);
      this.exhaust.tune(lerp(96, 58, c), lerp(1.4, 2.6, c));
      this.body.tune(lerp(340, 150, c), lerp(2.2, 2, c));
      this.rasp.tune(lerp(1250, 700, c), lerp(3, 2.5, c));
      this.tuned = c;
    }
    const dt = 1 / sampleRate;
    const firingHz = (rpm / 60) * FIRINGS_PER_REV;
    // Puff length scales with firing rate so pulses stay distinct at idle and
    // merge into a roar at high RPM; the muscle voice keeps them fatter.
    const decay = Math.max(lerp(50, 30, c), firingHz * lerp(6, 3, c));
    const puffGain = lerp(3.2, 2.2, c) * (0.45 + 0.55 * load);
    const noiseGain =
      lerp(0.03 + 0.12 * load, 0.02 + 0.06 * load, c) * Math.min(1, rpm / 4500);
    const noiseCoefficient = Math.min(0.5, (600 + rpm * 0.25) * dt);
    const drive = lerp(1.4 + 2.6 * load, 1.1 + 2.4 * load, c);
    const lowpassCoefficient = Math.min(
      0.6,
      lerp(2500 + rpm * 0.6, 1400 + rpm * 0.35, c) * dt,
    );
    const subMix = lerp(0, 0.7, c);
    const exhaustMix = lerp(1, 1.3, c);
    const bodyMix = lerp(0.55, 0.7, c);
    const raspMix = lerp(0.18, 0.08, c);
    const dryMix = lerp(0.12, 0.1, c);
    for (let i = 0; i < out.length; i++) {
      this.phase += firingHz * dt;
      const gap = lerp(GAP_EVEN[this.cylinder]!, GAP_MUSCLE[this.cylinder]!, c);
      if (this.phase >= gap) {
        this.phase -= gap;
        this.cylinder = (this.cylinder + 1) & 3;
        this.sinceFiring = 0;
        this.firingAmp =
          lerp(
            STRENGTH_EVEN[this.cylinder]!,
            STRENGTH_MUSCLE[this.cylinder]!,
            c,
          ) *
          (0.9 + 0.2 * this.random());
      }
      this.sinceFiring += dt;
      const t = this.sinceFiring * decay;
      const puff = this.firingAmp * (Math.exp(-t) - Math.exp(-4 * t));
      this.noiseState +=
        (this.random() * 2 - 1 - this.noiseState) * noiseCoefficient;
      const excitation = puff * puffGain + this.noiseState * noiseGain;
      const shaped =
        subMix * this.sub.run(excitation) +
        exhaustMix * this.exhaust.run(excitation) +
        bodyMix * this.body.run(excitation) +
        raspMix * this.rasp.run(excitation) +
        dryMix * excitation;
      const saturated = Math.tanh(shaped * drive) * 0.5;
      this.lowpassState += (saturated - this.lowpassState) * lowpassCoefficient;
      out[i] = this.lowpassState;
    }
    return true;
  }
}

registerProcessor(ENGINE_PROCESSOR, EngineProcessor);
export {};
