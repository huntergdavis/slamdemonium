import type { EngineProfile } from '../vehicle/engineProfile';
import type {
  AudioMix,
  AudioOutput,
  AudioOutputState,
  AudioProfile,
} from './types';

/** Neither the backend nor its bank is requested before genuine activation
 * and a paint opportunity. Browser policy still decides whether resume succeeds. */
export class LazyAudioOutput implements AudioOutput {
  private readonly pending: AudioOutputState = {
    status: 'locked',
    activeVoices: 0,
    peakVoices: 0,
    droppedVoices: 0,
    error: null,
  };
  private output: AudioOutput | null = null;
  private disposed = false;
  private frame: number | null = null;
  private loading = false;
  private muted = false;

  constructor(private readonly engine: EngineProfile) {}

  private load(): void {
    void import('./howlerOutput')
      .then(({ HowlerOutput }) => {
        if (this.disposed) return;
        this.output = new HowlerOutput(this.engine);
        this.output.setMasterMuted(this.muted);
        this.output.unlock();
      })
      .catch(() => {
        if (this.disposed) return;
        this.pending.status = 'error';
        this.pending.error = 'Sound could not load. Reload to try again.';
      });
  }
  get state(): Readonly<AudioOutputState> {
    return this.output?.state ?? this.pending;
  }
  unlock(): void {
    if (this.disposed) return;
    if (this.output) {
      this.output.unlock();
      return;
    }
    if (this.loading) return;
    this.loading = true;
    this.pending.status = 'loading';
    // A focus gesture can precede async boot. Give the driving view a paint
    // opportunity before requesting any audio, even for that earlier gesture.
    this.frame = requestAnimationFrame(() => {
      this.frame = requestAnimationFrame(() => {
        this.frame = null;
        if (!this.disposed) this.load();
      });
    });
  }
  apply(mix: Readonly<AudioMix>): void {
    this.output?.apply(mix);
  }
  playImpact(profile: AudioProfile, gain: number, rate: number): boolean {
    return this.output?.playImpact(profile, gain, rate) ?? false;
  }
  playBoostAttack(gain: number, rate: number): boolean {
    return this.output?.playBoostAttack(gain, rate) ?? false;
  }
  pause(fadeMs: number): void {
    this.output?.pause(fadeMs);
  }
  setMasterMuted(muted: boolean): void {
    this.muted = muted;
    this.output?.setMasterMuted(muted);
  }
  reset(): void {
    this.output?.reset();
  }
  dispose(): void {
    this.disposed = true;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.output?.dispose();
  }
}
