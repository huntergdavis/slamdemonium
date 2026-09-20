import type { ParamPatch } from './schema';

/** Section 7.3: apply each partial map over defaults, never over the previous preset. */
export const BUILTIN_PRESETS = {
  Default: {},
  Grip: {
    gripFront: 1.9, gripRear: 1.9, slideGripRatio: 0.92, slipFalloffRate: 0.7,
    handbrakeRearGrip: 0.5, yawAssist: 0.2, countersteerAssist: 0.3,
  },
  Drifty: {
    gripRear: 1.25, slideGripRatio: 0.60, slipFalloffRate: 2.5,
    handbrakeRearGrip: 0.20, driveBias: 0.8, yawAssist: 0.6,
    countersteerAssist: 0.8, driftChargeRate: 0.6,
  },
  Raw: {
    yawAssist: 0, countersteerAssist: 0, tireRelaxationLength: 0.9,
    downforceAtTopSpeed: 0.2, steerExpo: 0, absStrength: 0, camVelocityBlend: 0,
  },
} as const satisfies Record<string, ParamPatch>;

export type BuiltinPresetName = keyof typeof BUILTIN_PRESETS;
