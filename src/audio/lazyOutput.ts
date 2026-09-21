import type {
  AudioMix,
  AudioOutput,
  AudioOutputState,
  AudioProfile,
} from './types';

/** Loading the sound bank never blocks boot or a physics step. Browser policy
 * still decides whether a recorded genuine activation permits context.resume. */
export class LazyAudioOutput implements AudioOutput {
  private readonly pending: AudioOutputState = {
    status: 'loading',
    activeVoices: 0,
    peakVoices: 0,
    droppedVoices: 0,
    error: null,
  };
  private output: AudioOutput | null = null;
  private disposed = false;
  private activated = false;
  private muted = false;

  constructor() {
    void import('./howlerOutput')
      .then(({ HowlerOutput }) => {
        if (this.disposed) return;
        this.output = new HowlerOutput();
        this.output.setMasterMuted(this.muted);
        if (this.activated) this.output.unlock();
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
    this.activated = true;
    this.output?.unlock();
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
    this.output?.dispose();
  }
}
