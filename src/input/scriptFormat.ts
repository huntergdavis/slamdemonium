import type { GameInput } from '../core/gameApi';
import { PARAM_DEFS, isParamKey, normalizeValue, type ParamSet } from '../tuning/schema';
import type { StepInput } from './types';

export interface ScriptSpawn {
  readonly position: Readonly<{ x: number; y: number; z: number }>;
  readonly rotation: Readonly<{ x: number; y: number; z: number; w: number }>;
}
export interface ScriptInput extends GameInput { source: StepInput['source']; }
export interface ScriptFrame { readonly step: number; readonly input: Readonly<ScriptInput>; }
export interface InputScript {
  readonly version: 1;
  readonly name: string;
  readonly seed: number;
  readonly spawn: ScriptSpawn;
  readonly tuning: Readonly<ParamSet>;
  readonly durationSteps: number;
  readonly frames: readonly ScriptFrame[];
}
export type ScriptHeader = Omit<InputScript, 'durationSteps' | 'frames'>;
export type TuningPolicy = 'apply' | 'verify';
export interface ScriptProgress {
  readonly completedSteps: number;
  readonly totalSteps: number;
  readonly done: boolean;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(label + ' must be an object.');
  return value as Record<string, unknown>;
}
function finite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(label + ' must be finite.');
  return value;
}
function integer(value: unknown, label: string, minimum = 0): number {
  const number = finite(value, label);
  if (!Number.isSafeInteger(number) || number < minimum) throw new RangeError(label + ' must be an integer >= ' + minimum + '.');
  return number;
}
function bounded(value: unknown, label: string, minimum: number, maximum: number): number {
  const number = finite(value, label);
  if (number < minimum || number > maximum) throw new RangeError(label + ' is out of range.');
  return number;
}

export function parseScriptSpawn(value: unknown): ScriptSpawn {
  const spawn = record(value, 'spawn');
  const position = record(spawn.position, 'spawn.position');
  const rotation = record(spawn.rotation, 'spawn.rotation');
  const p = Object.freeze({ x: finite(position.x, 'position.x'), y: finite(position.y, 'position.y'), z: finite(position.z, 'position.z') });
  const q = Object.freeze({ x: finite(rotation.x, 'rotation.x'), y: finite(rotation.y, 'rotation.y'), z: finite(rotation.z, 'rotation.z'), w: finite(rotation.w, 'rotation.w') });
  if (Math.abs(Math.hypot(q.x, q.y, q.z, q.w) - 1) > 1e-5) throw new RangeError('Spawn rotation must be a unit quaternion.');
  return Object.freeze({ position: p, rotation: q });
}

export function parseScriptInput(value: unknown): Readonly<ScriptInput> {
  const input = record(value, 'frame.input');
  if (typeof input.handbrake !== 'boolean' || typeof input.boost !== 'boolean') throw new TypeError('handbrake and boost must be booleans.');
  if (input.source !== 'keyboard' && input.source !== 'gamepad') throw new TypeError('Input source must be keyboard or gamepad.');
  return Object.freeze({
    throttle: bounded(input.throttle, 'throttle', 0, 1),
    brake: bounded(input.brake, 'brake', 0, 1),
    steer: bounded(input.steer, 'steer', -1, 1),
    handbrake: input.handbrake, boost: input.boost, source: input.source,
  });
}

/** Validate and copy. Unlike tuning import, replay never fills missing values or clamps them. */
export function parseScriptHeader(value: unknown): ScriptHeader {
  const raw = record(value, 'script');
  if (raw.version !== 1) throw new RangeError('Unsupported input script version; expected 1.');
  if (typeof raw.name !== 'string' || !raw.name.trim()) throw new TypeError('Script name must not be empty.');
  const seed = integer(raw.seed, 'seed');
  if (seed > 0xffffffff) throw new RangeError('Seed must be a uint32.');
  const values = record(raw.tuning, 'tuning');
  for (const key of Object.keys(values)) if (!isParamKey(key)) throw new RangeError('Unknown tuning key: ' + key);
  const tuning = {} as ParamSet;
  for (const definition of PARAM_DEFS) {
    if (!Object.hasOwn(values, definition.key)) throw new TypeError('Full tuning header required; missing ' + definition.key);
    const value = finite(values[definition.key], definition.key);
    if (normalizeValue(definition.key, value) !== value) throw new RangeError('Invalid replay tuning value: ' + definition.key);
    tuning[definition.key] = value;
  }
  return Object.freeze({ version: 1, name: raw.name, seed, spawn: parseScriptSpawn(raw.spawn), tuning: Object.freeze(tuning) });
}

/** Accept the raw JSON string or document; callers do not need a second parser. */
export function parseInputScript(source: unknown): InputScript {
  const raw = record(typeof source === 'string' ? JSON.parse(source) : source, 'script');
  const header = parseScriptHeader(raw);
  const durationSteps = integer(raw.durationSteps, 'durationSteps', 1);
  if (!Array.isArray(raw.frames) || raw.frames.length === 0) throw new TypeError('Script must include input at step 0.');
  const frames: ScriptFrame[] = [];
  let previous = -1;
  for (const entry of raw.frames) {
    const frame = record(entry, 'frame');
    const step = integer(frame.step, 'frame.step');
    if (step <= previous || step >= durationSteps || (previous === -1 && step !== 0)) throw new RangeError('Frames must start at zero, increase strictly, and precede durationSteps.');
    frames.push(Object.freeze({ step, input: parseScriptInput(frame.input) }));
    previous = step;
  }
  return Object.freeze({ ...header, durationSteps, frames: Object.freeze(frames) });
}

export function exportInputScript(script: InputScript): string {
  return JSON.stringify(script, null, 2);
}
