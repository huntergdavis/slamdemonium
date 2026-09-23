import { MIN_COUNTED_AIR_SECONDS } from './airState';

/** Player pitch and roll authority off the ground, plus self-levelling.
 * Pure: the vehicle passes body-frame scalars in and applies the torques.
 *
 * Gate and ramp: authority is zero until the car has been airborne for the
 * kerb-hop threshold and then fades in over a further ramp, and the caller
 * passes airTime 0 the moment any wheel touches. A car skimming in and out of
 * contact over a kerb therefore never receives rotation authority, which is
 * the edge that would feel broken without being reproducible.
 *
 * Pitch reads the CHANGE in throttle since takeoff, not the raw pedal: a
 * player who holds full throttle through every jump for speed gets a neutral
 * nose; lifting off dips it; pressing beyond the takeoff level or holding
 * brake pitches it. Raw throttle (the arcade convention) would make the
 * common case permanently nose-high. Roll reads steer: steer left banks left.
 * No yaw authority in the air; handbrake is inert. */
export interface AirControlInputs {
  throttle: number;
  brake: number;
  /** Positive steers left. */
  steer: number;
  throttleAtTakeoff: number;
}
export interface AirControlTuning {
  /** Target rotation rate at full input, turns per second. */
  authorityTurnsPerSecond: number;
  /** Torque toward wheels-down with no input, 0 disables (the skilful option). */
  autoLevel: number;
}
/** Body-frame attitude and rates, in the vehicle's own conventions. Pitch
 * is asin(forward.y): positive nose-up, and a positive rate about the right
 * axis raises the nose. Roll is atan2(right.y, up.y): positive with the
 * RIGHT side UP, and a positive rate about the forward axis LOWERS the right
 * side, so it decreases roll. Restoring torques therefore have opposite
 * signs on the two axes; the vehicle's grounded righting assist uses the
 * same roll convention. */
export interface AirAttitude {
  pitchAngle: number;
  rollAngle: number;
  pitchRate: number;
  rollRate: number;
  inertiaPitch: number;
  inertiaRoll: number;
}
export interface AirControlTorques {
  /** About the right axis (positive nose-up) and the forward axis. */
  pitch: number;
  roll: number;
  /** 0..1 authority weight actually applied this step, for telemetry/tests. */
  weight: number;
}

export const AIR_CONTROL_GATE_SECONDS = MIN_COUNTED_AIR_SECONDS;
export const AIR_CONTROL_RAMP_SECONDS = 0.15;
/** Rate-tracking gain: the target rate is reached in roughly an eighth of a second. */
const RATE_GAIN = 8;
const LEVEL_ANGLE_GAIN = 8;
const LEVEL_RATE_GAIN = 2;
/** Angular acceleration ceiling per axis, rad/s^2, well inside the 12 rad/s clamp. */
const MAX_ACCELERATION = 40;

const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(high, value));

export function airControlWeight(airTime: number): number {
  return clamp(
    (airTime - AIR_CONTROL_GATE_SECONDS) / AIR_CONTROL_RAMP_SECONDS,
    0,
    1,
  );
}

export function airControlTorques(
  airTime: number,
  inputs: Readonly<AirControlInputs>,
  attitude: Readonly<AirAttitude>,
  tuning: Readonly<AirControlTuning>,
  out: AirControlTorques,
): AirControlTorques {
  const weight = airControlWeight(airTime);
  out.weight = weight;
  if (weight <= 0) {
    out.pitch = out.roll = 0;
    return out;
  }
  const pitchInput = clamp(
    inputs.throttle - inputs.throttleAtTakeoff - inputs.brake,
    -1,
    1,
  );
  const rollInput = clamp(-inputs.steer, -1, 1); // Steer left banks left.
  const authority = tuning.authorityTurnsPerSecond * 2 * Math.PI;
  const pitchAccel =
    RATE_GAIN * (pitchInput * authority - attitude.pitchRate) -
    tuning.autoLevel *
      (1 - Math.abs(pitchInput)) *
      (LEVEL_ANGLE_GAIN * attitude.pitchAngle +
        LEVEL_RATE_GAIN * attitude.pitchRate);
  const rollAccel =
    RATE_GAIN * (rollInput * authority - attitude.rollRate) +
    tuning.autoLevel *
      (1 - Math.abs(rollInput)) *
      (LEVEL_ANGLE_GAIN * attitude.rollAngle -
        LEVEL_RATE_GAIN * attitude.rollRate);
  out.pitch =
    attitude.inertiaPitch *
    clamp(pitchAccel, -MAX_ACCELERATION, MAX_ACCELERATION) *
    weight;
  out.roll =
    attitude.inertiaRoll *
    clamp(rollAccel, -MAX_ACCELERATION, MAX_ACCELERATION) *
    weight;
  return out;
}
