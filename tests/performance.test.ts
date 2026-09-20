import { afterEach, describe, expect, it, vi } from 'vitest';
import { FixedStepLoop } from '../src/core/loop';
import { PerformanceRecorder } from '../src/core/performance';
import { parseConfig } from '../scripts/perf/config';
import { assess, growthPercent, summarize } from '../scripts/perf/metrics';
import type { MemorySample } from '../scripts/perf/metrics';

afterEach(() => vi.restoreAllMocks());

describe('performance capture', () => {
  it('stops exactly at EOF inside a catch-up frame or oversized stepMany request', () => {
    for (const mode of ['frame', 'manual']) {
      let completed = 0;
      const loop = new FixedStepLoop(
        { physicsHz: 120, timeScale: 1 },
        {
          shouldStopStepping: () => completed === 3,
          sampleForStep() {},
          preStep() {},
          stepPhysics() {},
          render() {},
          postStep() {
            if (++completed === 3) loop.setPaused(true);
          },
        },
      );
      if (mode === 'frame') {
        loop.frame(0);
        loop.frame(100);
        loop.frame(200);
      } else {
        loop.stepMany(10);
        loop.stepMany(10);
      }
      expect(completed).toBe(3);
      expect(loop.totalSteps).toBe(3);
    }
  });
  it('captures every catch-up step, including input/pre/post work, separately from engine cost', () => {
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const measurement = new PerformanceRecorder();
    const loop = new FixedStepLoop(
      { physicsHz: 120, timeScale: 1 },
      {
        measurement,
        sampleForStep() {
          clock += 1;
        },
        preStep() {
          clock += 2;
        },
        stepPhysics() {
          clock += 3;
          measurement.recordEngineStep(3);
        },
        postStep() {
          clock += 4;
        },
        render() {
          clock += 20;
        },
      },
    );
    measurement.start();
    loop.frame(0);
    loop.frame(1000 / 60);
    const batch = measurement.drain();
    expect(batch.physicsStepMs).toEqual([10, 10]);
    expect(batch.engineStepMs).toEqual([3, 3]);
    expect(batch.frameMs).toEqual([1000 / 60]);
    expect(measurement.drain().physicsStepMs).toEqual([]);
  });

  it('excludes only explicit GC pauses and preserves intervals across drains', () => {
    const recorder = new PerformanceRecorder();
    recorder.start();
    recorder.recordFrame(10);
    recorder.recordFrame(26);
    expect(recorder.drain().frameMs).toEqual([16]);
    recorder.recordFrame(42);
    recorder.setPaused(true);
    recorder.recordFrame(1000);
    recorder.recordStep(999);
    recorder.setPaused(false);
    recorder.recordFrame(2000);
    recorder.recordFrame(2017);
    expect(recorder.drain()).toEqual({
      frameMs: [16, 17],
      physicsStepMs: [],
      engineStepMs: [],
      droppedSamples: 0,
    });
  });

  it('reports overflow instead of silently dropping a slow tail', () => {
    const recorder = new PerformanceRecorder(2);
    recorder.start();
    recorder.recordStep(1);
    recorder.recordStep(2);
    recorder.recordStep(100);
    expect(recorder.drain()).toMatchObject({
      physicsStepMs: [1, 2],
      droppedSamples: 1,
    });
  });
});

function memory(patch: Partial<MemorySample> = {}): MemorySample {
  return {
    elapsedSeconds: 60,
    jsUsedBytes: 100,
    jsTotalBytes: 200,
    backingStorageBytes: 1000,
    wasmHeapBytes: 1000,
    wasmFreeBytes: 800,
    wasmUsedBytes: 200,
    ...patch,
  };
}

describe('performance decisions', () => {
  it('uses nearest-rank p99 and rejects missing/nonfinite timing evidence', () => {
    expect(
      summarize(Array.from({ length: 100 }, (_, i) => i + 1)),
    ).toMatchObject({
      count: 100,
      meanMs: 50.5,
      p50Ms: 50,
      p95Ms: 95,
      p99Ms: 99,
      minMs: 1,
      maxMs: 100,
    });
    for (const samples of [[], [NaN], [Infinity], [-1]])
      expect(() => summarize(samples)).toThrow();
    expect(() => growthPercent(0, 1)).toThrow();
  });

  it('passes equality and fails physics, JS growth, and hidden WASM allocator growth independently', () => {
    const limits = { physicsP99Ms: 2, heapGrowthPercent: 10 };
    expect(
      assess(
        summarize([2]),
        memory(),
        memory({ jsUsedBytes: 110, wasmUsedBytes: 220 }),
        limits,
        0,
      ).failures,
    ).toEqual([]);
    const result = assess(
      summarize([2.01]),
      memory(),
      memory({ jsUsedBytes: 111, wasmUsedBytes: 230, wasmFreeBytes: 770 }),
      limits,
      0,
    );
    expect(result.failures).toHaveLength(3);
    expect(result.growth.wasmCapacityPercent).toBe(0);
    expect(result.growth.wasmUsedPercent).toBe(15);
    expect(
      assess(summarize([1]), memory(), memory(), limits, 1).failures[0],
    ).toContain('overflow');
  });

  it('exposes limits and validates duration/checkpoint configuration', () => {
    expect(() => parseConfig(['--input-script', 'drive.json'])).toThrow();
    expect(
      parseConfig(['--input-script', 'drive.json', '--script-tuning', 'verify'])
        .scriptTuning,
    ).toBe('verify');
    expect(parseConfig([]).limits).toEqual({
      physicsP99Ms: 2,
      heapGrowthPercent: 10,
    });
    expect(
      parseConfig(['--physics-p99-ms', '0.5', '--heap-growth-percent', '3'])
        .limits,
    ).toEqual({ physicsP99Ms: 0.5, heapGrowthPercent: 3 });
    for (const args of [
      ['--duration-seconds', '60'],
      ['--physics-p99-ms', 'NaN'],
      ['--heap-growth-percent=-1'],
      ['--port', '1.5'],
    ])
      expect(() => parseConfig(args)).toThrow();
  });
});
