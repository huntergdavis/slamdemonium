/** AudioWorklet processor: a procedural four-cylinder engine voice. Runs on the
 * audio rendering thread; `process` allocates nothing. RPM stays synthetic and
 * arrives as a k-rate parameter, so there is no loop and no loop seam. */
declare const sampleRate: number;
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: { processorOptions?: unknown });
  abstract process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}
declare function registerProcessor(
  name: string,
  processor: new (options?: {
    processorOptions?: unknown;
  }) => AudioWorkletProcessor,
): void;
/** Engine identity handed over once at construction; see
 * vehicle/engineProfile.ts, which this module cannot import because it runs
 * in the worklet scope. Missing fields fall back to the default engine. */
interface EngineOptions {
  firingsPerRevolution?: number;
  firingStrength?: readonly number[];
  firingGap?: readonly number[];
  pipeLossHz?: number;
  mufflerSeconds?: number;
  mufflerFeedback?: number;
  mufflerLossHz?: number;
}

const ENGINE_PROCESSOR = 'slamdemonium-engine';
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Two voices, blended by `character`. 0 is the even four-cylinder through
 * resonant band-pass filters. 1 is the muscle voice through an exhaust PIPE:
 * a delay-line waveguide with inverting reflection at the open tailpipe and
 * lowpass radiation loss, plus a shorter muffler section. Each pulse then
 * interferes with reflections of the pulses before it, and that interference
 * shifts as the firing spacing sweeps against the pipe delay, which is the
 * chug a bank of filters cannot make: filters ring the same bells for every
 * pulse. The muscle firing pattern comes from the engine profile; the even
 * voice is the fixed reference. */
const PATTERN = 8;
const STRENGTH_EVEN = new Float32Array([
  1, 0.78, 0.92, 0.7, 1, 0.78, 0.92, 0.7,
]);
const GAP_EVEN = new Float32Array([1, 1, 1, 1, 1, 1, 1, 1]);
const DEFAULT_STRENGTH = [1, 0.3, 0.85, 0.5, 0.7, 0.25, 0.45, 0.35];
const DEFAULT_GAP = [1.4, 0.6, 1.25, 0.75, 1.1, 0.9, 1.35, 0.65];
const DEFAULT_FIRINGS_PER_REV = 2;
const DEFAULT_PIPE_SECONDS = 0.009;
const DEFAULT_PIPE_FEEDBACK = 0.72;
const DEFAULT_PIPE_LOSS_HZ = 1400;
const DEFAULT_MUFFLER_SECONDS = 0.0031;
const DEFAULT_MUFFLER_FEEDBACK = 0.42;
const DEFAULT_MUFFLER_LOSS_HZ = 900;
const MAX_DELAY_SECONDS = 0.02;

/** Constant-skirt band-pass biquad; `tune` recomputes coefficients (per block
 * at most, only when rpm or the voice character moves). */
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

/** Feedback delay-line waveguide with a one-pole lowpass in the loop. The
 * buffer is allocated once at construction; `run` allocates nothing and
 * `tune` only rewrites two numbers. */
class Pipe {
  private readonly buffer: Float32Array;
  private write = 0;
  private loss = 0;
  private delay = 1;
  private feedback = 0;
  private readonly lossCoefficient: number;
  constructor(seconds: number, feedback: number, lossHz: number) {
    this.buffer = new Float32Array(Math.ceil(MAX_DELAY_SECONDS * sampleRate));
    this.lossCoefficient = Math.min(0.99, (2 * Math.PI * lossHz) / sampleRate);
    this.tune(seconds, feedback);
  }
  tune(seconds: number, feedback: number): void {
    this.delay = Math.max(
      1,
      Math.min(this.buffer.length - 2, seconds * sampleRate),
    );
    this.feedback = feedback;
  }
  /** Returns the wave arriving at the far end, which is what radiates. */
  run(input: number): number {
    const length = this.buffer.length;
    let position = this.write - this.delay;
    if (position < 0) position += length;
    const index = Math.floor(position);
    const fraction = position - index;
    const next = index + 1 < length ? index + 1 : 0;
    const delayed =
      this.buffer[index]! * (1 - fraction) + this.buffer[next]! * fraction;
    this.loss += (delayed - this.loss) * this.lossCoefficient;
    this.buffer[this.write] = input + this.feedback * this.loss;
    this.write = this.write + 1 < length ? this.write + 1 : 0;
    return this.loss;
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
      {
        name: 'pipeSeconds',
        defaultValue: DEFAULT_PIPE_SECONDS,
        minValue: 0.002,
        maxValue: MAX_DELAY_SECONDS,
        automationRate: 'k-rate',
      },
      {
        name: 'pipeFeedback',
        defaultValue: DEFAULT_PIPE_FEEDBACK,
        minValue: 0,
        maxValue: 0.95,
        automationRate: 'k-rate',
      },
      {
        name: 'unevenness',
        defaultValue: 1,
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
  private nextGap = 1;
  private wander = 0;
  private seed = 0x9e3779b9;
  private noiseState = 0;
  private lowpassState = 0;
  private blockIn = 0;
  private blockOut = 0;
  private tunedCharacter = -1;
  private tunedRpm = -1;
  private readonly sub = new Resonator();
  private readonly exhaust = new Resonator();
  private readonly body = new Resonator();
  private readonly rasp = new Resonator();
  private readonly firingsPerRev: number;
  private readonly strengthMuscle = new Float32Array(PATTERN);
  private readonly gapMuscle = new Float32Array(PATTERN);
  private readonly pipe: Pipe;
  private readonly muffler: Pipe;
  private pipeSeconds = -1;
  private pipeFeedback = -1;

  constructor(options?: { processorOptions?: unknown }) {
    super(options);
    const engine = (options?.processorOptions ?? {}) as EngineOptions;
    this.firingsPerRev = engine.firingsPerRevolution ?? DEFAULT_FIRINGS_PER_REV;
    const strength = engine.firingStrength ?? DEFAULT_STRENGTH;
    const gap = engine.firingGap ?? DEFAULT_GAP;
    for (let i = 0; i < PATTERN; i++) {
      this.strengthMuscle[i] = strength[i % strength.length] ?? 1;
      this.gapMuscle[i] = gap[i % gap.length] ?? 1;
    }
    this.pipe = new Pipe(
      DEFAULT_PIPE_SECONDS,
      -DEFAULT_PIPE_FEEDBACK,
      engine.pipeLossHz ?? DEFAULT_PIPE_LOSS_HZ,
    );
    this.muffler = new Pipe(
      engine.mufflerSeconds ?? DEFAULT_MUFFLER_SECONDS,
      engine.mufflerFeedback ?? DEFAULT_MUFFLER_FEEDBACK,
      engine.mufflerLossHz ?? DEFAULT_MUFFLER_LOSS_HZ,
    );
  }

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
    const pipeSeconds = parameters['pipeSeconds']?.[0] ?? DEFAULT_PIPE_SECONDS;
    const pipeFeedback =
      parameters['pipeFeedback']?.[0] ?? DEFAULT_PIPE_FEEDBACK;
    const u = parameters['unevenness']?.[0] ?? 1;
    if (
      pipeSeconds !== this.pipeSeconds ||
      pipeFeedback !== this.pipeFeedback
    ) {
      this.pipe.tune(pipeSeconds, -pipeFeedback);
      this.pipeSeconds = pipeSeconds;
      this.pipeFeedback = pipeFeedback;
    }
    const dt = 1 / sampleRate;
    const firingHz = (rpm / 60) * this.firingsPerRev;
    const useFilters = c < 1;
    const usePipe = c > 0;
    if (useFilters && (c !== this.tunedCharacter || rpm !== this.tunedRpm)) {
      this.sub.tune(48, 1.2);
      this.exhaust.tune(96, 1.4);
      this.body.tune(340, 2.2);
      this.rasp.tune(1250, 3);
      this.tunedCharacter = c;
      this.tunedRpm = rpm;
    }
    // Puff length scales with firing rate so pulses stay distinct at idle and
    // merge into a roar at high RPM.
    const decay = Math.max(lerp(50, 60, c), firingHz * lerp(6, 4.5, c));
    const puffGain = lerp(3.2, 1.6, c) * (0.45 + 0.55 * load);
    // Jitter that is texture at idle becomes hash at four times the pulse
    // rate, so it thins out as revs rise.
    const revWeight = Math.max(0.2, Math.min(1, 1 - (rpm - 1500) / 4500));
    const ampJitter = lerp(0.1, 0.4 * revWeight, c);
    const timeJitter = lerp(0, 0.08 * revWeight, c);
    const noiseGain =
      lerp(0.03 + 0.12 * load, 0.02 + 0.05 * load, c) * Math.min(1, rpm / 4500);
    const noiseCoefficient = Math.min(
      0.5,
      lerp(600 + rpm * 0.25, 350 + rpm * 0.08, c) * dt,
    );
    const drive = lerp(1.4 + 2.6 * load, 0.7 + 0.8 * load, c);
    const makeup = lerp(0.5, 0.8, c);
    const lowpassCoefficient = Math.min(
      0.6,
      lerp(2500 + rpm * 0.6, 1100 + rpm * 0.3, c) * dt,
    );
    const pulseStep = firingHz * dt;
    for (let i = 0; i < out.length; i++) {
      this.phase += pulseStep;
      if (this.phase >= this.nextGap) {
        // Sub-sample onset: a pulse that starts on the sample grid carries
        // timing quantisation noise once pulses are milliseconds apart.
        const overshoot = this.phase - this.nextGap;
        this.phase = overshoot;
        this.cylinder = (this.cylinder + 1) % PATTERN;
        this.sinceFiring = (overshoot / pulseStep) * dt;
        // Slow wander drifts across pulses so successive cycles differ.
        this.wander =
          this.wander * 0.8 + (this.random() - 0.5) * 0.5 * revWeight;
        // Unevenness scales the muscle pattern's deviation from a regular
        // train; zero is a perfectly even pulse train through the pipe.
        const strengthMuscle =
          1 + (this.strengthMuscle[this.cylinder]! - 1) * u;
        const gapMuscle = 1 + (this.gapMuscle[this.cylinder]! - 1) * u;
        this.firingAmp =
          lerp(STRENGTH_EVEN[this.cylinder]!, strengthMuscle, c) *
          (1 + ampJitter * (this.random() - 0.5)) *
          (1 + 0.3 * c * this.wander);
        this.nextGap =
          lerp(GAP_EVEN[this.cylinder]!, gapMuscle, c) *
          (1 + timeJitter * (this.random() - 0.5) * 2);
      }
      this.sinceFiring += dt;
      const t = this.sinceFiring * decay;
      // The even voice keeps its cornered puff; the pipe gets a puff with a
      // continuous slope at onset, so its harmonics fall off faster and the
      // feedback loop has no edge hash to amplify. Both peak near 1.
      const puffEven = Math.exp(-t) - Math.exp(-4 * t);
      const puffSmooth = 0.87 * t * t * Math.exp(-t);
      const puff = this.firingAmp * lerp(puffEven, puffSmooth, c);
      this.noiseState +=
        (this.random() * 2 - 1 - this.noiseState) * noiseCoefficient;
      const excitation = puff * puffGain + this.noiseState * noiseGain;
      let shaped = 0;
      if (useFilters)
        shaped +=
          (1 - c) *
          (this.exhaust.run(excitation) +
            0.55 * this.body.run(excitation) +
            0.18 * this.rasp.run(excitation) +
            0.12 * excitation);
      if (usePipe) {
        // A pressure puff is one-sided; block its DC before the feedback
        // loops, or the muffler section pumps a bias into the saturator.
        const blocked = excitation - this.blockIn + 0.995 * this.blockOut;
        this.blockIn = excitation;
        this.blockOut = blocked;
        const radiated = this.pipe.run(blocked);
        shaped +=
          c *
          (1.2 * this.muffler.run(radiated) + 0.6 * radiated + 0.15 * blocked);
      }
      const saturated = Math.tanh(shaped * drive) * makeup;
      this.lowpassState += (saturated - this.lowpassState) * lowpassCoefficient;
      out[i] = this.lowpassState;
    }
    return true;
  }
}

registerProcessor(ENGINE_PROCESSOR, EngineProcessor);
export {};
