import { Howl, Howler } from 'howler';
import tyre from '../../assets/audio/tyre.ogg?url&no-inline';
import boostLoop from '../../assets/audio/boost-loop.ogg?url&no-inline';
import boostAttack from '../../assets/audio/boost-attack.ogg?url&no-inline';
import impactAsphalt from '../../assets/audio/impact-asphalt.ogg?url&no-inline';
import impactKerb from '../../assets/audio/impact-kerb.ogg?url&no-inline';
import impactConcrete from '../../assets/audio/impact-concrete.ogg?url&no-inline';
import type { EngineProfile } from '../vehicle/engineProfile';
import { EngineSynth } from './engineSynth';
import { CRASH_URLS, type CrashClip } from './crashUrls';
import { CONTINUOUS_VOICES, MAX_AUDIO_VOICES, TRANSIENT_VOICES } from './types';
import type {
  AudioMix,
  AudioOutput,
  AudioOutputState,
  AudioProfile,
  CrashCue,
} from './types';

const clamp = (value: number): number => Math.max(0, Math.min(1, value));
const pitch = (value: number): number => Math.max(0.5, Math.min(4, value));
/** The engine is the dominant continuous voice: at full throttle it sits at
 * the layer ceiling (sfxVolume), about 3.6 dB above a full four-wheel screech
 * whose own level is unchanged. */
const ENGINE_GAIN = 3;
/** The inserted master-limiter path measured about +3 dB on the no-contact
 * engine bed. This compensation restores the main build's matched-speed level
 * while leaving headroom for layered crashes. */
const LIMITER_OUTPUT_GAIN = 0.71;
/** Howler loops plus the engine worklet module. */
const CORE_CRASH_CLIPS = [
  'light',
  'tick',
  'attack',
  'bend',
  'can',
  'heavy',
  'glass',
  'scrape',
  'rattle',
  'bass',
  'creak',
  'distant',
] as const satisfies readonly CrashClip[];
const LAZY_CRASH_CLIPS = [
  'hard-alt',
  'wall-tail',
] as const satisfies readonly CrashClip[];
const LOADABLE = 9 + CORE_CRASH_CLIPS.length;
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
  private readonly crashSounds: Partial<Record<CrashClip, Howl>> = {};
  private readonly lazyReady: Partial<Record<CrashClip, boolean>> = {};
  private readonly grindIds = new Float64Array(2).fill(-1);
  private readonly grindGains = new Float64Array(2);
  private lazyRequested = false;
  private crashSequence = 0;
  private limiter: DynamicsCompressorNode | null = null;
  private limiterOutput: GainNode | null = null;
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
    for (const name of CORE_CRASH_CLIPS)
      this.crashSounds[name] = this.sound(
        [...CRASH_URLS[name]],
        name === 'scrape',
      );
    for (const name of LAZY_CRASH_CLIPS)
      this.crashSounds[name] = this.sound(
        [...CRASH_URLS[name]],
        false,
        false,
        name,
      );
    if (!Howler.usingWebAudio || !Howler.ctx) {
      this.state.status = 'unavailable';
      this.state.error = 'Web Audio is unavailable in this browser.';
      return;
    }
    Howler.ctx.addEventListener('statechange', this.refresh);
    // One gentle final limiter gives overlapping attack/body/glass layers
    // headroom without altering per-voice priorities or master mute.
    if (Howler.ctx.createDynamicsCompressor && Howler.masterGain) {
      try {
        const limiter = Howler.ctx.createDynamicsCompressor();
        limiter.threshold.value = -8;
        limiter.knee.value = 6;
        limiter.ratio.value = 10;
        limiter.attack.value = 0.003;
        limiter.release.value = 0.13;
        const output = Howler.ctx.createGain();
        output.gain.value = LIMITER_OUTPUT_GAIN;
        Howler.masterGain.disconnect();
        Howler.masterGain.connect(limiter);
        limiter.connect(output);
        output.connect(Howler.ctx.destination);
        this.limiter = limiter;
        this.limiterOutput = output;
      } catch {
        // Unsupported routing leaves the conservative per-sample gain cap.
      }
    }
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
      clamp(
        (mix.engineIdle + mix.engineLoad) *
          mix.volume *
          ENGINE_GAIN *
          (mix.duck ?? 1) *
          Math.max(0, mix.engineLevel),
      ),
      mix.engineRpm * mix.rate,
      clamp(mix.engineLoad / 0.4),
      clamp(mix.engineCharacter),
      mix.exhaustSeconds,
      clamp(mix.exhaustFeedback),
      clamp(mix.firingUnevenness),
      Math.max(0.5, Math.min(2, mix.firingRateScale)),
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
      const volume = clamp(
        level * mix.volume * (index === 3 ? (mix.duck ?? 1) : 1),
      );
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

  playCrash(cue: Readonly<CrashCue>): boolean {
    if (cue.tier === 'hard' && !this.lazyRequested) {
      this.lazyRequested = true;
      for (const name of LAZY_CRASH_CLIPS) this.crashSounds[name]?.load();
    }
    const step = this.crashSequence++;
    // Rotation and a bounded +/-5% rate keep repeated slams distinct without
    // allowing a light clip to become a heavier tier by pitch alone.
    const rate = pitch(cue.rate * (1 + (((step * 7) % 11) - 5) * 0.01));
    const play = (name: CrashClip, gain: number) =>
      this.playTransient(this.crashSounds[name]!, gain, rate, cue.pan);
    if (cue.kind === 'distant') return play('distant', cue.gain * 0.62);
    if (cue.kind === 'takedown') {
      const tick = play('tick', cue.gain * 0.82);
      play('rattle', cue.gain * 0.55);
      play('bass', cue.gain * 0.28);
      return tick;
    }
    if (cue.kind === 'wreck') {
      const creak = play('creak', cue.gain * 0.9);
      play('rattle', cue.gain * 0.5);
      return creak;
    }
    if (cue.tier === 'light') {
      const attack = play(step % 2 ? 'tick' : 'light', cue.gain * 0.9);
      play(step % 2 ? 'light' : 'tick', cue.gain * 0.38);
      return attack;
    }
    if (cue.tier === 'medium') {
      const attack = play(step % 3 === 0 ? 'tick' : 'attack', cue.gain * 0.85);
      const body = (['bend', 'can', 'light'] as const)[step % 3]!;
      play(body, cue.gain * 0.65);
      return attack;
    }
    const attack = play('attack', cue.gain * 0.9);
    const hardBodies: readonly CrashClip[] = [
      'heavy',
      'bend',
      this.lazyReady['hard-alt'] ? 'hard-alt' : 'heavy',
    ];
    const body =
      cue.kind === 'wall' && this.lazyReady['wall-tail']
        ? 'wall-tail'
        : hardBodies[step % hardBodies.length]!;
    play(body, cue.gain * 0.78);
    if (cue.glass) play('glass', cue.gain * 0.38);
    else if (cue.debris) play('rattle', cue.gain * 0.32);
    return attack;
  }

  setGrind(slot: 0 | 1, gain: number, rate: number, pan: number): void {
    const sound = this.crashSounds.scrape;
    if (
      !sound ||
      this.disposed ||
      this.paused ||
      this.muted ||
      this.state.status !== 'ready'
    )
      return;
    let id = this.grindIds[slot]!;
    if (gain < 0.002) {
      if (id >= 0) sound.stop(id);
      this.grindIds[slot] = -1;
      this.grindGains[slot] = 0;
      this.countVoices();
      return;
    }
    if (id < 0) {
      this.countVoices();
      if (this.state.activeVoices >= MAX_AUDIO_VOICES) return;
      id = sound.play();
      this.grindIds[slot] = id;
    }
    this.grindGains[slot] = clamp(gain);
    sound.volume(clamp(gain), id);
    sound.rate(pitch(rate), id);
    sound.stereo?.(Math.max(-1, Math.min(1, pan)), id);
    this.countVoices();
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
    for (let index = 0; index < 2; index++) {
      const id = this.grindIds[index]!;
      if (id >= 0)
        this.crashSounds.scrape?.fade(this.grindGains[index]!, 0, duration, id);
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
    for (const sound of Object.values(this.crashSounds)) sound?.unload();
    if (this.limiter) {
      try {
        Howler.masterGain.disconnect(this.limiter);
        this.limiter.disconnect();
        this.limiterOutput?.disconnect();
        Howler.masterGain.connect(Howler.ctx.destination);
      } catch {
        /* The context may already have closed. */
      }
      this.limiter = null;
      this.limiterOutput = null;
    }
    this.loopIds.fill(-1);
    this.state.activeVoices = 0;
  }

  private sound(
    url: string | string[],
    loop: boolean,
    preload = true,
    lazyName?: CrashClip,
  ): Howl {
    const sound = new Howl({
      src: Array.isArray(url) ? url : [url],
      html5: false,
      loop,
      volume: 0,
      preload,
      pool: TRANSIENT_VOICES,
      onload: () => {
        if (lazyName) this.lazyReady[lazyName] = true;
        else this.loaded++;
        this.refresh();
      },
      onloaderror: (_id, error) => {
        if (this.disposed) return;
        if (lazyName) return; // A core body remains available for hard hits.
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
  private playTransient(
    sound: Howl,
    gain: number,
    rate: number,
    pan = 0,
  ): boolean {
    if (
      this.disposed ||
      this.paused ||
      this.muted ||
      gain <= 0 ||
      this.state.status !== 'ready'
    )
      return false;
    this.countVoices();
    if (this.state.activeVoices >= MAX_AUDIO_VOICES) {
      this.state.droppedVoices++;
      return false;
    }
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
    sound.stereo?.(Math.max(-1, Math.min(1, pan)), id);
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
    for (let index = 0; index < 2; index++) {
      if (this.grindIds[index]! >= 0)
        this.crashSounds.scrape?.stop(this.grindIds[index]!);
      this.grindIds[index] = -1;
      this.grindGains[index] = 0;
    }
    this.countVoices();
  }
  private countVoices(): void {
    let count = this.synth?.active && this.state.status === 'ready' ? 1 : 0;
    for (let index = 0; index < LOOP_VOICES; index++)
      if (this.loopIds[index]! >= 0) count++;
    for (let index = 0; index < TRANSIENT_VOICES; index++)
      if (this.slotSounds[index] !== null) count++;
    for (let index = 0; index < 2; index++)
      if (this.grindIds[index]! >= 0) count++;
    this.state.activeVoices = count;
    this.state.peakVoices = Math.max(this.state.peakVoices, count);
  }
  private clearFadeTimer(): void {
    if (this.fadeTimer !== null) clearTimeout(this.fadeTimer);
    this.fadeTimer = null;
  }
}
