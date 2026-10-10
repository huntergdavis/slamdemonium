import type { PhysicsSpikeResult } from '../physics/spike';
import type { PhysicsMemory, V3 } from '../physics/adapter';
import type { PaceReport, PerformanceBatch } from './performance';
import type { CameraPreset } from '../render/cameraRig';
import type { ScriptController } from '../input/script';
import type { HudMode } from '../ui/hud';
import type { RoadRageState } from './roadRage';
import type { RaceState } from './raceEvent';

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
  /** Fill earned boost units, up to the current section capacity. */
  setDriftMeter(value: number): void;
  setCameraPreset(preset: CameraPreset): void;
  /** Optional fixed pose for repeatable browser inspection; null restores follow. */
  setInspectionCamera(pose: { position: V3; target: V3 } | null): void;
  setHudMode(mode: HudMode): void;
  setOptionsOpen(open: boolean): void;
  stepMany(steps: number): void;
  getTelemetry(): Readonly<Record<string, unknown>>;
  /** Traffic cars in play, for headless instruments; absent without traffic. */
  getTraffic?: () => readonly Readonly<Record<string, unknown>>[];
  /** Sampled centreline for a browser route gate; never mutates the map. */
  getRoadPath?: () => {
    points: readonly (readonly [number, number])[];
    step: number;
    closed: boolean;
  } | null;
  /** Visual-only trim pieces in the bounded wreck presentation pool. */
  getWreckEffects?: () => {
    activePanels: number;
    sparks: number;
    metal: number;
    glass: number;
    bursts: number;
    grinds: number;
    dropped: number;
  };
  /** Read-only rival controller decisions for hosted diagnosis. */
  getRivalControl?: () => Readonly<Record<string, unknown>> | null;
  /** Read-only circuit-race standings and controller targets for hosted gates. */
  getRace?: () => {
    state: Readonly<RaceState>;
    order: readonly number[];
    cars: readonly Readonly<Record<string, unknown>>[];
  };
  /** Read-only takedown state for hosted driving checks. */
  getTakedowns?: () => { count: number; boostSections: number };
  /** Read-only timed takedown event state for built-browser guards. */
  getRoadRage?: () => Readonly<RoadRageState>;
  /** Read-only player wreck budget for hosted takedown-road inspection. */
  getPlayerDamage?: () => {
    amount: number;
    wrecked: boolean;
    secondsLeft: number;
    crush: { front: number; rear: number; left: number; right: number };
  };
  /** Stage a real player-to-rival closing hit for hosted inspection. */
  stageRivalTakedown?: () => number;
  /** Test-only pooled-body impact for matched browser performance gates. */
  stageTrafficPileup?: (count?: number) => readonly number[];
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
    pace(): PaceReport | null;
    getMemory(): PhysicsMemory;
  };
  /** WP11 contract; JSON validation and playback belong to src/input. */
  scripts?: Pick<
    ScriptController,
    | 'load'
    | 'progress'
    | 'cancel'
    | 'result'
    | 'lapProgress'
    | 'startRecording'
    | 'stopRecording'
    | 'recording'
    | 'recordedSteps'
  >;
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
    setCameraPreset: unavailable,
    setInspectionCamera: unavailable,
    setHudMode: unavailable,
    setOptionsOpen: unavailable,
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
