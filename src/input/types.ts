import type { GameInput } from '../core/gameApi';

export const INPUT_ACTIONS = [
  'respawn',
  'options',
  'hud',
  'gizmos',
  'camera',
  'slowMotion',
  'pause',
  'latencyProbe',
  'swapAB',
  'recordTelemetry',
] as const;
export type InputAction = (typeof INPUT_ACTIONS)[number];
/** Counts this step, rather than held flags: a short press between steps is retained. */
export type ActionCounts = Record<InputAction, number>;
export interface StepInput extends GameInput {
  source: 'keyboard' | 'gamepad';
  actions: ActionCounts;
}
export function createActionCounts(): ActionCounts {
  return {
    respawn: 0,
    options: 0,
    hud: 0,
    gizmos: 0,
    camera: 0,
    slowMotion: 0,
    pause: 0,
    latencyProbe: 0,
    swapAB: 0,
    recordTelemetry: 0,
  };
}
