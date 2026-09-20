import { afterEach, expect, it, vi } from 'vitest';
import { DebouncedMassRebuild } from '../src/core/massRebuild';
import { TuningStore } from '../src/tuning/store';

afterEach(() => {
  vi.useRealTimers();
});

it('coalesces mass/COM/inertia changes into one application after 100ms', () => {
  vi.useFakeTimers();
  const store = new TuningStore(),
    apply = vi.fn();
  const owner = new DebouncedMassRebuild(store, apply);
  const state = owner.state;
  store.set('mass', 1500);
  vi.advanceTimersByTime(75);
  store.set('comLongOffset', 0.2);
  store.set('yawInertiaScale', 1.2);
  vi.advanceTimersByTime(99);
  expect(apply).not.toHaveBeenCalled();
  expect(owner.state).toBe(state);
  expect(state.status).toBe('pending');
  vi.advanceTimersByTime(1);
  expect(apply).toHaveBeenCalledOnce();
  expect(state.status).toBe('idle');
  store.set('gripRear', 1.3);
  vi.advanceTimersByTime(200);
  expect(apply).toHaveBeenCalledOnce();
  owner.dispose();
});
it('flushes once synchronously before headless stepping and cancels every outstanding timer', () => {
  vi.useFakeTimers();
  const store = new TuningStore(),
    apply = vi.fn();
  const owner = new DebouncedMassRebuild(store, apply);
  store.set('mass', 1500);
  owner.flush();
  expect(apply).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(1000);
  expect(apply).toHaveBeenCalledOnce();
  store.set('mass', 1600);
  owner.cancel();
  vi.advanceTimersByTime(1000);
  expect(apply).toHaveBeenCalledOnce();
  owner.dispose();
  store.set('mass', 1700);
  vi.advanceTimersByTime(1000);
  expect(apply).toHaveBeenCalledOnce();
});
it('reports unavailable/error states and lets a replay abort on failure', () => {
  const store = new TuningStore();
  const unavailable = new DebouncedMassRebuild(store);
  expect(unavailable.state.status).toBe('unavailable');
  unavailable.dispose();
  const owner = new DebouncedMassRebuild(store, () => {
    throw new Error('engine failed');
  });
  store.set('mass', 1500);
  expect(() => owner.flush()).toThrow('engine failed');
  expect(owner.state).toEqual({ status: 'error', error: 'engine failed' });
  owner.cancel();
  expect(owner.state.status).toBe('idle');
  owner.dispose();
});
