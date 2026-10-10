import { Scene } from 'three';
import { expect, it } from 'vitest';
import { createWreckEffects } from '../src/render/wreckEffects';
import { CAR_MODEL_KINDS, detachedPanelAnchors } from '../src/world/carModels';
import type { TrafficCarState } from '../src/world/traffic';

const wreck = (id: number): TrafficCarState =>
  ({
    id,
    modelKind: 'sedan',
    position: { x: id * 5, y: 1.2, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    velocity: { x: 10, y: 0, z: 0 },
    crush: { front: 0.75, rear: 0, left: 0, right: 0 },
    rival: false,
    wrecked: true,
  }) as TrafficCarState;

it('keeps departing panels bounded and resets an encounter after rejoin', () => {
  const scene = new Scene();
  const effects = createWreckEffects(scene, false);
  const first = wreck(1);
  const second = wreck(2);
  const third = wreck(3);
  const far = wreck(1000);
  try {
    effects.consume([first], [first], { x: 0, z: 0 });
    expect(effects.activeCount).toBe(2);
    effects.consume([first], [first], { x: 0, z: 0 });
    expect(effects.activeCount).toBe(2);
    effects.consume([second, third, far], [first, second, third, far], {
      x: 0,
      z: 0,
    });
    expect(effects.activeCount).toBe(4);
    effects.advance(3);
    expect(effects.activeCount).toBe(0);
    effects.consume([first], [first], { x: 0, z: 0 });
    expect(effects.activeCount).toBe(0);
    first.wrecked = false;
    effects.consume([], [first], { x: 0, z: 0 });
    first.wrecked = true;
    effects.consume([first], [first], { x: 0, z: 0 });
    expect(effects.activeCount).toBe(2);
    effects.reset();
    expect(effects.activeCount).toBe(0);
    effects.consume([far], [far], { x: 0, z: 0 });
    expect(effects.activeCount).toBe(0);
    expect(scene.children).toHaveLength(1);
  } finally {
    effects.dispose();
  }
  expect(scene.children).toHaveLength(0);
});

it('anchors every kind at the actual front, rear and door sides', () => {
  for (const kind of CAR_MODEL_KINDS) {
    const front = detachedPanelAnchors(kind, 'front');
    const rear = detachedPanelAnchors(kind, 'rear');
    const left = detachedPanelAnchors(kind, 'left');
    const right = detachedPanelAnchors(kind, 'right');
    expect(front).toHaveLength(2);
    expect(rear).toHaveLength(2);
    expect(left).toHaveLength(2);
    expect(right).toHaveLength(2);
    expect(front.every((panel) => panel.offset[2] > 0)).toBe(true);
    expect(rear.every((panel) => panel.offset[2] < 0)).toBe(true);
    expect(left.every((panel) => panel.offset[0] < 0)).toBe(true);
    expect(right.every((panel) => panel.offset[0] > 0)).toBe(true);
  }
});
