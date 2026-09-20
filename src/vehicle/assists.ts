import { DEG, VEHICLE_GEOMETRY } from './constants';
import { clamp, moveToward, smoothstep, wrapPi } from './math';

export function gripYawTorque(
  steer: number,
  lock: number,
  vLong: number,
  speed: number,
  beta: number,
  yawRate: number,
  lateralCapacity: number,
  grounded: number,
  strength: number,
  inertia: number,
): number {
  if (grounded < 3) return 0;
  const gate = smoothstep(3, 10, Math.abs(vLong));
  const grip = 1 - smoothstep(6 * DEG, 14 * DEG, Math.abs(beta));
  const target =
    steer *
    Math.min(
      (vLong * Math.tan(lock)) / VEHICLE_GEOMETRY.wheelbase,
      lateralCapacity / Math.max(speed, 1),
    );
  return (
    strength * gate * grip * inertia * clamp((target - yawRate) / 0.15, -12, 12)
  );
}

/** Approved docs/research/drift-assist.md replacement for design 6.8 C. */
export class DriftAssist {
  side = 0;
  holdAngle = 0;
  target = 0;
  betaDot = 0;
  private previousBeta = 0;
  private exitTime = 0;
  reset(): void {
    this.side =
      this.holdAngle =
      this.target =
      this.betaDot =
      this.previousBeta =
      this.exitTime =
        0;
  }
  torque(
    dt: number,
    beta: number,
    vLong: number,
    grounded: number,
    steer: number,
    throttle: number,
    handbrake: boolean,
    maximum: number,
    strength: number,
    inertia: number,
  ): number {
    if (grounded < 3 || vLong <= 3 || strength === 0) {
      this.reset();
      return 0;
    }
    if (this.side && this.side * beta <= 0) {
      this.reset();
      return 0; // Opposite drift must earn its own entry on a subsequent step.
    }
    if (this.side) {
      this.exitTime = Math.abs(beta) < 6 * DEG ? this.exitTime + dt : 0;
      if (this.exitTime + 1e-10 >= 0.1) {
        this.reset();
        return 0;
      }
    } else {
      if (
        Math.abs(beta) < 10 * DEG ||
        !(handbrake || (throttle > 0.2 && Math.abs(steer) > 0.1))
      )
        return 0;
      this.side = Math.sign(beta);
      this.holdAngle = clamp(
        Math.abs(beta),
        14 * DEG,
        Math.min(30 * DEG, maximum),
      );
      this.target = this.previousBeta = beta;
      this.betaDot = 0;
    }
    this.holdAngle = Math.min(this.holdAngle, maximum);
    const u = clamp(this.side * steer, -1, 1);
    const angle =
      u >= 0
        ? this.holdAngle + (maximum - this.holdAngle) * u
        : this.holdAngle * (1 + u);
    const wanted =
      this.side * angle * (handbrake ? 1 : smoothstep(0.05, 0.25, throttle));
    this.target = moveToward(this.target, wanted, 90 * DEG * dt);
    const derivative = wrapPi(beta - this.previousBeta) / dt;
    this.betaDot += (1 - Math.exp(-dt / 0.05)) * (derivative - this.betaDot);
    this.previousBeta = beta;
    const track = 25 * (this.target - beta) - 10 * this.betaDot;
    const excess = Math.max(0, Math.abs(beta) - maximum);
    const outward = Math.max(0, Math.sign(beta) * this.betaDot);
    const limit =
      -Math.sign(beta) *
      smoothstep(maximum, 1.15 * maximum, Math.abs(beta)) *
      (60 * excess + 10 * outward);
    return (
      inertia *
      strength *
      smoothstep(3, 10, vLong) *
      smoothstep(6 * DEG, 14 * DEG, Math.abs(beta)) *
      clamp(track + limit, -15, 15)
    );
  }
}
