import { InputMapper } from './mapper';
import { TuningStore } from '../tuning/store';
import {
  InputScriptPlayer,
  type ScriptLoadOptions,
  type ScriptReset,
} from './scriptPlayer';
import { InputScriptRecorder } from './scriptRecorder';
import {
  ReplayMetrics,
  type ReplayTelemetry,
  type ReplayResult,
} from './scriptAssertions';
import {
  RingLapTimer,
  type LapProgress,
  type RingLapOptions,
} from './lapTimer';
import type {
  InputScript,
  ScriptHeader,
  ScriptProgress,
  ScriptSpawn,
} from './scriptFormat';
import type { StepInput } from './types';

export * from './scriptFormat';
export * from './scriptPlayer';
export * from './scriptRecorder';
export * from './scriptAssertions';
export * from './lapTimer';

export interface ScriptControllerOptions {
  store: TuningStore;
  mapper: InputMapper;
  /** Synchronously flush/cancel mass work, apply current tuning, and reset all vehicle state. */
  reset: ScriptReset;
  /** Return Vehicle.telemetry directly, after Vehicle.postStep; never an allocating API snapshot. */
  readTelemetry: () => ReplayTelemetry;
  /** Gate further loop steps immediately, including remaining steps in the current RAF batch. */
  onComplete: () => void;
  onError?: (error: Error) => void;
  recordingCapacitySteps?: number;
  /** Ring the lap timer measures; default is the lab ring. Boot passes the
   * loaded map's radii so laps count on whichever ring the car is on. */
  ring?: Pick<
    RingLapOptions,
    'centerLineRadius' | 'innerRadius' | 'outerRadius'
  >;
}

/** Boot exposes this instance as game.scripts and calls afterStep at every completed step. */
export class ScriptController {
  private readonly player: InputScriptPlayer;
  private readonly recorder: InputScriptRecorder;
  private readonly metrics = new ReplayMetrics();
  private readonly detach: () => void;
  private lap: RingLapTimer | undefined;
  private sampled = false;
  private error: Error | undefined;

  constructor(private readonly options: ScriptControllerOptions) {
    this.player = new InputScriptPlayer(options.store, options.reset);
    this.recorder = new InputScriptRecorder(
      options.store,
      options.recordingCapacitySteps ?? 72_000,
    );
    this.detach = options.mapper.attachScriptProcessor(this.processSample);
  }

  load(source: unknown, options: ScriptLoadOptions): void {
    if (this.sampled)
      throw new Error('Load a script between completed physics steps.');
    if (this.recorder.active)
      throw new Error(
        'Stop or cancel the active recording before loading a replay.',
      );
    this.player.load(source, options);
    const script = this.player.document!;
    this.recorder.cancel();
    this.recorder.noteRespawn(script.spawn, script.seed);
    this.resetCapture(script);
    this.error = undefined;
  }

  progress(): Readonly<ScriptProgress> {
    this.check();
    return this.player.progress();
  }
  canStep(): boolean {
    this.check();
    return !this.player.armed || !this.player.progress().done;
  }
  result(): ReplayResult {
    this.check();
    return this.metrics.snapshot();
  }
  lapProgress(): Readonly<LapProgress> | undefined {
    this.check();
    return this.lap?.progress;
  }

  /** Called by boot only after a real fresh respawn, including the live R action. */
  noteRespawn(spawn: ScriptSpawn, seed: number): void {
    if (this.player.armed)
      throw new Error('Cancel replay before an external respawn.');
    this.recorder.noteRespawn(spawn, seed);
  }

  startRecording(name: string): void {
    this.check();
    if (this.player.armed)
      throw new Error(
        'Cancel playback and explicitly respawn before recording.',
      );
    this.resetCapture(this.recorder.start(name));
  }

  stopRecording(): InputScript {
    this.check();
    return this.recorder.stop();
  }
  get recording(): boolean {
    return this.recorder.active;
  }
  get recordedSteps(): number {
    return this.recorder.completedSteps;
  }

  afterStep(): void {
    this.check();
    if (!this.sampled)
      throw new Error(
        'Script controller postStep requires a real InputMapper.sampleForStep call.',
      );
    this.sampled = false;
    try {
      const capture = this.player.armed || this.recorder.active;
      this.recorder.recordStep(this.options.mapper.state);
      if (this.player.armed) this.player.afterStep();
      if (capture) {
        const telemetry = this.options.readTelemetry();
        this.metrics.record(telemetry);
        if (!this.metrics.current.allFinite)
          throw new Error(
            'Non-finite replay telemetry at completed step ' +
              this.metrics.current.completedSteps,
          );
        this.lap?.update(
          telemetry.position,
          this.metrics.current.completedSteps,
        );
      }
      if (this.player.armed && this.player.progress().done)
        this.options.onComplete();
    } catch (error) {
      this.fail(error);
    }
  }

  cancel(): void {
    this.player.cancel();
    this.recorder.cancel();
    this.error = undefined;
    this.sampled = false;
    this.lap = undefined;
  }

  dispose(): void {
    this.cancel();
    this.detach();
    this.player.dispose();
    this.recorder.dispose();
  }

  private readonly processSample = (sample: StepInput): void => {
    this.check();
    if (this.sampled)
      throw new Error('Input sampled twice without completing a physics step.');
    if (this.player.armed) this.player.sampleInto(sample);
    this.sampled = true;
  };

  private resetCapture(header: ScriptHeader): void {
    this.metrics.reset(
      header.spawn,
      this.options.readTelemetry().recoveryCount ?? 0,
    );
    this.lap = new RingLapTimer({
      physicsHz: header.tuning.physicsHz,
      ...this.options.ring,
    });
    this.lap.reset(header.spawn.position);
  }

  private check(): void {
    if (this.error) throw this.error;
    try {
      this.player.progress();
      this.recorder.assertHealthy();
    } catch (error) {
      this.fail(error);
    }
  }

  private fail(error: unknown): never {
    this.error = error instanceof Error ? error : new Error(String(error));
    this.options.onError?.(this.error);
    throw this.error;
  }
}
