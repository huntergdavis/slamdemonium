import {
  DEFAULT_VALUES,
  PARAM_DEFS,
  isParamKey,
  normalizeValue,
  type ParamKey,
  type ParamPatch,
  type ParamSet,
} from './schema';
import { TuningStore, type TuningChange } from './store';

export const TUNING_VERSION = 1;
export const WORKING_SET_KEY = 'vehicle-feel.tuning.working';
export const USER_PRESETS_KEY = 'vehicle-feel.tuning.presets';
export type Warn = (message: string) => void;
export interface ChangeLogEntry {
  readonly timestamp: number;
  readonly key: ParamKey;
  readonly old: number;
  readonly new: number;
}
export interface TuningDocument {
  version: number;
  name: string;
  values: ParamSet;
  changeLog: ChangeLogEntry[];
}
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readValues(raw: unknown, warn: Warn): ParamSet {
  if (!isRecord(raw)) throw new TypeError('Tuning values must be an object.');
  const values = { ...DEFAULT_VALUES };
  for (const [key, value] of Object.entries(raw)) {
    if (!isParamKey(key)) {
      warn('Ignoring unknown tuning key: ' + key);
    } else if (typeof value !== 'number' || !Number.isFinite(value)) {
      warn('Using default for invalid tuning value: ' + key);
    } else {
      values[key] = normalizeValue(key, value);
    }
  }
  return values;
}

function readLog(raw: unknown, warn: Warn): ChangeLogEntry[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    warn('Ignoring invalid tuning change log.');
    return [];
  }
  const log: ChangeLogEntry[] = [];
  for (const entry of raw) {
    if (
      isRecord(entry) &&
      typeof entry.key === 'string' &&
      isParamKey(entry.key) &&
      typeof entry.timestamp === 'number' &&
      Number.isFinite(entry.timestamp) &&
      typeof entry.old === 'number' &&
      Number.isFinite(entry.old) &&
      typeof entry.new === 'number' &&
      Number.isFinite(entry.new)
    ) {
      log.push(
        Object.freeze({
          timestamp: entry.timestamp,
          key: entry.key,
          old: entry.old,
          new: entry.new,
        }),
      );
    } else {
      warn('Ignoring invalid tuning change log entry.');
    }
  }
  return log;
}

export function parseTuningJSON(
  json: string,
  warn: Warn = console.warn,
): TuningDocument {
  const raw: unknown = JSON.parse(json);
  if (!isRecord(raw)) throw new TypeError('Tuning document must be an object.');
  if (raw.version !== TUNING_VERSION)
    warn('Tuning version differs; importing recognized keys.');
  return {
    version: TUNING_VERSION,
    name: typeof raw.name === 'string' ? raw.name : 'Imported',
    values: readValues(raw.values, warn),
    changeLog: readLog(raw.changeLog, warn),
  };
}

export function exportTuningJSON(
  store: TuningStore,
  name = 'Custom',
  changeLog: readonly ChangeLogEntry[] = [],
): string {
  return JSON.stringify(
    { version: TUNING_VERSION, name, values: store.snapshot(), changeLog },
    null,
    2,
  );
}

/** The hash contains only the changed-from-default map, encoded as UTF-8 JSON. */
export function encodeShareHash(store: TuningStore): string {
  const changed: ParamPatch = {};
  for (const definition of PARAM_DEFS) {
    const value = store.get(definition.key);
    if (value !== definition.default) changed[definition.key] = value;
  }
  const bytes = new TextEncoder().encode(JSON.stringify(changed));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return (
    '#' +
    btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  );
}

export function decodeShareHash(
  hash: string,
  warn: Warn = console.warn,
): ParamSet {
  const encoded = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!/^[A-Za-z0-9_-]+$/.test(encoded) || encoded.length % 4 === 1) {
    throw new TypeError('Invalid tuning share hash.');
  }
  const binary = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const raw: unknown = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(bytes),
  );
  return readValues(raw, warn);
}

export interface PersistenceOptions {
  storage?: StorageLike | null;
  hash?: string;
  name?: string;
  debounceMs?: number;
  warn?: Warn;
}

/** Owns subscriptions/timers; call dispose() on teardown to flush and unsubscribe. */
export class TuningStorage {
  private readonly storage: StorageLike | null;
  private readonly warn: Warn;
  private readonly debounceMs: number;
  private readonly log: ChangeLogEntry[] = [];
  private readonly userPresets = new Map<string, TuningDocument>();
  private readonly unsubscribe: () => void;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private dirty = false;
  private disposed = false;
  name: string;

  constructor(
    readonly store: TuningStore,
    options: PersistenceOptions = {},
  ) {
    this.warn = options.warn ?? console.warn;
    this.debounceMs = options.debounceMs ?? 200;
    this.name = options.name ?? 'Default';
    let storage: StorageLike | null = null;
    try {
      storage =
        options.storage === undefined
          ? (globalThis.localStorage ?? null)
          : options.storage;
    } catch {
      this.warn(
        'Local storage is unavailable; tuning remains usable in memory.',
      );
    }
    this.storage = storage;
    // Restore before observing: reloading is not an edit and must not duplicate history.
    this.restore();
    this.unsubscribe = store.onChange(this.recordChange);
    const hash = options.hash ?? globalThis.location?.hash ?? '';
    if (hash && hash !== '#') {
      try {
        this.applyShareHash(hash);
      } catch {
        this.warn('Ignoring invalid tuning share hash.');
      }
    }
  }

  get changeLog(): readonly ChangeLogEntry[] {
    return this.log.slice();
  }

  exportJSON(): string {
    return exportTuningJSON(this.store, this.name, this.log);
  }

  importJSON(json: string): void {
    const document = parseTuningJSON(json, this.warn);
    this.name = document.name;
    this.log.push(...document.changeLog);
    this.store.replace(document.values, 'import');
    this.scheduleSave();
  }

  shareHash(): string {
    return encodeShareHash(this.store);
  }

  applyShareHash(hash: string): void {
    const values = decodeShareHash(hash, this.warn);
    this.name = 'Shared';
    this.store.replace(values, 'share');
    this.scheduleSave();
  }

  savePreset(name: string): void {
    name = name.trim();
    if (!name) throw new TypeError('Preset name must not be empty.');
    this.userPresets.set(
      name,
      parseTuningJSON(exportTuningJSON(this.store, name), this.warn),
    );
    this.write(
      USER_PRESETS_KEY,
      JSON.stringify([...this.userPresets.values()]),
    );
    this.name = name;
    this.scheduleSave();
  }

  listPresets(): string[] {
    return [...this.userPresets.keys()];
  }

  applyUserPreset(name: string): void {
    const preset = this.userPresets.get(name);
    if (!preset) throw new RangeError('Unknown user preset: ' + name);
    this.name = name;
    this.store.replace(preset.values, 'preset');
    this.scheduleSave();
  }

  /** Reset working values, retaining edit history and explicitly saved user presets. */
  resetEverything(): void {
    this.name = 'Default';
    this.store.resetAll();
    this.scheduleSave();
  }

  flush(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.dirty) return;
    this.dirty = !this.write(WORKING_SET_KEY, this.exportJSON());
  }

  dispose(): void {
    this.flush();
    this.unsubscribe();
    this.disposed = true;
  }

  private readonly recordChange = (change: TuningChange): void => {
    this.log.push(
      Object.freeze({
        timestamp: change.timestamp,
        key: change.key,
        old: change.old,
        new: change.new,
      }),
    );
    this.scheduleSave();
  };

  private scheduleSave(): void {
    if (this.disposed) return;
    this.dirty = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.flush();
    }, this.debounceMs);
  }

  private restore(): void {
    try {
      const json = this.storage?.getItem(WORKING_SET_KEY);
      if (json) {
        const document = parseTuningJSON(json, this.warn);
        this.name = document.name;
        this.log.push(...document.changeLog);
        this.store.replace(document.values, 'restore');
      }
    } catch {
      this.warn('Ignoring unreadable saved working set.');
    }
    try {
      const json = this.storage?.getItem(USER_PRESETS_KEY);
      if (!json) return;
      const presets: unknown = JSON.parse(json);
      if (!Array.isArray(presets))
        throw new TypeError('Invalid saved presets.');
      for (const raw of presets) {
        try {
          const preset = parseTuningJSON(JSON.stringify(raw), this.warn);
          this.userPresets.set(preset.name, preset);
        } catch {
          this.warn('Ignoring unreadable saved preset.');
        }
      }
    } catch {
      this.warn('Ignoring unreadable saved presets.');
    }
  }

  private write(key: string, value: string): boolean {
    if (!this.storage) return true;
    try {
      this.storage.setItem(key, value);
      return true;
    } catch {
      this.warn('Could not save tuning to local storage.');
      return false;
    }
  }
}
