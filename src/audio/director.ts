import type { TuningStore } from '../tuning/store';
import { AudioSettings } from './settings';
import type {
  AudioMix,
  AudioOutput,
  AudioProfile,
  AudioSurface,
  AudioStatus,
  AudioTelemetry,
} from './types';

const QUEUE_SIZE = 32;
const PAIR_SLOTS = 32;
const PROFILES: readonly AudioProfile[] = ['asphalt', 'kerb', 'concrete'];
const clamp01 = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
const positive = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, value) : 0;
const approach = (
  value: number,
  target: number,
  dt: number,
  attack: number,
  release: number,
): number =>
  value +
  (target - value) * (1 - Math.exp(-dt / (target > value ? attack : release)));

export interface AudioDirectorOptions {
  tuning: TuningStore;
  readTelemetry: () => Readonly<AudioTelemetry>;
  readPaused: () => boolean;
  /** F0's nonthrowing canonical resolver; unavailable surfaces remain silent. */
  resolveGroundedSurface: (
    grounded: boolean,
    surfaceId: number | null,
  ) => AudioSurface | null;
  output: AudioOutput;
  settings: AudioSettings;
}

/** Physics hooks only copy/aggregate scalars into fixed storage. All audio API
 * work happens in update(), after simulation, or explicit user/lifecycle calls. */
export class AudioDirector {
  private readonly mix: AudioMix = {
    engineIdle: 0,
    engineLoad: 0,
    engineRate: 0.65,
    tyres: new Float64Array(3),
    boost: 0,
    rate: 1,
    volume: 0,
  };
  private readonly tyreTargets = new Float64Array(3);
  private readonly impactGains = new Float64Array(QUEUE_SIZE);
  private readonly impactProfiles = new Uint8Array(QUEUE_SIZE);
  private readonly pairIds = new Float64Array(PAIR_SLOTS).fill(-1);
  private readonly pairTimes = new Float64Array(PAIR_SLOTS).fill(-Infinity);
  private pairCursor = 0;
  private queued = 0;
  private simulationTime = 0;
  private lastUpdate = NaN;
  private paused = true;
  private speed = 0;
  private throttle = 0;
  private boost = 0;
  private boostHeld = false;
  private boostAttack = false;
  private disposed = false;
  private readonly mutableState = {
    status: 'loading' as AudioStatus,
    masterMuted: false,
    persistenceAvailable: true,
    paused: true,
    droppedImpacts: 0,
    unresolvedWheels: 0,
    estimatedImpacts: 0,
  };

  constructor(private readonly deps: AudioDirectorOptions) {
    this.mutableState.masterMuted = deps.settings.masterMuted;
    this.mutableState.persistenceAvailable = deps.settings.persistenceAvailable;
    deps.output.setMasterMuted(deps.settings.masterMuted);
  }

  get state(): Readonly<typeof this.mutableState> {
    return this.mutableState;
  }
  get outputState(): AudioOutput['state'] {
    return this.deps.output.state;
  }

  afterStep(dtSeconds: number): void {
    if (this.disposed) return;
    this.simulationTime += positive(dtSeconds);
    const telemetry = this.deps.readTelemetry();
    this.speed = positive(telemetry.speed);
    this.throttle = clamp01(telemetry.throttle);
    this.boost = clamp01(telemetry.boostEnvelope);
    const boosting = this.boost > 0.05;
    if (boosting && !this.boostHeld && this.canEmit()) this.boostAttack = true;
    this.boostHeld = boosting;
    this.tyreTargets.fill(0);
    this.mutableState.unresolvedWheels = 0;
    const wheels = telemetry.wheels;
    for (let index = 0; index < wheels.length; index++) {
      const wheel = wheels[index]!;
      if (!wheel.grounded || !(wheel.Fz > 0)) continue;
      const surface = this.deps.resolveGroundedSurface(
        wheel.grounded,
        wheel.surfaceId,
      );
      if (!surface) {
        this.mutableState.unresolvedWheels++;
        continue;
      }
      // vy is actual lateral contact speed; a locked tyre also slides along vx.
      // There is no wheel angular-speed telemetry. Spinning supplies only a
      // bounded longitudinal-slip proxy, gated by contact speed and real load.
      const travel = Math.hypot(wheel.vx, wheel.vy);
      const slide =
        Math.abs(wheel.vy) +
        (wheel.locked ? Math.abs(wheel.vx) : 0) +
        (wheel.spinning ? Math.min(4, travel * 0.25) : 0);
      const gain =
        clamp01((slide - 0.5) / 10) *
        clamp01(travel / 3) *
        clamp01(wheel.Fz / 5000);
      const profile =
        surface.audioProfile === 'asphalt'
          ? 0
          : surface.audioProfile === 'kerb'
            ? 1
            : 2;
      this.tyreTargets[profile] = Math.min(
        1,
        this.tyreTargets[profile]! + gain * 0.4,
      );
    }
  }

  /** Borrowed normal points out of the other surface into our vehicle. Body ID
   * distinguishes scrape cooldowns; callers resolve the contact profile via F0. */
  onImpact(
    otherBodyId: number,
    profile: AudioProfile | null,
    impulse: number | null,
    normalWorld: Readonly<{ x: number; y: number; z: number }>,
    massKg: number,
  ): void {
    if (
      this.disposed ||
      !profile ||
      !this.canEmit() ||
      !Number.isFinite(otherBodyId)
    )
      return;
    let severity: number;
    if (impulse !== null && Number.isFinite(impulse)) {
      severity = positive(impulse) / Math.max(1, positive(massKg));
    } else {
      const velocity = this.deps.readTelemetry().velocity;
      // Uses pre-step vehicle velocity against a static obstacle; this is
      // estimated approach speed, not a measured solved contact impulse.
      severity = positive(
        -(
          velocity.x * normalWorld.x +
          velocity.y * normalWorld.y +
          velocity.z * normalWorld.z
        ),
      );
      this.mutableState.estimatedImpacts++;
    }
    const gain = clamp01((severity - 0.8) / 18);
    if (gain <= 0) return;
    let slot = -1;
    for (let index = 0; index < PAIR_SLOTS; index++) {
      if (this.pairIds[index] === otherBodyId) {
        slot = index;
        break;
      }
    }
    if (slot >= 0 && this.simulationTime - this.pairTimes[slot]! < 0.12) return;
    if (slot < 0) {
      slot = this.pairCursor;
      this.pairCursor = (slot + 1) % PAIR_SLOTS;
    }
    this.pairIds[slot] = otherBodyId;
    this.pairTimes[slot] = this.simulationTime;
    if (this.queued === QUEUE_SIZE) {
      this.mutableState.droppedImpacts++;
      return;
    }
    this.impactGains[this.queued] = gain;
    this.impactProfiles[this.queued] =
      profile === 'asphalt' ? 0 : profile === 'kerb' ? 1 : 2;
    this.queued++;
  }

  update(nowMs: number): void {
    if (this.disposed) return;
    const dt = Number.isFinite(this.lastUpdate)
      ? Math.max(0, Math.min(0.1, (nowMs - this.lastUpdate) / 1000))
      : 1 / 60;
    this.lastUpdate = nowMs;
    this.mutableState.status = this.outputState.status;
    const paused = this.deps.readPaused();
    this.mutableState.paused = paused;
    if (paused) {
      if (!this.paused) this.deps.output.pause(30);
      this.paused = true;
      this.discardEvents();
      this.mix.engineIdle = this.mix.engineLoad = this.mix.boost = 0;
      this.mix.tyres.fill(0);
      return;
    }
    this.paused = false;
    const mix = this.mix;
    mix.volume = this.deps.tuning.get('sfxVolume');
    const targetRate = Math.max(
      0.5,
      Math.min(Math.SQRT2, Math.sqrt(this.deps.tuning.get('timeScale'))),
    );
    mix.rate = approach(mix.rate, targetRate, dt, 0.1, 0.1);
    // A synthetic speed/load note, not engine RPM: the vehicle has no gearbox.
    mix.engineRate = approach(
      mix.engineRate,
      Math.min(2.8, 0.65 + this.speed / 45 + this.throttle * 0.35),
      dt,
      0.08,
      0.16,
    );
    mix.engineIdle = approach(
      mix.engineIdle,
      0.22 * (1 - this.throttle * 0.75),
      dt,
      0.05,
      0.1,
    );
    mix.engineLoad = approach(
      mix.engineLoad,
      0.34 * this.throttle,
      dt,
      0.05,
      0.12,
    );
    mix.boost = approach(mix.boost, this.boost * 0.3, dt, 0.04, 0.12);
    for (let index = 0; index < 3; index++)
      mix.tyres[index] = approach(
        mix.tyres[index]!,
        this.tyreTargets[index]!,
        dt,
        0.04,
        0.18,
      );
    this.deps.output.apply(mix);
    this.mutableState.status = this.outputState.status;
    if (this.canEmit() && this.outputState.status === 'ready') {
      if (this.boostAttack)
        this.deps.output.playBoostAttack(0.45 * mix.volume, mix.rate);
      for (let index = 0; index < this.queued; index++)
        this.deps.output.playImpact(
          PROFILES[this.impactProfiles[index]!]!,
          this.impactGains[index]! * mix.volume,
          mix.rate,
        );
    }
    // Locked, muted, zero-volume and paused events are never replayed later.
    this.discardEvents();
  }

  unlock(): void {
    if (!this.disposed) this.deps.output.unlock();
  }
  setMasterMuted(muted: boolean): void {
    if (this.disposed) return;
    this.deps.settings.setMasterMuted(muted);
    this.mutableState.masterMuted = muted;
    this.mutableState.persistenceAvailable =
      this.deps.settings.persistenceAvailable;
    this.deps.output.setMasterMuted(muted);
    this.discardEvents();
    if (muted) this.deps.output.reset();
  }
  toggleMasterMute(): void {
    this.setMasterMuted(!this.mutableState.masterMuted);
  }

  reset(): void {
    this.discardEvents();
    this.pairIds.fill(-1);
    this.pairTimes.fill(-Infinity);
    this.pairCursor = 0;
    this.simulationTime = this.speed = this.throttle = this.boost = 0;
    this.boostHeld = false;
    this.tyreTargets.fill(0);
    this.mix.engineIdle = this.mix.engineLoad = this.mix.boost = 0;
    this.mix.tyres.fill(0);
    this.lastUpdate = NaN;
    this.deps.output.reset();
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.discardEvents();
    this.deps.output.dispose();
  }
  private canEmit(): boolean {
    return (
      !this.deps.readPaused() &&
      !this.mutableState.masterMuted &&
      this.deps.tuning.get('sfxVolume') > 0
    );
  }
  private discardEvents(): void {
    this.queued = 0;
    this.boostAttack = false;
  }
}
