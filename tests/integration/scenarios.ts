import { DEFAULT_VALUES } from '../../src/tuning/schema';
import {
  parseInputScript,
  type ScriptFrame,
  type ScriptInput,
} from '../../src/input/script';

export const HZ = DEFAULT_VALUES.physicsHz;
export const SETTLE = 3 * HZ;
export const IDLE: Readonly<ScriptInput> = Object.freeze({
  throttle: 0,
  brake: 0,
  steer: 0,
  handbrake: false,
  boost: false,
  source: 'gamepad',
});

export function frame(
  step: number,
  input: Partial<ScriptInput> = {},
): ScriptFrame {
  return { step, input: { ...IDLE, ...input } };
}

/** Full v1 JSON boundary, defaults unchanged; no velocity/boost-meter injection. */
export function scenario(
  name: string,
  durationSteps: number,
  frames: ScriptFrame[],
  seed = 0x51a7,
) {
  return parseInputScript(
    JSON.stringify({
      version: 1,
      name,
      seed,
      spawn: {
        position: { x: 0, y: 0.86, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
      },
      tuning: { ...DEFAULT_VALUES },
      durationSteps,
      frames,
    }),
  );
}

/** The seed authors JSON frames once. Playback does not generate or mutate input. */
export function randomScenario(seconds: number, seed = 0x51a7) {
  let randomState = seed >>> 0;
  const random = () => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState / 0x100000000;
  };
  const durationSteps = seconds * HZ;
  const frames: ScriptFrame[] = [];
  for (let step = 0; step < durationSteps; step += HZ / 2) {
    frames.push(
      frame(step, {
        throttle: random(),
        brake: random() > 0.8 ? random() : 0,
        steer: 2 * random() - 1,
        handbrake: random() > 0.9,
        boost: random() > 0.8,
      }),
    );
  }
  return scenario(
    'Seeded manoeuvres: ' + seconds + ' seconds',
    durationSteps,
    frames,
    seed,
  );
}
