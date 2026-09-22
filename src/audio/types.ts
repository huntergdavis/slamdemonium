/** Read synchronously from the existing post-step telemetry. These are borrowed
 * views; AudioDirector copies scalars into its own fixed storage. */
export interface AudioWheel {
  readonly grounded: boolean;
  readonly surfaceId: number | null;
  readonly Fz: number;
  readonly vx: number;
  readonly vy: number;
  readonly spinning: boolean;
  readonly locked: boolean;
}
export interface AudioTelemetry {
  readonly speed: number;
  readonly throttle: number;
  readonly boostEnvelope: number;
  /** Shared derived engine state from the vehicle rpm model. */
  readonly rpm: number;
  readonly upshiftCount: number;
  readonly downshiftCount: number;
  readonly velocity: Readonly<{ x: number; y: number; z: number }>;
  readonly wheels: readonly AudioWheel[];
}
export type AudioProfile = 'asphalt' | 'kerb' | 'concrete';
export interface AudioSurface {
  readonly audioProfile: AudioProfile;
}
export type AudioStatus =
  'locked' | 'loading' | 'ready' | 'unavailable' | 'error';
export interface AudioOutputState {
  status: AudioStatus;
  activeVoices: number;
  peakVoices: number;
  droppedVoices: number;
  error: string | null;
}

/** Five persistent layers (procedural engine, three tyre profiles, boost
 * sustain) reserve five voices; at most ten short effects can coexist.
 * Howler's inactive pool size is not an active-voice limit. */
export const CONTINUOUS_VOICES = 5;
export const TRANSIENT_VOICES = 10;
export const MAX_AUDIO_VOICES = CONTINUOUS_VOICES + TRANSIENT_VOICES;

/** One reused render-time mix. Indices: asphalt, kerb, concrete. */
export interface AudioMix {
  engineIdle: number;
  engineLoad: number;
  /** Shared rpm from telemetry; audio no longer derives its own. */
  engineRpm: number;
  /** Voice blend from the engineCharacter tuning: 0 even four, 1 muscle. */
  engineCharacter: number;
  /** Live exhaust shape from tuning: pipe round trip (s), feedback 0..1,
   * firing unevenness 0..1. */
  exhaustSeconds: number;
  exhaustFeedback: number;
  firingUnevenness: number;
  readonly tyres: Float64Array;
  boost: number;
  rate: number;
  volume: number;
}
export interface AudioOutput {
  readonly state: Readonly<AudioOutputState>;
  /** Called only from a genuine browser activation, never from physics. */
  unlock(): void;
  /** Called once per RAF, after all simulation and pause commands. */
  apply(mix: Readonly<AudioMix>): void;
  playImpact(profile: AudioProfile, gain: number, rate: number): boolean;
  playBoostAttack(gain: number, rate: number): boolean;
  /** Schedule the SFX fade in the audio clock, independent of the next RAF. */
  pause(fadeMs: number): void;
  /** Applies to all game audio, preserving the independently tuned SFX volume. */
  setMasterMuted(muted: boolean): void;
  reset(): void;
  dispose(): void;
}
