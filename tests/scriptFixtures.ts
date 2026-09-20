import { DEFAULT_VALUES } from '../src/tuning/schema';
import { createActionCounts, type StepInput } from '../src/input/types';

export function scriptFixture() {
  const input = {
    throttle: 1,
    brake: 0,
    steer: 0.25,
    handbrake: false,
    boost: false,
    source: 'keyboard' as const,
  };
  return {
    version: 1,
    name: 'Standing start',
    seed: 1,
    spawn: {
      position: { x: 130, y: 0.86, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    },
    tuning: { ...DEFAULT_VALUES },
    durationSteps: 4,
    frames: [
      { step: 0, input },
      { step: 2, input: { ...input, throttle: 0, brake: 1, handbrake: true } },
    ],
  };
}
export function emptySample(): StepInput {
  return {
    throttle: 0,
    brake: 0,
    steer: 0,
    handbrake: false,
    boost: false,
    source: 'keyboard',
    actions: createActionCounts(),
  };
}
