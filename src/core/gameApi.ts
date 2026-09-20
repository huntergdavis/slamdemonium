import type { PhysicsSpikeResult } from '../physics/spike';
import type { PhysicsMemory } from '../physics/adapter';
import type { PerformanceBatch } from './performance';

export interface GameInput {
  throttle: number;
  brake: number;
  steer: number;
  handbrake: boolean;
  boost: boolean;
}

/** Stable automation surface; later work packages wire the runtime operations. */
export interface GameTestApi {
  ready: boolean;
  tuning: {
    get(key: string): number;
    set(key: string, value: number): void;
    applyPreset(name: string): void;
  };
  setInput(input: Partial<GameInput>): void;
  releaseInput(): void;
  /** [0,1] earned boost meter; lets a tuner exercise boost without first drifting. */
  setDriftMeter(value: number): void;
  stepMany(steps: number): void;
  getTelemetry(): Readonly<Record<string, unknown>>;
  respawn(): void;
  runPhysicsSpike?: () => Promise<PhysicsSpikeResult>;
  /** Optional diagnostics; scenario input continues through the standard API. */
  perf?: {
    start(totalSteps: number): void;
    setPaused(paused: boolean): void;
    pauseSimulation(paused: boolean): void;
    setStepDriver(driver: ((step: number) => void) | undefined): void;
    progress(): { completedSteps: number; totalSteps: number; done: boolean };
    drain(): PerformanceBatch;
    getMemory(): PhysicsMemory;
  };
  /** WP11 contract; JSON validation and playback belong to src/input. */
  scripts?: {
    load(script: unknown, options: { tuning: 'apply' | 'verify' }): void;
    progress(): { completedSteps: number; totalSteps: number; done: boolean };
    cancel(): void;
  };
}

function unavailable(): never {
  throw new Error('The gameplay API is not wired yet (WP0 scaffold).');
}

export function createGameStub(): GameTestApi {
  return {
    ready: false,
    tuning: { get: unavailable, set: unavailable, applyPreset: unavailable },
    setInput: unavailable,
    releaseInput: unavailable,
    setDriftMeter: unavailable,
    stepMany: unavailable,
    getTelemetry: unavailable,
    respawn: unavailable,
  };
}

declare global {
  interface Window {
    __game: GameTestApi;
  }
}
