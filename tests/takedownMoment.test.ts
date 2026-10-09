import { describe, expect, it } from 'vitest';
import { PerspectiveCamera } from 'three';
import { TakedownMoment, canFocusTakedown } from '../src/render/takedownMoment';
import type { TrafficCarState } from '../src/world/traffic';

describe('takedown moment', () => {
  const player = { x: 0, y: 1, z: 0 };
  const forward = { x: 0, z: -1 };

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
    moment.apply(camera, [car], player, forward, 1000);
    expect(camera.position.x).toBeCloseTo(0);
    moment.apply(camera, [car], player, forward, 1375);
    expect(camera.position.x).toBeGreaterThan(0);
    camera.position.set(0, 3, 8);
    moment.apply(camera, [car], player, forward, 1750);
    expect(camera.position.x).toBeCloseTo(0);
  });

  it('rejects a wreck behind or far from the player', () => {
    const car = {
      id: 4,
      position: { x: 0, y: 1, z: -20 },
    } as TrafficCarState;
    expect(canFocusTakedown(car, player, forward)).toBe(true);
    car.position.z = 2;
    expect(canFocusTakedown(car, player, forward)).toBe(false);
    car.position.z = -61;
    expect(canFocusTakedown(car, player, forward)).toBe(false);
  });

  it('ends the camera and slowdown if the target passes behind mid-beat', () => {
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
    moment.apply(camera, [car], player, forward, 1250);
    expect(camera.position.x).toBeGreaterThan(0);
    car.position.z = 1;
    camera.position.set(0, 3, 8);
    moment.apply(camera, [car], player, forward, 1300);
    expect(camera.position.x).toBe(0);
    expect(moment.timeScaleAt(1300)).toBe(1);
  });
});
