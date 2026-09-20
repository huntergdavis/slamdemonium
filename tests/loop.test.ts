import { describe, expect, it } from 'vitest';
import { FixedStepLoop } from '../src/core/loop';
import type { LoopHooks, LoopSettings } from '../src/core/loop';
import { TransformHistory } from '../src/core/transforms';

function harness(settings: LoopSettings = { physicsHz: 120, timeScale: 1 }) {
  const steps: number[] = [];
  const alphas: number[] = [];
  const order: string[] = [];
  const hooks: LoopHooks = {
    sampleForStep: () => {
      order.push('input');
    },
    preStep: () => {
      order.push('pre');
    },
    stepPhysics: (dt) => {
      steps.push(dt);
      order.push('physics');
    },
    postStep: () => {
      order.push('post');
    },
    render: (alpha) => {
      alphas.push(alpha);
    },
  };
  return {
    loop: new FixedStepLoop(settings, hooks),
    settings,
    hooks,
    steps,
    alphas,
    order,
  };
}

describe('fixed physics timestep', () => {
  it('shares a scaled render delta without advancing effects during pause or discarded catch-up time', () => {
    const h = harness({ physicsHz: 120, timeScale: 0.5 });
    h.loop.frame(0);
    expect(h.loop.renderDeltaSeconds).toBe(0);
    h.loop.frame(1000 / 60);
    expect(h.loop.renderDeltaSeconds).toBeCloseTo(1 / 120);
    expect(h.loop.simulationSeconds).toBeCloseTo(1 / 120);
    h.loop.setPaused(true);
    h.loop.frame(1000);
    expect(h.loop.renderDeltaSeconds).toBe(0);
    h.loop.setPaused(false);
    h.settings.timeScale = 2;
    h.loop.frame(2000);
    h.loop.frame(3000);
    expect(h.loop.renderDeltaSeconds).toBeCloseTo(8 / 120);
    h.loop.stepMany(120);
    expect(h.loop.renderDeltaSeconds).toBe(0);
    expect(h.loop.simulationSeconds).toBeCloseTo(1 + 9 / 120);
  });
  for (const displayHz of [60, 144]) {
    for (const timeScale of [0.05, 0.5, 1, 2]) {
      it(`runs ${120 * timeScale} steps per real second at ${displayHz} display Hz / ${timeScale}x`, () => {
        const h = harness({ physicsHz: 120, timeScale });
        for (let i = 0; i <= displayHz; i++)
          h.loop.frame((i * 1000) / displayHz);
        expect(h.steps).toHaveLength(120 * timeScale);
        expect(h.steps.every((dt) => dt === 1 / 120)).toBe(true);
        expect(h.alphas.every((alpha) => alpha >= 0 && alpha < 1)).toBe(true);
        expect(h.loop.droppedSeconds).toBe(0);
      });
    }
  }

  it('samples the latest event state immediately before every individual step', () => {
    const h = harness();
    h.loop.frame(0);
    h.loop.frame(1000 / 60);
    expect(h.order).toEqual([
      'input',
      'pre',
      'physics',
      'post',
      'input',
      'pre',
      'physics',
      'post',
    ]);
  });

  it('clamps huge gaps, runs at most eight steps, and discards excess debt', () => {
    const h = harness({ physicsHz: 120, timeScale: 2 });
    h.loop.frame(0);
    h.loop.frame(60_000);
    expect(h.steps).toHaveLength(8);
    expect(h.loop.droppedSeconds).toBeCloseTo(16 / 120, 10);
    expect(h.loop.alpha).toBeGreaterThanOrEqual(0);
    expect(h.loop.alpha).toBeLessThan(1);
    h.loop.frame(60_000 + 1000 / 60);
    expect(h.loop.stepsThisFrame).toBe(4);
    expect(h.steps).toHaveLength(12);
  });

  it('pauses a hidden tab and resumes without catching up', () => {
    const h = harness();
    h.loop.frame(0);
    h.loop.frame(1000 / 60);
    h.loop.setPaused(true);
    h.loop.frame(300_000);
    expect(h.steps).toHaveLength(2);
    h.loop.setPaused(false);
    h.loop.frame(600_000);
    expect(h.steps).toHaveLength(2);
    h.loop.frame(600_000 + 1000 / 60);
    expect(h.steps).toHaveLength(4);
  });

  it('changes timeScale by step count and physicsHz by constant step size', () => {
    const h = harness();
    h.loop.frame(0);
    h.loop.frame(1000 / 60);
    h.settings.timeScale = 0.5;
    h.loop.frame(2000 / 60);
    expect(h.steps).toEqual([1 / 120, 1 / 120, 1 / 120]);
    h.settings.physicsHz = 240;
    h.loop.frame(3000 / 60);
    expect(h.steps.slice(3)).toEqual([1 / 240, 1 / 240]);
  });

  it('does not step on a zero or backwards frame delta', () => {
    const h = harness();
    h.loop.frame(20);
    h.loop.frame(20);
    h.loop.frame(10);
    expect(h.steps).toHaveLength(0);
    expect(h.loop.alpha).toBe(0);
  });

  it('supports deterministic manual stepping without wall-clock debt', () => {
    const h = harness();
    h.loop.stepMany(120);
    expect(h.loop.totalSteps).toBe(120);
    expect(h.steps.every((dt) => dt === 1 / 120)).toBe(true);
    h.loop.frame(5000);
    expect(h.loop.totalSteps).toBe(120);
    expect(() => h.loop.stepMany(-1)).toThrow(RangeError);
    expect(() => h.loop.stepMany(1.5)).toThrow(RangeError);
  });

  it('rejects non-finite settings instead of entering an infinite step loop', () => {
    expect(() => harness({ physicsHz: Infinity, timeScale: 1 })).toThrow(
      RangeError,
    );
    expect(() => harness({ physicsHz: 120, timeScale: NaN })).toThrow(
      RangeError,
    );
    expect(() =>
      harness({ physicsHz: 120, timeScale: 1, maxStepsPerFrame: 0 }),
    ).toThrow(RangeError);
  });
});

it('lerps position, slerps rotation, and reuses the render transform', () => {
  let angle = 0;
  let x = 0;
  const history = new TransformHistory(
    {
      getTransform(_id, pos, quat) {
        pos.x = x;
        pos.y = 0;
        pos.z = 0;
        quat.x = 0;
        quat.y = Math.sin(angle / 2);
        quat.z = 0;
        quat.w = Math.cos(angle / 2);
      },
    },
    0,
  );
  history.beforeStep();
  x = 10;
  angle = Math.PI / 2;
  history.afterStep();
  const result = history.interpolate(0.5);
  expect(result.position.x).toBe(5);
  expect(result.rotation.y).toBeCloseTo(Math.sin(Math.PI / 8), 10);
  expect(result.rotation.w).toBeCloseTo(Math.cos(Math.PI / 8), 10);
  expect(history.interpolate(0.75)).toBe(result);
  expect(history.current.position.x).toBe(10);
  expect(history.previous.position.x).toBe(0);
});
