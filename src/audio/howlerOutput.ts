import { Howl, Howler } from 'howler';
import tyre from '../../assets/audio/tyre.ogg?url&no-inline';
import boostLoop from '../../assets/audio/boost-loop.ogg?url&no-inline';
import boostAttack from '../../assets/audio/boost-attack.ogg?url&no-inline';
import impactAsphalt from '../../assets/audio/impact-asphalt.ogg?url&no-inline';
import impactKerb from '../../assets/audio/impact-kerb.ogg?url&no-inline';
import impactConcrete from '../../assets/audio/impact-concrete.ogg?url&no-inline';
import type { EngineProfile } from '../vehicle/engineProfile';
import { EngineSynth } from './engineSynth';
import { CONTINUOUS_VOICES, TRANSIENT_VOICES } from './types';
import type {
  AudioMix,
  AudioOutput,
  AudioOutputState,
  AudioProfile,
} from './types';

const clamp = (value: number): number => Math.max(0, Math.min(1, value));
const pitch = (value: number): number => Math.max(0.5, Math.min(4, value));
const ENGINE_GAIN = 1.5;
/** Howler loops plus the engine worklet module. */
const LOADABLE = 9;
const LOOP_VOICES = CONTINUOUS_VOICES - 1;

/** Browser-only output. Construction/decoding and short-effect play() happen
 * outside physics. pool controls recycling; slots enforce the actual voice cap. */
export class HowlerOutput implements AudioOutput {
  readonly state: AudioOutputState = {
    status: 'loading',
    activeVoices: 0,
    peakVoices: 0,
    droppedVoices: 0,
    error: null,
  };
  /** Continuous Howl loops: asphalt, kerb, concrete tyre, boost sustain. The
   * engine is the procedural worklet voice, not a sample. */
  private readonly loops: Howl[] = [];
  private synth: EngineSynth | null = null;
  private readonly effects: Howl[] = [];
  private readonly loopIds = new Float64Array(LOOP_VOICES).fill(-1);
  private readonly slotIds = new Float64Array(TRANSIENT_VOICES).fill(-1);
  private readonly slotSounds: (Howl | null)[] = Array.from(
    { length: TRANSIENT_VOICES },
    () => null,
  );
  private readonly volumes = new Float64Array(LOOP_VOICES);
  private readonly rates = new Float64Array(LOOP_VOICES);
  private readonly slotGains = new Float64Array(TRANSIENT_VOICES);
  private activated = false;
  private loaded = 0;
  private disposed = false;
  private paused = false;
  private muted = false;
  private fadeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(engine: EngineProfile) {
    for (const url of [tyre, tyre, tyre, boostLoop])
      this.loops.push(this.sound(url, true));
    for (const url of [impactAsphalt, impactKerb, impactConcrete, boostAttack])
      this.effects.push(this.sound(url, false));
    if (!Howler.usingWebAudio || !Howler.ctx) {
      this.state.status = 'unavailable';
      this.state.error = 'Web Audio is unavailable in this browser.';
      return;
    }
    Howler.ctx.addEventListener('statechange', this.refresh);
    // Routed through Howler's master gain so master mute covers the engine.
    this.synth = new EngineSynth(Howler.ctx, Howler.masterGain, engine, () => {
      this.loaded++;
      this.refresh();
    });
  }

  unlock(): void {
    if (
      this.disposed ||
      this.state.status === 'unavailable' ||
      this.state.status === 'error'
    )
      return;
    this.activated = true;
    // Called from a trusted click/key/touch by the UI, never pad polling.
    void Howler.ctx
      .resume()
      .then(this.refresh)
      .catch(() => {
        if (!this.disposed) this.state.status = 'locked';
      });
  }

  apply(mix: Readonly<AudioMix>): void {
    if (this.disposed) return;
    this.refresh();
    if (this.state.status !== 'ready') return;
    if (this.paused) {
      this.clearFadeTimer();
      this.stopTransients(); // A rapid resume must not resurrect fading impacts.
      this.paused = false;
      this.volumes.fill(-1);
    }
    if (mix.volume === 0) this.stopTransients();
    this.synth?.apply(
      clamp((mix.engineIdle + mix.engineLoad) * mix.volume * ENGINE_GAIN),
      mix.engineRpm * mix.rate,
      clamp(mix.engineLoad / 0.4),
      clamp(mix.engineCharacter),
      mix.exhaustSeconds,
      clamp(mix.exhaustFeedback),
      clamp(mix.firingUnevenness),
    );
    for (let index = 0; index < LOOP_VOICES; index++) {
      const howl = this.loops[index]!;
      let id = this.loopIds[index]!;
      if (id < 0) {
        id = howl.play();
        this.loopIds[index] = id;
        this.volumes[index] = -1;
        this.rates[index] = -1;
      }
      const level = index === 3 ? mix.boost : mix.tyres[index]!;
      const volume = clamp(level * mix.volume);
      // Kerb and concrete use their explicitly selected profile variants of the
      // credited tyre source. No unresolved wheel is redirected to asphalt.
      const rate = pitch(
        mix.rate * (index === 1 ? 0.78 : index === 2 ? 0.65 : 1),
      );
      if (volume !== this.volumes[index]) {
        howl.volume(volume, id);
        this.volumes[index] = volume;
      }
      if (rate !== this.rates[index]) {
        howl.rate(rate, id);
        this.rates[index] = rate;
      }
    }
    this.countVoices();
  }

  playImpact(profile: AudioProfile, gain: number, rate: number): boolean {
    return this.playTransient(
      this.effects[profile === 'asphalt' ? 0 : profile === 'kerb' ? 1 : 2]!,
      gain,
      rate,
    );
  }
  playBoostAttack(gain: number, rate: number): boolean {
    return this.playTransient(this.effects[3]!, gain, rate);
  }

  pause(fadeMs: number): void {
    if (this.disposed || this.paused) return;
    this.paused = true;
    const duration = Math.max(0, fadeMs);
    this.synth?.fade(duration);
    for (let index = 0; index < this.loops.length; index++) {
      const id = this.loopIds[index]!;
      if (id >= 0 && this.volumes[index]! > 0)
        this.loops[index]!.fade(
          Math.max(0, this.volumes[index]!),
          0,
          duration,
          id,
        );
    }
    for (let index = 0; index < TRANSIENT_VOICES; index++) {
      const sound = this.slotSounds[index];
      const id = this.slotIds[index]!;
      if (sound) sound.fade(this.slotGains[index]!, 0, duration, id);
    }
    this.clearFadeTimer();
    this.fadeTimer = setTimeout(() => {
      this.fadeTimer = null;
      this.stopTransients();
    }, duration);
  }
  setMasterMuted(muted: boolean): void {
    this.muted = muted;
    Howler.mute(muted);
  }
  reset(): void {
    this.clearFadeTimer();
    this.stopTransients();
    this.synth?.reset();
    for (let index = 0; index < this.loops.length; index++) {
      if (this.loopIds[index]! >= 0)
        this.loops[index]!.volume(0, this.loopIds[index]!);
    }
    this.volumes.fill(0);
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.reset();
    Howler.ctx?.removeEventListener('statechange', this.refresh);
    this.synth?.dispose();
    this.synth = null;
    for (const sound of this.loops) sound.unload();
    for (const sound of this.effects) sound.unload();
    this.loopIds.fill(-1);
    this.state.activeVoices = 0;
  }

  private sound(url: string, loop: boolean): Howl {
    const sound = new Howl({
      src: [url],
      html5: false,
      loop,
      volume: 0,
      preload: true,
      pool: TRANSIENT_VOICES,
      onload: () => {
        this.loaded++;
        this.refresh();
      },
      onloaderror: (_id, error) => {
        if (this.disposed) return;
        this.state.status = 'error';
        this.state.error = 'Sound could not load: ' + String(error);
        this.reset();
      },
      onplayerror: (id) => {
        this.release(sound, id);
        if (!this.disposed) this.state.status = 'locked';
      },
      onend: (id) => {
        if (!loop) this.release(sound, id);
      },
    });
    return sound;
  }
  private readonly refresh = (): void => {
    if (
      this.disposed ||
      this.state.status === 'error' ||
      this.state.status === 'unavailable'
    )
      return;
    this.state.status =
      this.loaded !== LOADABLE
        ? 'loading'
        : this.activated && Howler.ctx?.state === 'running'
          ? 'ready'
          : 'locked';
  };
  private playTransient(sound: Howl, gain: number, rate: number): boolean {
    if (
      this.disposed ||
      this.paused ||
      this.muted ||
      gain <= 0 ||
      this.state.status !== 'ready'
    )
      return false;
    let slot = -1;
    for (let index = 0; index < TRANSIENT_VOICES; index++)
      if (this.slotSounds[index] === null) {
        slot = index;
        break;
      }
    if (slot < 0) {
      this.state.droppedVoices++;
      return false;
    }
    const id = sound.play();
    this.slotSounds[slot] = sound;
    this.slotIds[slot] = id;
    this.slotGains[slot] = clamp(gain);
    sound.volume(clamp(gain), id);
    sound.rate(pitch(rate), id);
    this.countVoices();
    return true;
  }
  private release(sound: Howl, id: number): void {
    for (let index = 0; index < TRANSIENT_VOICES; index++) {
      if (this.slotSounds[index] === sound && this.slotIds[index] === id) {
        this.slotSounds[index] = null;
        this.slotIds[index] = -1;
      }
    }
    this.countVoices();
  }
  private stopTransients(): void {
    for (let index = 0; index < TRANSIENT_VOICES; index++) {
      this.slotSounds[index]?.stop(this.slotIds[index]!);
      this.slotSounds[index] = null;
      this.slotIds[index] = -1;
    }
    this.countVoices();
  }
  private countVoices(): void {
    let count = this.synth?.active && this.state.status === 'ready' ? 1 : 0;
    for (let index = 0; index < LOOP_VOICES; index++)
      if (this.loopIds[index]! >= 0) count++;
    for (let index = 0; index < TRANSIENT_VOICES; index++)
      if (this.slotSounds[index] !== null) count++;
    this.state.activeVoices = count;
    this.state.peakVoices = Math.max(this.state.peakVoices, count);
  }
  private clearFadeTimer(): void {
    if (this.fadeTimer !== null) clearTimeout(this.fadeTimer);
    this.fadeTimer = null;
  }
}
