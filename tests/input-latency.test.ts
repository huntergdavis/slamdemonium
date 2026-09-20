import { describe, expect, it } from 'vitest';
import { KeyboardInput, PROBE_QUEUE_CAPACITY } from '../src/input/keyboard';
import { LatencyProbe } from '../src/input/latencyProbe';
import { keyEvent } from './input-helpers';

function setup() {
  const target = new EventTarget();
  const keyboard = new KeyboardInput(target, { visibilityTarget: null });
  const probe = new LatencyProbe(keyboard.state, 10);
  const press = (timeStamp: number) => {
    keyEvent(target, 'keydown', 'KeyL', { timeStamp });
    keyEvent(target, 'keyup', 'KeyL', { timeStamp });
  };
  return { keyboard, probe, press };
}

describe('event-to-render latency probe', () => {
  it('waits for a sampled step and a nonnegative rAF delta, without consuming a sample twice', () => {
    const { keyboard, probe, press } = setup();
    press(101);
    expect(probe.eventTimestamp).toBe(101);
    probe.framePresented(105);
    expect(probe.stats.count).toBe(0);
    probe.sampleForStep();
    probe.framePresented(100);
    expect(probe.stats.count).toBe(0);
    probe.framePresented(111);
    expect(probe.stats).toMatchObject({
      count: 1,
      lastMs: 10,
      meanMs: 10,
      withinTarget: true,
    });
    probe.framePresented(121);
    expect(probe.stats.count).toBe(1);
    keyboard.dispose();
  });

  it('reports min, mean, p95 and max over 100 samples and reuses all buffers', () => {
    const { keyboard, probe, press } = setup();
    const stats = probe.stats;
    const samples = probe.samples;
    for (let index = 0; index < 100; index++) {
      press(index * 200);
      probe.sampleForStep();
      probe.framePresented(index * 200 + index + 1);
    }
    expect(probe.stats).toBe(stats);
    expect(probe.samples).toBe(samples);
    expect(stats).toMatchObject({
      count: 100,
      totalSamples: 100,
      minMs: 1,
      meanMs: 50.5,
      p95Ms: 95,
      maxMs: 100,
      withinTarget: false,
    });
    press(30000);
    probe.sampleForStep();
    probe.framePresented(30002);
    expect(stats.count).toBe(100);
    expect(stats.totalSamples).toBe(101);
    expect(stats.minMs).toBe(2);
    keyboard.dispose();
  });

  it('reports queue overruns instead of reading overwritten timestamps', () => {
    const { keyboard, probe, press } = setup();
    for (let index = 0; index < PROBE_QUEUE_CAPACITY + 2; index++) press(index);
    probe.sampleForStep();
    probe.framePresented(1000);
    expect(probe.stats.droppedEvents).toBe(2);
    expect(probe.stats.totalSamples).toBe(PROBE_QUEUE_CAPACITY);
    expect(probe.stats.count).toBe(100);
    keyboard.dispose();
  });
});
