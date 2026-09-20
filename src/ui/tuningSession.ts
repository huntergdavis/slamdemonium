import { BUILTIN_PRESETS, type BuiltinPresetName } from '../tuning/presets';
import {
  DEFAULT_VALUES,
  PARAM_DEFS,
  type ParamKey,
  type ParamSet,
} from '../tuning/schema';
import { TuningStorage, type PersistenceOptions } from '../tuning/storage';
import { TuningStore, type TuningChange } from '../tuning/store';

export type ComparisonSlot = 'A' | 'B';
export type RebuildState = 'idle' | 'pending' | 'error' | 'unavailable';
interface SavedSlot {
  values: ParamSet;
  baseline: ParamSet;
  name: string;
}
export interface TuningSessionOptions {
  persistence?: TuningStorage;
  persistenceOptions?: PersistenceOptions;
  /** Adapter updates the existing body's mass properties; never creates or respawns a body. */
  applyMassProperties?: () => void | Promise<void>;
}

/** Only the injected store is live state. A/B snapshots are stored when leaving a slot. */
export class TuningSession {
  readonly persistence: TuningStorage;
  activeSlot: ComparisonSlot = 'A';
  presetName: string;
  rebuildState: RebuildState = 'idle';
  message = '';
  private baseline: ParamSet;
  private readonly slots: Record<ComparisonSlot, SavedSlot>;
  private readonly listeners = new Set<(key?: ParamKey) => void>();
  private readonly unsubscribeStore: () => void;
  private readonly unsubscribeStatus: () => void;
  private rebuildTimer: ReturnType<typeof setTimeout> | undefined;
  private revision = 0;
  private disposed = false;

  constructor(
    readonly store: TuningStore,
    private readonly options: TuningSessionOptions = {},
  ) {
    if (options.persistence && options.persistence.store !== store)
      throw new TypeError(
        'Persistence and Options must share the same tuning store.',
      );
    const beforeRestore = store.snapshot();
    this.persistence =
      options.persistence ??
      new TuningStorage(store, {
        ...options.persistenceOptions,
        warn: (message) => {
          this.message = message;
          options.persistenceOptions?.warn?.(message);
          this.notify();
        },
      });
    this.presetName = this.persistence.name;
    this.baseline = this.resolveBaseline(this.presetName);
    this.slots = { A: this.capture(), B: this.capture() };
    this.unsubscribeStore = store.onChange(this.changed);
    this.unsubscribeStatus = this.persistence.onStatus(() => {
      this.notify();
    });
    if (
      PARAM_DEFS.some(
        (definition) =>
          definition.needsRebuild &&
          beforeRestore[definition.key] !== store.get(definition.key),
      )
    )
      this.scheduleRebuild();
  }

  onUpdate(listener: (key?: ParamKey) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  isEdited(key: ParamKey): boolean {
    return this.store.get(key) !== this.baseline[key];
  }
  get modified(): boolean {
    return PARAM_DEFS.some((definition) => this.isEdited(definition.key));
  }

  applyBuiltin(name: BuiltinPresetName): void {
    this.message = '';
    this.presetName = name;
    this.baseline = { ...DEFAULT_VALUES, ...BUILTIN_PRESETS[name] };
    this.persistence.setName(name);
    this.store.applyPreset(name);
    this.notify();
  }

  applyUser(name: string): void {
    const baseline = this.persistence.presetValues(name);
    if (!baseline) throw new RangeError('Unknown user preset: ' + name);
    this.message = '';
    this.presetName = name;
    this.baseline = baseline;
    this.persistence.applyUserPreset(name);
    this.notify();
  }

  saveAs(name: string): void {
    name = name.trim();
    if (!name) throw new TypeError('Enter a preset name.');
    if (Object.hasOwn(BUILTIN_PRESETS, name))
      throw new TypeError('Choose a name other than a built-in preset.');
    this.message = '';
    this.persistence.savePreset(name);
    this.presetName = name;
    this.baseline = this.store.snapshot();
    this.notify();
  }

  importJSON(json: string): void {
    this.message = '';
    this.persistence.importJSON(json);
    this.presetName = this.persistence.name;
    this.baseline = this.store.snapshot();
    this.notify();
  }

  exportJSON(): string {
    return this.persistence.exportJSON();
  }

  shareURL(base: string): string {
    const url = new URL(base);
    url.hash = this.persistence.shareHash();
    return url.href;
  }

  switchSlot(slot: ComparisonSlot): void {
    if (slot === this.activeSlot) return;
    this.slots[this.activeSlot] = this.capture();
    this.activeSlot = slot;
    const saved = this.slots[slot];
    this.baseline = { ...saved.baseline };
    this.presetName = saved.name;
    this.persistence.setName(saved.name);
    this.store.replace(saved.values, 'comparison');
    this.notify();
  }

  swapSlots(): void {
    this.switchSlot(this.activeSlot === 'A' ? 'B' : 'A');
  }

  copyAToB(): void {
    const source = this.activeSlot === 'A' ? this.capture() : this.slots.A;
    this.slots.B = {
      values: { ...source.values },
      baseline: { ...source.baseline },
      name: source.name,
    };
    if (this.activeSlot === 'B') {
      this.baseline = { ...source.baseline };
      this.presetName = source.name;
      this.persistence.setName(source.name);
      this.store.replace(source.values, 'comparison');
    }
    this.notify();
  }

  resetEverything(): void {
    this.message = '';
    this.activeSlot = 'A';
    this.presetName = 'Default';
    this.baseline = { ...DEFAULT_VALUES };
    this.persistence.resetEverything();
    this.slots.A = this.capture();
    this.slots.B = this.capture();
    this.notify();
  }

  dispose(): void {
    this.disposed = true;
    this.revision++;
    if (this.rebuildTimer !== undefined) clearTimeout(this.rebuildTimer);
    this.unsubscribeStore();
    this.unsubscribeStatus();
    this.listeners.clear();
    if (!this.options.persistence) this.persistence.dispose();
  }

  private capture(): SavedSlot {
    return {
      values: this.store.snapshot(),
      baseline: { ...this.baseline },
      name: this.presetName,
    };
  }

  private resolveBaseline(name: string): ParamSet {
    const saved = this.persistence.presetValues(name);
    if (saved) return saved;
    if (Object.hasOwn(BUILTIN_PRESETS, name))
      return {
        ...DEFAULT_VALUES,
        ...BUILTIN_PRESETS[name as BuiltinPresetName],
      };
    return this.store.snapshot();
  }

  private readonly changed = (change: TuningChange): void => {
    if (change.needsRebuild) this.scheduleRebuild();
    this.notify(change.key);
  };

  private scheduleRebuild(): void {
    this.revision++;
    this.rebuildState = 'pending';
    if (this.rebuildTimer !== undefined) clearTimeout(this.rebuildTimer);
    this.rebuildTimer = setTimeout(() => {
      void this.rebuild(this.revision);
    }, 100);
  }

  private async rebuild(revision: number): Promise<void> {
    this.rebuildTimer = undefined;
    if (!this.options.applyMassProperties) {
      this.rebuildState = 'unavailable';
      this.notify();
      return;
    }
    try {
      await this.options.applyMassProperties();
      if (this.disposed || revision !== this.revision) return;
      this.rebuildState = 'idle';
    } catch {
      if (this.disposed || revision !== this.revision) return;
      this.rebuildState = 'error';
      this.message = 'Mass update failed; retry by adjusting a mass parameter.';
    }
    this.notify();
  }

  private notify(key?: ParamKey): void {
    if (this.disposed) return;
    for (const listener of this.listeners) listener(key);
  }
}
