import { TuningStore } from '../tuning/store';
import {
  parseInputScript,
  parseScriptHeader,
  type InputScript,
  type ScriptFrame,
  type ScriptHeader,
  type ScriptSpawn,
} from './scriptFormat';
import type { StepInput } from './types';

/** Boot certifies a real reset; every completed physics step consumes that eligibility. */
export class InputScriptRecorder {
  private readonly values: Float64Array;
  private readonly flags: Uint8Array;
  private readonly unsubscribe: () => void;
  private fresh: ScriptHeader | undefined;
  private header: ScriptHeader | undefined;
  private error: Error | undefined;
  private count = 0;

  constructor(
    private readonly store: TuningStore,
    readonly capacitySteps: number,
  ) {
    if (!Number.isSafeInteger(capacitySteps) || capacitySteps < 1)
      throw new RangeError('Recording capacity must be a positive integer.');
    this.values = new Float64Array(capacitySteps * 3);
    this.flags = new Uint8Array(capacitySteps);
    this.unsubscribe = store.onChange((change) => {
      this.fresh = undefined;
      if (this.header)
        this.error = new Error(
          'Tuning changed during recording: ' + change.key,
        );
    });
  }

  get active(): boolean {
    return this.header !== undefined;
  }
  get completedSteps(): number {
    return this.count;
  }

  /** Call only after the engine's actual synchronous fresh respawn, never from a pose guess. */
  noteRespawn(spawn: ScriptSpawn, seed: number): void {
    if (this.active)
      this.fail(
        'Respawn interrupted the recording; cancel it before starting again.',
      );
    this.fresh = parseScriptHeader({
      version: 1,
      name: 'Recording',
      seed,
      spawn,
      tuning: this.store.snapshot(),
    });
    this.error = undefined;
  }

  start(name: string): ScriptHeader {
    if (this.active) throw new Error('An input recording is already active.');
    if (!this.fresh)
      throw new Error(
        'V1 recording requires an explicit fresh respawn with no subsequent physics steps; mid-drive recording is unsupported.',
      );
    this.header = parseScriptHeader({ ...this.fresh, name });
    this.error = undefined;
    this.count = 0;
    return this.header;
  }

  /** Call once in every postStep, even when not recording. Input is the mapper's sampled state. */
  recordStep(input: Readonly<StepInput>): void {
    this.fresh = undefined;
    if (!this.active) return;
    if (this.error) throw this.error;
    if (this.count === this.capacitySteps)
      this.fail(
        'Recording capacity exceeded; no truncated script will be exported.',
      );
    if (
      !Number.isFinite(input.throttle) ||
      input.throttle < 0 ||
      input.throttle > 1 ||
      !Number.isFinite(input.brake) ||
      input.brake < 0 ||
      input.brake > 1 ||
      !Number.isFinite(input.steer) ||
      Math.abs(input.steer) > 1 ||
      typeof input.handbrake !== 'boolean' ||
      typeof input.boost !== 'boolean' ||
      (input.source !== 'keyboard' && input.source !== 'gamepad')
    )
      this.fail('Invalid input cannot be recorded.');
    const offset = this.count * 3;
    this.values[offset] = input.throttle;
    this.values[offset + 1] = input.brake;
    this.values[offset + 2] = input.steer;
    this.flags[this.count] =
      Number(input.handbrake) |
      (Number(input.boost) << 1) |
      (Number(input.source === 'gamepad') << 2);
    this.count++;
  }

  stop(): InputScript {
    if (this.error) throw this.error;
    if (!this.header || this.count === 0)
      throw new Error('No completed physics steps have been recorded.');
    const frames: ScriptFrame[] = [];
    for (let step = 0; step < this.count; step++) {
      const offset = step * 3;
      if (
        step > 0 &&
        this.flags[step] === this.flags[step - 1] &&
        this.values[offset] === this.values[offset - 3] &&
        this.values[offset + 1] === this.values[offset - 2] &&
        this.values[offset + 2] === this.values[offset - 1]
      )
        continue;
      const flags = this.flags[step]!;
      frames.push({
        step,
        input: {
          throttle: this.values[offset]!,
          brake: this.values[offset + 1]!,
          steer: this.values[offset + 2]!,
          handbrake: Boolean(flags & 1),
          boost: Boolean(flags & 2),
          source: flags & 4 ? 'gamepad' : 'keyboard',
        },
      });
    }
    const result = parseInputScript({
      ...this.header,
      durationSteps: this.count,
      frames,
    });
    this.cancel();
    return result;
  }

  cancel(): void {
    this.header = undefined;
    this.fresh = undefined;
    this.error = undefined;
    this.count = 0;
  }
  dispose(): void {
    this.cancel();
    this.unsubscribe();
  }
  private fail(message: string): never {
    this.error = new Error(message);
    throw this.error;
  }
}
