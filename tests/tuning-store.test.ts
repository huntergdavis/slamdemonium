import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_VALUES } from '../src/tuning/schema';
import { TuningStore, type TuningChange } from '../src/tuning/store';

describe('TuningStore', () => {
  it('owns its values and exposes copies, including radians for simulation', () => {
    const first = new TuningStore();
    const second = new TuningStore();
    first.set('gravity', 20);
    const snapshot = first.snapshot();
    snapshot.gravity = 30;
    expect(first.get('gravity')).toBe(20);
    expect(second.get('gravity')).toBe(14.7);
    expect(first.getRadians('steerMaxLowSpeed')).toBeCloseTo(
      (32 * Math.PI) / 180,
    );
  });

  it('clamps load and input, preserves numeric precision, and snaps discrete rates', () => {
    const store = new TuningStore({ gravity: -10, physicsHz: 100 });
    expect(store.get('gravity')).toBe(4);
    expect(store.get('physicsHz')).toBe(90);
    store.set('gravity', 999);
    expect(store.get('gravity')).toBe(40);
    store.set('gravity', 14.731);
    expect(store.get('gravity')).toBe(14.731);
    store.set('physicsHz', 220);
    expect(store.get('physicsHz')).toBe(240);
  });

  it('rejects non-finite input atomically', () => {
    const store = new TuningStore();
    for (const value of [NaN, Infinity, -Infinity]) {
      expect(() => store.patch({ gravity: 30, mass: value })).toThrow(
        RangeError,
      );
      expect(store.snapshot()).toEqual(DEFAULT_VALUES);
    }
  });

  it('emits timestamped effective changes after the full transaction and unsubscribes', () => {
    const store = new TuningStore({}, () => 1234);
    const changes: TuningChange[] = [];
    const observe = vi.fn((change: TuningChange) => {
      expect(store.get('mass')).toBe(2000);
      expect(store.get('gravity')).toBe(20);
      changes.push(change);
    });
    const off = store.onChange(observe);
    store.patch({ gravity: 20, mass: 2000 });
    expect(changes).toEqual([
      {
        timestamp: 1234,
        key: 'gravity',
        old: 14.7,
        new: 20,
        source: 'input',
        needsRebuild: false,
      },
      {
        timestamp: 1234,
        key: 'mass',
        old: 1300,
        new: 2000,
        source: 'input',
        needsRebuild: true,
      },
    ]);
    store.set('gravity', 20);
    expect(observe).toHaveBeenCalledTimes(2);
    off();
    store.resetAll();
    expect(observe).toHaveBeenCalledTimes(2);
  });

  it('applies presets over defaults and supports per-key, group and full resets', () => {
    const store = new TuningStore();
    store.applyPreset('Drifty');
    expect(store.get('driveBias')).toBe(0.8);
    store.applyPreset('Grip');
    expect(store.get('driveBias')).toBe(0.65);
    expect(store.get('gripRear')).toBe(1.9);
    store.reset('gripRear');
    expect(store.get('gripRear')).toBe(1.5);
    store.resetGroup('Tires');
    expect(store.get('gripFront')).toBe(1.5);
    expect(store.get('yawAssist')).toBe(0.2);
    store.applyPreset('Raw');
    expect(store.get('yawAssist')).toBe(0);
    expect(store.get('countersteerAssist')).toBe(0);
    expect(store.get('absStrength')).toBe(0);
    store.applyPreset('Default');
    expect(store.snapshot()).toEqual(DEFAULT_VALUES);
  });
});
