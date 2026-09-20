import { PARAM_DEFS } from '../tuning/schema';
import { TuningStore } from '../tuning/store';
import {
  parseInputScript,
  type InputScript,
  type ScriptProgress,
  type ScriptSpawn,
  type TuningPolicy,
} from './scriptFormat';
import { INPUT_ACTIONS, type StepInput } from './types';

export interface ScriptLoadOptions {
  tuning: TuningPolicy;
}
export type ScriptReset = (spawn: ScriptSpawn, seed: number) => void;

/** No clock or parallel physics implementation: sample at preStep, complete at postStep. */
export class InputScriptPlayer {
  private script: InputScript | undefined;
  private frameIndex = 0;
  private pending = false;
  private loading = false;
  private error: Error | undefined;
  private readonly state = { completedSteps: 0, totalSteps: 0, done: false };
  private readonly unsubscribe: () => void;

  constructor(
    private readonly store: TuningStore,
    private readonly reset: ScriptReset,
  ) {
    this.unsubscribe = store.onChange((change) => {
      if (this.script && !this.state.done && !this.loading)
        this.error = new Error(
          'Replay tuning changed during playback: ' + change.key,
        );
    });
  }

  get armed(): boolean {
    return this.script !== undefined;
  }
  get document(): InputScript | undefined {
    return this.script;
  }

  load(source: unknown, options: ScriptLoadOptions): void {
    if (options?.tuning !== 'apply' && options?.tuning !== 'verify')
      throw new TypeError('Choose an explicit tuning policy: apply or verify.');
    const script = parseInputScript(source);
    if (options.tuning === 'verify') {
      const mismatch = PARAM_DEFS.find(
        (definition) =>
          this.store.get(definition.key) !== script.tuning[definition.key],
      );
      if (mismatch) throw new Error('Replay tuning mismatch: ' + mismatch.key);
    }
    this.cancel();
    this.loading = true;
    try {
      if (options.tuning === 'apply')
        this.store.replace(script.tuning, 'import');
      // Reset must synchronously apply mass and clear transient vehicle state before arming.
      this.reset(script.spawn, script.seed);
      for (const definition of PARAM_DEFS) {
        if (this.store.get(definition.key) !== script.tuning[definition.key])
          throw new Error('Reset changed replay tuning: ' + definition.key);
      }
      this.script = script;
      this.state.totalSteps = script.durationSteps;
    } finally {
      this.loading = false;
    }
  }

  sampleInto(out: StepInput): void {
    this.check();
    const script = this.script;
    if (!script) throw new Error('No input script is armed.');
    if (this.state.done)
      throw new RangeError(
        'Input script reached EOF; cancel or load another replay before stepping.',
      );
    if (this.pending)
      throw new Error('Replay sampled twice without a completed physics step.');
    while (
      this.frameIndex + 1 < script.frames.length &&
      script.frames[this.frameIndex + 1]!.step <= this.state.completedSteps
    )
      this.frameIndex++;
    const input = script.frames[this.frameIndex]!.input;
    out.throttle = input.throttle;
    out.brake = input.brake;
    out.steer = input.steer;
    out.handbrake = input.handbrake;
    out.boost = input.boost;
    out.source = input.source;
    // Live respawn, A/B, pause and time-scale commands cannot alter a replay.
    for (let index = 0; index < INPUT_ACTIONS.length; index++)
      out.actions[INPUT_ACTIONS[index]!] = 0;
    this.pending = true;
  }

  afterStep(): void {
    this.check();
    if (!this.script || !this.pending)
      throw new Error('Replay postStep has no sampled physics step.');
    this.pending = false;
    this.state.completedSteps++;
    this.state.done = this.state.completedSteps === this.state.totalSteps;
  }

  progress(): Readonly<ScriptProgress> {
    this.check();
    return this.state;
  }

  cancel(): void {
    this.script = undefined;
    this.error = undefined;
    this.pending = false;
    this.frameIndex = 0;
    this.state.completedSteps = 0;
    this.state.totalSteps = 0;
    this.state.done = false;
  }

  dispose(): void {
    this.cancel();
    this.unsubscribe();
  }

  private check(): void {
    if (this.error) throw this.error;
  }
}
