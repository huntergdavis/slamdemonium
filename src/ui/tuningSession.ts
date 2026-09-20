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
export interface RebuildFeedback {
  readonly status: RebuildState;
  readonly error: string | null;
}
interface SavedSlot {
  values: ParamSet;
  baseline: ParamSet;
  name: string;
}
export interface TuningSessionOptions {
  persistence?: TuningStorage;
  persistenceOptions?: PersistenceOptions;
  /** Boot owns the headless-safe debounce; Options only displays its stable state. */
  readRebuildState?: () => Readonly<RebuildFeedback>;
}

/** Only the injected store is live state. A/B snapshots are stored when leaving a slot. */
export class TuningSession {
  readonly persistence: TuningStorage;
  activeSlot: ComparisonSlot = 'A';
  presetName: string;
  rebuildState: RebuildState = 'unavailable';
  rebuildError: string | null = null;
  message = '';
  private baseline: ParamSet;
  private readonly slots: Record<ComparisonSlot, SavedSlot>;
  private readonly listeners = new Set<(key?: ParamKey) => void>();
  private readonly unsubscribeStore: () => void;
  private readonly unsubscribeStatus: () => void;
  private disposed = false;

  constructor(
    readonly store: TuningStore,
    private readonly options: TuningSessionOptions = {},
  ) {
    if (options.persistence && options.persistence.store !== store)
      throw new TypeError(
        'Persistence and Options must share the same tuning store.',
      );
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
    this.updateRebuildState();
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
    this.notify(change.key);
  };

  /** Called by the panel's <=30 Hz update gate; never schedules or applies a rebuild. */
  updateRebuildState(): void {
    if (this.disposed) return;
    const feedback = this.options.readRebuildState?.();
    const status = feedback?.status ?? 'unavailable';
    const error = feedback?.error ?? null;
    if (status === this.rebuildState && error === this.rebuildError) return;
    this.rebuildState = status;
    this.rebuildError = error;
    this.notify();
  }

  private notify(key?: ParamKey): void {
    if (this.disposed) return;
    for (const listener of this.listeners) listener(key);
  }
}
