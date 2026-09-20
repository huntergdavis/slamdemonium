import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_VALUES } from '../src/tuning/schema';
import { TuningStore } from '../src/tuning/store';
import {
  TuningStorage,
  WORKING_SET_KEY,
  USER_PRESETS_KEY,
  decodeShareHash,
  encodeShareHash,
  exportTuningJSON,
  parseTuningJSON,
  type StorageLike,
} from '../src/tuning/storage';

class MemoryStorage implements StorageLike {
  readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe('tuning import and sharing', () => {
  it('round-trips full JSON, Unicode names, and the change log', () => {
    const store = new TuningStore({ gravity: 20 });
    const log = [
      { timestamp: 100, key: 'gravity' as const, old: 14.7, new: 20 },
    ];
    const result = parseTuningJSON(exportTuningJSON(store, '雪 / Drifty', log));
    expect(result).toEqual({
      version: 1,
      name: '雪 / Drifty',
      values: store.snapshot(),
      changeLog: log,
    });
  });

  it('handles version drift, unknown keys, invalid values, clamping, and missing defaults', () => {
    const warn = vi.fn();
    const document = parseTuningJSON(
      '{"version":999,"name":"Future","values":{"gravity":999,"mass":"wrong","physicsHz":175,"futureKey":2,"__proto__":5}}',
      warn,
    );
    expect(document.values.gravity).toBe(40);
    expect(document.values.mass).toBe(1300);
    expect(document.values.physicsHz).toBe(180);
    expect(document.values.accel0).toBe(14);
    expect(Object.keys(document.values)).toHaveLength(69);
    expect(warn).toHaveBeenCalledTimes(4);
  });

  it('rejects malformed documents before changing a store', () => {
    const persistence = new TuningStorage(new TuningStore({ gravity: 20 }), {
      storage: null,
      hash: '',
    });
    for (const json of ['{', '[]', 'null', '{"version":1,"values":[]}']) {
      expect(() => persistence.importJSON(json)).toThrow();
      expect(persistence.store.get('gravity')).toBe(20);
    }
    persistence.dispose();
  });

  it('shares only changed values as unpadded base64url and restores defaults', () => {
    const store = new TuningStore({ gravity: 21.2345, yawAssist: 0 });
    const hash = encodeShareHash(store);
    expect(hash).toMatch(/^#[A-Za-z0-9_-]+$/);
    const raw = JSON.parse(
      atob(hash.slice(1).replace(/-/g, '+').replace(/_/g, '/')),
    ) as unknown;
    expect(raw).toEqual({ gravity: 21.2345, yawAssist: 0 });
    expect(decodeShareHash(hash)).toEqual(store.snapshot());
    expect(decodeShareHash(encodeShareHash(new TuningStore()))).toEqual(
      DEFAULT_VALUES,
    );
    for (const invalid of ['', '#', '#!', '#a', '#bnVsbA'])
      expect(() => decodeShareHash(invalid)).toThrow();
  });
});

describe('TuningStorage', () => {
  it('reports metadata-only saves and returns immutable log entries without exposing the mutable array', () => {
    vi.useFakeTimers();
    const storage = new MemoryStorage();
    const persistence = new TuningStorage(new TuningStore(), {
      storage,
      hash: '',
    });
    const states: string[] = [];
    persistence.onStatus((state) => states.push(state));
    persistence.setName('Named defaults');
    vi.advanceTimersByTime(200);
    expect(parseTuningJSON(storage.getItem(WORKING_SET_KEY) ?? '').name).toBe(
      'Named defaults',
    );
    expect(states).toEqual(['saving', 'saved']);
    persistence.store.set('gravity', 20);
    const entry = persistence.changeLogEntry(0);
    expect(Object.isFrozen(entry)).toBe(true);
    expect(persistence.changeLogEntry(0)).toBe(entry);
    const exported = persistence.exportJSON();
    persistence.store.set('gravity', 21);
    expect(parseTuningJSON(exported).changeLog).toHaveLength(1);
    expect(persistence.changeLogLength).toBe(2);
    persistence.dispose();
  });

  it('retries failed named-preset writes and never reports saved when only the working set succeeded', () => {
    const storage = new MemoryStorage();
    const originalWrite = storage.setItem.bind(storage);
    let rejectPresets = true;
    vi.spyOn(storage, 'setItem').mockImplementation((key, value) => {
      if (key === USER_PRESETS_KEY && rejectPresets) throw new Error('quota');
      originalWrite(key, value);
    });
    const persistence = new TuningStorage(new TuningStore({ gravity: 25 }), {
      storage,
      hash: '',
      warn: vi.fn(),
    });
    persistence.savePreset('Keep me');
    persistence.flush();
    expect(storage.getItem(WORKING_SET_KEY)).not.toBeNull();
    expect(storage.getItem(USER_PRESETS_KEY)).toBeNull();
    expect(persistence.status).toBe('error');
    rejectPresets = false;
    persistence.flush();
    expect(persistence.status).toBe('saved');
    const reloaded = new TuningStorage(new TuningStore(), {
      storage,
      hash: '',
    });
    reloaded.applyUserPreset('Keep me');
    expect(reloaded.store.get('gravity')).toBe(25);
    reloaded.dispose();
    persistence.dispose();
  });

  it('debounces autosave, logs every effective change, and restores without duplicating history', () => {
    vi.useFakeTimers();
    const storage = new MemoryStorage();
    const store = new TuningStore({}, () => 500);
    const persistence = new TuningStorage(store, {
      storage,
      hash: '',
      debounceMs: 200,
    });
    store.set('gravity', 20);
    vi.advanceTimersByTime(100);
    store.set('gravity', 22);
    expect(storage.getItem(WORKING_SET_KEY)).toBeNull();
    vi.advanceTimersByTime(199);
    expect(storage.getItem(WORKING_SET_KEY)).toBeNull();
    vi.advanceTimersByTime(1);
    expect(persistence.changeLog).toEqual([
      { timestamp: 500, key: 'gravity', old: 14.7, new: 20 },
      { timestamp: 500, key: 'gravity', old: 20, new: 22 },
    ]);
    const restored = new TuningStorage(new TuningStore(), {
      storage,
      hash: '',
    });
    expect(restored.store.get('gravity')).toBe(22);
    expect(restored.changeLog).toEqual(persistence.changeLog);
    persistence.dispose();
    restored.dispose();
  });

  it('gives a share link precedence over the working set and flushes on disposal', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      WORKING_SET_KEY,
      exportTuningJSON(new TuningStore({ mass: 2000 }), 'Saved'),
    );
    const shared = new TuningStore({ gravity: 30 });
    const persistence = new TuningStorage(new TuningStore(), {
      storage,
      hash: encodeShareHash(shared),
    });
    expect(persistence.store.snapshot()).toEqual(shared.snapshot());
    persistence.dispose();
    expect(
      parseTuningJSON(storage.getItem(WORKING_SET_KEY) ?? '').values.gravity,
    ).toBe(30);
    persistence.store.set('gravity', 31);
    expect(
      parseTuningJSON(storage.getItem(WORKING_SET_KEY) ?? '').values.gravity,
    ).toBe(30);
  });

  it('stores and reloads named presets safely, including special object property names', () => {
    const storage = new MemoryStorage();
    const persistence = new TuningStorage(new TuningStore({ gravity: 24 }), {
      storage,
      hash: '',
    });
    persistence.savePreset('__proto__');
    persistence.savePreset('雪');
    expect(storage.getItem(USER_PRESETS_KEY)).not.toBeNull();
    persistence.resetEverything();
    expect(persistence.store.snapshot()).toEqual(DEFAULT_VALUES);
    persistence.dispose();
    const restored = new TuningStorage(new TuningStore(), {
      storage,
      hash: '',
    });
    expect(restored.listPresets()).toEqual(['__proto__', '雪']);
    restored.applyUserPreset('__proto__');
    expect(restored.store.get('gravity')).toBe(24);
    expect(() => restored.savePreset(' ')).toThrow();
    expect(() => restored.applyUserPreset('missing')).toThrow();
    restored.dispose();
  });

  it('imports historical changes and records the import itself in exported JSON', () => {
    const persistence = new TuningStorage(new TuningStore({}, () => 200), {
      storage: null,
      hash: '',
    });
    persistence.importJSON(
      '{"version":1,"name":"Imported","values":{"gravity":20},"changeLog":[{"timestamp":100,"key":"gravity","old":14.7,"new":20}]}',
    );
    const exported = parseTuningJSON(persistence.exportJSON());
    expect(exported.name).toBe('Imported');
    expect(exported.changeLog.map((entry) => entry.timestamp)).toEqual([
      100, 200,
    ]);
    persistence.dispose();
  });

  it('keeps tuning functional with corrupt saved data or storage failures', () => {
    const storage = new MemoryStorage();
    storage.setItem(WORKING_SET_KEY, 'broken');
    storage.setItem(USER_PRESETS_KEY, 'null');
    const warn = vi.fn();
    const persistence = new TuningStorage(new TuningStore(), {
      storage,
      hash: '#bad!',
      warn,
    });
    expect(persistence.store.snapshot()).toEqual(DEFAULT_VALUES);
    expect(warn).toHaveBeenCalledTimes(3);
    vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    persistence.store.set('gravity', 20);
    expect(() => persistence.flush()).not.toThrow();
    expect(persistence.store.get('gravity')).toBe(20);
    expect(warn).toHaveBeenLastCalledWith(
      'Could not save tuning to local storage.',
    );
    persistence.dispose();
  });
});
