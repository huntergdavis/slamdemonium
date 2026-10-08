import { describe, expect, it } from 'vitest';
import { PerspectiveCamera } from 'three';
import { TakedownMoment } from '../src/render/takedownMoment';
import type { TrafficCarState } from '../src/world/traffic';

describe('takedown moment', () => {
  it('slows briefly in wall time, then returns to the chosen game speed', () => {
    const moment = new TakedownMoment();
    moment.start(4, 1000);
    expect(moment.timeScaleAt(1000)).toBe(0.4);
    expect(moment.timeScaleAt(1450)).toBe(0.4);
    expect(moment.timeScaleAt(1600)).toBeCloseTo(0.7);
    expect(moment.timeScaleAt(1750)).toBe(1);
  });

  it('blends from chase view and leaves it untouched at the end', () => {
    const moment = new TakedownMoment();
    const camera = new PerspectiveCamera();
    camera.position.set(0, 3, 8);
    camera.lookAt(0, 1, 0);
    const car = {
      id: 4,
      position: { x: 12, y: 1, z: -20 },
      forward: { x: 0, y: 0, z: -1 },
    } as TrafficCarState;
    moment.start(4, 1000);
    moment.apply(camera, [car], 1000);
    expect(camera.position.x).toBeCloseTo(0);
    moment.apply(camera, [car], 1375);
    expect(camera.position.x).toBeGreaterThan(0);
    camera.position.set(0, 3, 8);
    moment.apply(camera, [car], 1750);
    expect(camera.position.x).toBeCloseTo(0);
  });
});
