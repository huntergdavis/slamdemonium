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
/** Uneven cylinder strengths give the half-order lope that reads as throat. */
const FIRING_STRENGTH = new Float32Array([1, 0.78, 0.92, 0.7]);

/** Constant-skirt band-pass biquad, coefficients fixed at construction. */
class Resonator {
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  private readonly b0: number;
  private readonly a1: number;
  private readonly a2: number;
  constructor(hz: number, q: number) {
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
    ] as const;
  }
  private phase = 0;
  private cylinder = 0;
  private sinceFiring = 0;
  private firingAmp = 1;
  private seed = 0x9e3779b9;
  private noiseState = 0;
  private lowpassState = 0;
  private readonly exhaust = new Resonator(96, 1.4);
  private readonly body = new Resonator(340, 2.2);
  private readonly rasp = new Resonator(1250, 3);

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
    const dt = 1 / sampleRate;
    const firingHz = (rpm / 60) * FIRINGS_PER_REV;
    // Puff length scales with firing rate so pulses stay distinct at idle and
    // merge into a roar at high RPM.
    const decay = Math.max(50, firingHz * 6);
    const puffGain = 3.2 * (0.55 + 0.45 * load);
    const noiseGain = (0.03 + 0.12 * load) * Math.min(1, rpm / 4500);
    const noiseCoefficient = Math.min(0.5, (600 + rpm * 0.25) * dt);
    const drive = 1.4 + 2.6 * load;
    const lowpassCoefficient = Math.min(0.6, (2500 + rpm * 0.6) * dt);
    for (let i = 0; i < out.length; i++) {
      this.phase += firingHz * dt;
      if (this.phase >= 1) {
        this.phase -= 1;
        this.cylinder = (this.cylinder + 1) & 3;
        this.sinceFiring = 0;
        this.firingAmp =
          FIRING_STRENGTH[this.cylinder]! * (0.9 + 0.2 * this.random());
      }
      this.sinceFiring += dt;
      const t = this.sinceFiring * decay;
      const puff = this.firingAmp * (Math.exp(-t) - Math.exp(-4 * t));
      this.noiseState +=
        (this.random() * 2 - 1 - this.noiseState) * noiseCoefficient;
      const excitation = puff * puffGain + this.noiseState * noiseGain;
      const shaped =
        this.exhaust.run(excitation) +
        0.55 * this.body.run(excitation) +
        0.18 * this.rasp.run(excitation) +
        0.12 * excitation;
      const saturated = Math.tanh(shaped * drive) * 0.5;
      this.lowpassState += (saturated - this.lowpassState) * lowpassCoefficient;
      out[i] = this.lowpassState;
    }
    return true;
  }
}

registerProcessor(ENGINE_PROCESSOR, EngineProcessor);
export {};
