import { BUILTIN_PRESETS, type BuiltinPresetName } from './presets';
import {
  DEFAULT_VALUES,
  PARAM_DEFS,
  isParamKey,
  normalizeValue,
  type AngleParamKey,
  type ParamGroup,
  type ParamKey,
  type ParamPatch,
  type ParamSet,
} from './schema';

export type ChangeSource =
  'input' | 'preset' | 'import' | 'restore' | 'share' | 'reset' | 'comparison';
export interface TuningChange {
  readonly timestamp: number;
  readonly key: ParamKey;
  readonly old: number;
  readonly new: number;
  readonly source: ChangeSource;
  readonly needsRebuild: boolean;
}

/** Construct per vehicle/application and pass it in; there is no shared mutable store. */
export class TuningStore {
  private values: ParamSet;
  private readonly listeners = new Set<(change: TuningChange) => void>();

  constructor(
    initial: ParamPatch = {},
    private readonly now: () => number = Date.now,
  ) {
    this.values = this.validated(initial, true);
  }

  get(key: ParamKey): number {
    return this.values[key];
  }

  getRadians(key: AngleParamKey): number {
    return (this.values[key] * Math.PI) / 180;
  }

  /** An owned copy for UI/export; hot paths should use get(). */
  snapshot(): ParamSet {
    return { ...this.values };
  }

  onChange(listener: (change: TuningChange) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  set(key: ParamKey, value: number, source: ChangeSource = 'input'): void {
    this.patch({ [key]: value }, source);
  }

  patch(values: ParamPatch, source: ChangeSource = 'input'): void {
    this.commit(this.validated(values, false), source);
  }

  /** Replace the full set; omitted keys return to their schema defaults. */
  replace(values: ParamPatch, source: ChangeSource = 'import'): void {
    this.commit(this.validated(values, true), source);
  }

  applyPreset(name: BuiltinPresetName): void {
    if (!Object.prototype.hasOwnProperty.call(BUILTIN_PRESETS, name)) {
      throw new RangeError('Unknown preset: ' + name);
    }
    this.replace(BUILTIN_PRESETS[name], 'preset');
  }

  reset(key: ParamKey): void {
    this.set(key, DEFAULT_VALUES[key], 'reset');
  }

  resetGroup(group: ParamGroup): void {
    const patch: ParamPatch = {};
    for (const definition of PARAM_DEFS) {
      if (definition.group === group)
        patch[definition.key] = definition.default;
    }
    this.patch(patch, 'reset');
  }

  resetAll(): void {
    this.replace({}, 'reset');
  }

  private validated(patch: ParamPatch, defaults: boolean): ParamSet {
    const next = { ...(defaults ? DEFAULT_VALUES : this.values) };
    for (const [key, value] of Object.entries(patch)) {
      if (!isParamKey(key)) throw new RangeError('Unknown parameter: ' + key);
      next[key] = normalizeValue(key, value);
    }
    return next;
  }

  private commit(next: ParamSet, source: ChangeSource): void {
    const previous = this.values;
    const changes: TuningChange[] = [];
    for (const definition of PARAM_DEFS) {
      const key = definition.key;
      if (previous[key] === next[key]) continue;
      changes.push(
        Object.freeze({
          timestamp: this.now(),
          key,
          old: previous[key],
          new: next[key],
          source,
          needsRebuild: definition.needsRebuild === true,
        }),
      );
    }
    // Observers always see the complete new set, including for presets and imports.
    this.values = next;
    for (const change of changes) {
      for (const listener of this.listeners) listener(change);
    }
  }
}
