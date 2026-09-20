import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_VALUES, PARAM_BY_KEY } from '../src/tuning/schema';
import { TuningStore } from '../src/tuning/store';
import { TuningSession } from '../src/ui/tuningSession';
import {
  sliderToValue,
  usesLogSlider,
  valueToSlider,
} from '../src/ui/sliderMapping';
import {
  readOperatingPoints,
  tireCurve,
  type OperatingPoints,
} from '../src/ui/tireCurvePlot';

afterEach(() => {
  vi.useRealTimers();
});

it('applies mass values restored by a share link through the same debounced adapter callback', async () => {
  vi.useFakeTimers();
  const update = vi.fn();
  const session = new TuningSession(new TuningStore(), {
    persistenceOptions: {
      storage: null,
      hash: '#' + btoa('{"mass":1900}').replace(/=+$/, ''),
    },
    applyMassProperties: update,
  });
  expect(session.store.get('mass')).toBe(1900);
  expect(session.rebuildState).toBe('pending');
  await vi.advanceTimersByTimeAsync(100);
  expect(update).toHaveBeenCalledOnce();
  session.dispose();
});
const memoryOnly = { persistenceOptions: { storage: null, hash: '' } };

it('keeps independent A/B edits and preset baselines, including copying A while B is active', () => {
  const store = new TuningStore();
  const session = new TuningSession(store, memoryOnly);
  session.applyBuiltin('Grip');
  expect(session.modified).toBe(false);
  store.set('gravity', 22);
  expect(session.isEdited('gravity')).toBe(true);
  session.copyAToB();
  session.switchSlot('B');
  expect(store.get('gravity')).toBe(22);
  store.set('gravity', 30);
  session.switchSlot('A');
  expect(store.get('gravity')).toBe(22);
  expect(session.presetName).toBe('Grip');
  session.switchSlot('B');
  expect(store.get('gravity')).toBe(30);
  session.copyAToB();
  expect(store.get('gravity')).toBe(22);
  expect(session.isEdited('gravity')).toBe(true);
  session.dispose();
});

it('save-as establishes a baseline; reset keeps named presets and resets both comparison slots', () => {
  const store = new TuningStore();
  const session = new TuningSession(store, memoryOnly);
  store.set('gravity', 22.1234);
  session.saveAs('My tune');
  expect(session.modified).toBe(false);
  store.set('gravity', 23);
  session.persistence.flush();
  expect(session.modified).toBe(true);
  session.resetEverything();
  expect(store.snapshot()).toEqual(DEFAULT_VALUES);
  session.swapSlots();
  expect(store.snapshot()).toEqual(DEFAULT_VALUES);
  session.applyUser('My tune');
  expect(store.get('gravity')).toBe(22.1234);
  expect(session.modified).toBe(false);
  expect(() => session.saveAs('Default')).toThrow();
  session.dispose();
});

it('imports full sets with warnings, preserves export snapshots, and shares relative to the deployment path', () => {
  const session = new TuningSession(new TuningStore(), memoryOnly);
  session.importJSON(
    '{"version":9,"name":"Future","values":{"gravity":23,"unknown":4}}',
  );
  expect(session.message).toContain('unknown');
  const exported = session.exportJSON();
  session.store.set('gravity', 24);
  expect(JSON.parse(exported).values.gravity).toBe(23);
  const url = new URL(
    session.shareURL('https://example.test/slamdemonium/?test=1'),
  );
  expect(url.pathname).toBe('/slamdemonium/');
  expect(url.search).toBe('?test=1');
  expect(url.hash).toMatch(/^#[A-Za-z0-9_-]+$/);
  session.dispose();
});

it('coalesces mass edits for 100 ms and applies the latest state without owning body transforms', async () => {
  vi.useFakeTimers();
  const store = new TuningStore();
  const applied: number[] = [];
  const session = new TuningSession(store, {
    ...memoryOnly,
    applyMassProperties: () => {
      applied.push(store.get('mass'));
    },
  });
  store.set('mass', 1500);
  await vi.advanceTimersByTimeAsync(99);
  expect(applied).toEqual([]);
  store.set('mass', 1800);
  store.set('comHeightOffset', -0.2);
  await vi.advanceTimersByTimeAsync(99);
  expect(applied).toEqual([]);
  await vi.advanceTimersByTimeAsync(1);
  expect(applied).toEqual([1800]);
  expect(session.rebuildState).toBe('idle');
  store.set('mass', 2000);
  session.dispose();
  await vi.advanceTimersByTimeAsync(100);
  expect(applied).toEqual([1800]);
});

it('does not clear pending edits when an older asynchronous rebuild finishes', async () => {
  vi.useFakeTimers();
  let finish: (() => void) | undefined;
  const session = new TuningSession(new TuningStore(), {
    ...memoryOnly,
    applyMassProperties: () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  });
  session.store.set('mass', 1500);
  await vi.advanceTimersByTimeAsync(100);
  session.store.set('mass', 1800);
  finish?.();
  await Promise.resolve();
  expect(session.rebuildState).toBe('pending');
  await vi.advanceTimersByTimeAsync(100);
  finish?.();
  await Promise.resolve();
  expect(session.rebuildState).toBe('idle');
  session.dispose();
});

it('reports failed or unavailable mass callbacks without rolling back live tuning', async () => {
  vi.useFakeTimers();
  const failed = new TuningSession(new TuningStore(), {
    ...memoryOnly,
    applyMassProperties: () => {
      throw new Error('adapter unavailable');
    },
  });
  failed.store.set('mass', 1500);
  await vi.advanceTimersByTimeAsync(100);
  expect(failed.rebuildState).toBe('error');
  expect(failed.store.get('mass')).toBe(1500);
  failed.dispose();
  const missing = new TuningSession(new TuningStore(), memoryOnly);
  missing.store.set('mass', 1600);
  await vi.advanceTimersByTimeAsync(100);
  expect(missing.rebuildState).toBe('unavailable');
  missing.dispose();
});

it('maps logarithmic and discrete slider endpoints without changing typed precision', () => {
  for (const key of ['timeScale', 'mass', 'tireRelaxationLength'] as const) {
    const def = PARAM_BY_KEY[key];
    expect(usesLogSlider(def)).toBe(true);
    expect(sliderToValue(def, 0)).toBe(def.min);
    expect(sliderToValue(def, 1000)).toBe(def.max);
    expect(sliderToValue(def, valueToSlider(def, def.default))).toBeCloseTo(
      def.default,
      8,
    );
  }
  expect(usesLogSlider(PARAM_BY_KEY.comHeightOffset)).toBe(false);
  expect(sliderToValue(PARAM_BY_KEY.physicsHz, 3)).toBe(180);
  expect(valueToSlider(PARAM_BY_KEY.physicsHz, 240)).toBe(4);
  const store = new TuningStore();
  store.set('mass', 1300.123456);
  expect(store.get('mass')).toBe(1300.123456);
});

it('plots the specified tire law and only averages valid loaded wheels, reusing output objects', () => {
  expect(tireCurve(0, 8, 0.7, 3)).toBe(0);
  expect(tireCurve(8, 8, 0.7, 3)).toBe(1);
  expect(tireCurve(-4, 8, 0.7, 3)).toBe(0.75);
  expect(tireCurve(90, 8, 0.7, 3)).toBeCloseTo(0.7, 8);
  const points: OperatingPoints = {
    front: { visible: false, slipDegrees: 0, usage: 0 },
    rear: { visible: false, slipDegrees: 0, usage: 0 },
  };
  const front = points.front;
  readOperatingPoints(
    {
      wheels: [
        { Fz: 1000, alpha: Math.PI / 18, gripUsage: 0.8 },
        { Fz: 1000, alpha: -Math.PI / 9, gripUsage: 1.2 },
        { Fz: 0, alpha: 1, gripUsage: 1 },
        { Fz: 1000, alpha: NaN, gripUsage: 1 },
      ],
    },
    points,
  );
  expect(points.front).toBe(front);
  expect(points.front.visible).toBe(true);
  expect(points.front.slipDegrees).toBeCloseTo(15);
  expect(points.front.usage).toBe(1);
  expect(points.rear.visible).toBe(false);
  readOperatingPoints(undefined, points);
  expect(points.front.visible).toBe(false);
});
