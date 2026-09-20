import { Quaternion, Vector3 } from 'three';
import type { TransformState } from '../core/transforms';
import type { VehicleTelemetry } from './telemetry';

class WheelVisual {
  readonly centerLocal = new Vector3();
  readonly contactPointWorld = new Vector3();
  readonly tireForceWorld = new Vector3();
  steerAngle = 0;
  spinAngle = 0;
  grounded = false;
  spinning = false;
  locked = false;
}
export function wrapSpin(angle: number): number {
  const turn = 2 * Math.PI;
  return ((angle % turn) + turn) % turn;
}
/** Structural match for D4: interpolate physical spin advance before wrapping. */
export class VehicleVisualHistory {
  readonly state = {
    position: new Vector3(),
    rotation: new Quaternion(),
    velocityWorld: new Vector3(),
    brake01: 0,
    handbrake01: 0,
    wheels: [
      new WheelVisual(),
      new WheelVisual(),
      new WheelVisual(),
      new WheelVisual(),
    ] as const,
  };
  private readonly previous = [
    new WheelVisual(),
    new WheelVisual(),
    new WheelVisual(),
    new WheelVisual(),
  ];
  constructor(private readonly telemetry: VehicleTelemetry) {
    this.beforeStep();
  }
  beforeStep(): void {
    for (let i = 0; i < 4; i++) {
      const from = this.telemetry.wheels[i]!,
        to = this.previous[i]!;
      to.centerLocal.copy(from.centerLocal);
      to.steerAngle = from.steerAngle;
      to.spinAngle = from.spinAngle;
    }
  }
  reset(): void {
    this.beforeStep();
  }
  interpolate(alpha: number, pose: TransformState) {
    const s = this.state,
      telemetry = this.telemetry;
    s.position.copy(pose.position);
    s.rotation.copy(pose.rotation);
    s.velocityWorld.copy(telemetry.velocity);
    s.brake01 = telemetry.brake01;
    s.handbrake01 = telemetry.handbrake01;
    for (let i = 0; i < 4; i++) {
      const wheel = telemetry.wheels[i]!,
        previous = this.previous[i]!,
        out = s.wheels[i]!;
      out.centerLocal.lerpVectors(
        previous.centerLocal,
        wheel.centerLocal,
        alpha,
      );
      out.steerAngle =
        previous.steerAngle + (wheel.steerAngle - previous.steerAngle) * alpha;
      out.spinAngle = wrapSpin(previous.spinAngle + wheel.spinDelta * alpha);
      out.contactPointWorld.copy(wheel.contactPoint);
      out.tireForceWorld.copy(wheel.tireForceWorld);
      out.grounded = wheel.grounded;
      out.spinning = wheel.spinning;
      out.locked = wheel.locked;
    }
    return s;
  }
}
