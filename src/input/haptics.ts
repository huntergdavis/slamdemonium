import { resolveGroundedSurface } from '../content/surfaces';
import type { V3 } from '../physics/adapter';
import type { VehicleTelemetry } from '../vehicle/telemetry';

export interface HapticsOptions {
  readTelemetry: () => Readonly<VehicleTelemetry>;
  readActuator: () => GamepadHapticActuator | null;
  readIntensity: () => number;
  readPaused: () => boolean;
}
export interface HapticsState {
  status: 'unavailable' | 'ready' | 'active' | 'off' | 'error';
}
const clamp01 = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;

/** Feedback only. No forces, timers, promises or allocations in afterStep/onImpact.
 * Browser effects are short and rate-limited on RAF; unsupported pads still drive. */
export class ControllerHaptics {
  private readonly feedback: HapticsState = { status: 'unavailable' };
  readonly state: Readonly<HapticsState> = this.feedback;
  private actuator: GamepadHapticActuator | null = null;
  private readonly effect: GamepadEffectParameters = {
    duration: 80,
    startDelay: 0,
    strongMagnitude: 0,
    weakMagnitude: 0,
  };
  private impact = 0;
  private wheelspin = 0;
  private kerb = 0;
  private phase = 0;
  private lastSend = -Infinity;
  private playing = false;
  private failed = false;
  private generation = 0;
  private disposed = false;

  constructor(private readonly deps: HapticsOptions) {}

  afterStep(dtSeconds: number): void {
    if (this.disposed || !(dtSeconds > 0) || !Number.isFinite(dtSeconds))
      return;
    const telemetry = this.deps.readTelemetry();
    this.impact *= Math.exp(-dtSeconds * 8);
    this.wheelspin = this.kerb = 0;
    this.phase =
      (this.phase + dtSeconds * Math.min(25, 4 + telemetry.speed)) % 1;
    for (const wheel of telemetry.wheels) {
      if (!wheel.grounded) continue;
      if (wheel.spinning) this.wheelspin = 0.3;
      if (
        telemetry.speed > 0.5 &&
        resolveGroundedSurface(wheel.grounded, wheel.surfaceId)
          ?.hapticProfile === 'kerb'
      )
        this.kerb = 0.25 + 0.2 * Math.sin(this.phase * Math.PI * 2) ** 2;
    }
  }

  /** Normal points from the other surface into our vehicle. Borrowed input is
   * consumed synchronously; no live vector/telemetry reference is retained. */
  onImpact(
    impulse: number | null,
    normalWorld: Readonly<V3>,
    massKg: number,
  ): void {
    if (this.disposed || !(massKg > 0) || !Number.isFinite(massKg)) return;
    let strength: number;
    if (impulse !== null && Number.isFinite(impulse))
      strength = impulse / (massKg * 8);
    else {
      const velocity = this.deps.readTelemetry().velocity;
      // Uses pre-step vehicle velocity against a static obstacle; this is
      // estimated approach speed, not a measured solved contact impulse.
      const approach = Math.max(
        0,
        -(
          velocity.x * normalWorld.x +
          velocity.y * normalWorld.y +
          velocity.z * normalWorld.z
        ),
      );
      strength = (approach - 0.7) / 12;
    }
    this.impact = Math.max(this.impact, clamp01(strength));
  }

  update(nowMs: number): void {
    if (this.disposed) return;
    const candidate = this.deps.readActuator();
    const actuator =
      typeof candidate?.playEffect === 'function' ? candidate : null;
    if (actuator !== this.actuator) {
      this.stop();
      this.actuator = actuator;
      this.generation++;
      this.failed = false;
      this.lastSend = -Infinity;
    }
    const intensity = clamp01(this.deps.readIntensity());
    if (!intensity || this.deps.readPaused()) {
      this.stop();
      this.impact = this.wheelspin = this.kerb = 0;
      this.feedback.status = !intensity
        ? 'off'
        : actuator
          ? 'ready'
          : 'unavailable';
      return;
    }
    if (!actuator || this.failed) {
      this.feedback.status = this.failed ? 'error' : 'unavailable';
      return;
    }
    const strong = clamp01(this.impact) * intensity;
    const weak =
      clamp01(Math.max(this.wheelspin, this.kerb, this.impact * 0.5)) *
      intensity;
    if (Math.max(strong, weak) < 0.005) {
      this.stop();
      this.feedback.status = 'ready';
      return;
    }
    if (!Number.isFinite(nowMs) || nowMs - this.lastSend < 50) return;
    this.lastSend = nowMs;
    this.effect.strongMagnitude = strong;
    this.effect.weakMagnitude = weak;
    this.playing = true;
    this.feedback.status = 'active';
    const generation = this.generation;
    try {
      void actuator.playEffect('dual-rumble', this.effect).catch(() => {
        if (generation !== this.generation || this.disposed) return;
        this.failed = true;
        this.playing = false;
        this.feedback.status = 'error';
      });
    } catch {
      this.failed = true;
      this.playing = false;
      this.feedback.status = 'error';
    }
  }

  reset(): void {
    this.stop();
    this.impact = this.wheelspin = this.kerb = this.phase = 0;
    this.lastSend = -Infinity;
  }

  dispose(): void {
    this.reset();
    this.generation++;
    this.disposed = true;
    this.actuator = null;
  }

  private stop(): void {
    if (!this.playing) return;
    this.playing = false;
    try {
      void this.actuator?.reset?.().catch(() => {
        /* Unsupported/removed pad. */
      });
    } catch {
      /* Optional hardware must never interrupt gameplay. */
    }
  }
}
