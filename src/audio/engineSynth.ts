import processorUrl from './engineProcessor.ts?worker&url';

const ENGINE_PROCESSOR = 'slamdemonium-engine';
/** Seconds; short enough to track throttle, long enough to hide RAF steps. */
const LEVEL_SMOOTHING = 0.012;
const RPM_SMOOTHING = 0.03;

/** Main-thread owner of the procedural engine voice. The module is requested
 * only from the activated backend, so it shares the existing user gate. An
 * unsupported browser leaves the engine silent and the game usable. */
export class EngineSynth {
  private node: AudioWorkletNode | null = null;
  private gain: GainNode | null = null;
  private level = -1;
  private rpm = -1;
  private load = -1;
  private character = -1;
  private disposed = false;

  constructor(
    private readonly ctx: AudioContext,
    destination: AudioNode,
    onSettled: () => void,
  ) {
    if (typeof AudioWorkletNode === 'undefined' || !ctx.audioWorklet) {
      onSettled();
      return;
    }
    ctx.audioWorklet
      .addModule(processorUrl)
      .then(() => {
        if (this.disposed) return;
        const gain = ctx.createGain();
        gain.gain.value = 0;
        const node = new AudioWorkletNode(ctx, ENGINE_PROCESSOR, {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [1],
        });
        node.connect(gain).connect(destination);
        this.node = node;
        this.gain = gain;
      })
      .catch(() => {})
      .finally(onSettled);
  }

  get active(): boolean {
    return this.node !== null;
  }

  /** level 0..1 (already includes sfxVolume), rpm in revolutions per minute
   * (already includes the slow-motion rate), load 0..1, character 0..1
   * (0 even four-cylinder, 1 muscle voice). */
  apply(level: number, rpm: number, load: number, character: number): void {
    if (!this.node || !this.gain) return;
    const now = this.ctx.currentTime;
    if (level !== this.level) {
      this.gain.gain.cancelScheduledValues(now);
      this.gain.gain.setTargetAtTime(level, now, LEVEL_SMOOTHING);
      this.level = level;
    }
    if (rpm !== this.rpm) {
      this.param('rpm').setTargetAtTime(rpm, now, RPM_SMOOTHING);
      this.rpm = rpm;
    }
    if (load !== this.load) {
      this.param('load').setTargetAtTime(load, now, RPM_SMOOTHING);
      this.load = load;
    }
    if (character !== this.character) {
      this.param('character').setTargetAtTime(character, now, RPM_SMOOTHING);
      this.character = character;
    }
  }

  /** Native audio-clock fade to silence, independent of the next RAF. */
  fade(ms: number): void {
    if (!this.gain) return;
    const now = this.ctx.currentTime;
    const gain = this.gain.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(Math.max(0, this.level), now);
    gain.linearRampToValueAtTime(0, now + Math.max(0, ms) / 1000);
    this.level = -1;
  }
  reset(): void {
    if (!this.gain) return;
    this.gain.gain.cancelScheduledValues(this.ctx.currentTime);
    this.gain.gain.value = 0;
    this.level = 0;
  }
  dispose(): void {
    this.disposed = true;
    this.node?.disconnect();
    this.gain?.disconnect();
    this.node = null;
    this.gain = null;
  }
  private param(name: 'rpm' | 'load' | 'character'): AudioParam {
    const param = this.node!.parameters.get(name);
    if (!param) throw new Error('Engine parameter missing: ' + name);
    return param;
  }
}
