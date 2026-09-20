import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_VALUES, PARAM_BY_KEY } from '../src/tuning/schema';
import { TuningStore } from '../src/tuning/store';
import { TuningSession, type RebuildState } from '../src/ui/tuningSession';
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

it('restores tuning without owning a rebuild timer or inventing pending state', () => {
  vi.useFakeTimers();
  const session = new TuningSession(new TuningStore(), {
    persistenceOptions: {
      storage: null,
      hash: '#' + btoa('{"mass":1900}').replace(/=+$/, ''),
    },
  });
  expect(session.store.get('mass')).toBe(1900);
  expect(session.rebuildState).toBe('unavailable');
  session.persistence.flush();
  expect(vi.getTimerCount()).toBe(0);
  session.store.set('mass', 2000);
  session.persistence.flush();
  expect(vi.getTimerCount()).toBe(0);
  expect(session.rebuildState).toBe('unavailable');
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

it('displays external rebuild transitions without applying or clearing the owner state', () => {
  vi.useFakeTimers();
  const feedback: { status: RebuildState; error: string | null } = {
    status: 'idle',
    error: null,
  };
  const read = vi.fn(() => feedback);
  const session = new TuningSession(new TuningStore(), {
    ...memoryOnly,
    readRebuildState: read,
  });
  const changed = vi.fn();
  session.onUpdate(changed);
  session.store.set('mass', 1800);
  session.persistence.flush();
  expect(vi.getTimerCount()).toBe(0);
  expect(session.rebuildState).toBe('idle');
  feedback.status = 'pending';
  session.updateRebuildState();
  expect(session.rebuildState).toBe('pending');
  changed.mockClear();
  session.updateRebuildState();
  expect(changed).not.toHaveBeenCalled();
  feedback.status = 'error';
  feedback.error = 'Mass adapter failed';
  session.updateRebuildState();
  expect(session.rebuildError).toBe('Mass adapter failed');
  expect(session.store.get('mass')).toBe(1800);
  feedback.status = 'idle';
  feedback.error = null;
  session.updateRebuildState();
  expect(session.rebuildError).toBeNull();
  session.dispose();
  read.mockClear();
  session.updateRebuildState();
  expect(read).not.toHaveBeenCalled();
  expect(feedback).toEqual({ status: 'idle', error: null });
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
