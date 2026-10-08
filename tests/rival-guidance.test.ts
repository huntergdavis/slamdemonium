import { PerspectiveCamera } from 'three';
import { expect, it, vi } from 'vitest';
import { createRivalGuidance } from '../src/ui/rivalGuidance';
import type { TrafficCarState } from '../src/world/traffic';

it('places a rival badge over the correct horizontal side at DPR 2', () => {
  vi.stubGlobal('window', {
    innerWidth: 1440,
    innerHeight: 900,
    devicePixelRatio: 2,
  });
  const elements: {
    className: string;
    dataset: Record<string, string>;
    style: { display?: string; transform?: string };
    textContent: string;
    append(...children: unknown[]): void;
    remove(): void;
  }[] = [];
  const createElement = () => {
    const element = {
      className: '',
      dataset: {},
      style: {},
      textContent: '',
      append() {},
      remove() {},
    };
    elements.push(element);
    return element;
  };
  const host = {
    ownerDocument: { createElement },
    append() {},
  } as unknown as HTMLElement;
  const camera = new PerspectiveCamera(70, 1440 / 900, 0.1, 2000);
  camera.position.set(0, 2, 0);
  camera.lookAt(0, 2, -1);
  const car = {
    id: 1,
    rival: true,
    wrecked: false,
    position: { x: 4, y: 0, z: -20 },
  } as TrafficCarState;
  const guidance = createRivalGuidance(host);
  try {
    const badgeX = () => {
      guidance.update(camera, [car], { x: 0, y: 0, z: 0 });
      const badge = elements.find(
        (element) => element.className === 'sl-rival-marker',
      )!;
      expect(badge.style.display).toBe('');
      return Number(
        badge.style.transform?.match(/translate\(([-\d.]+)px/)?.[1],
      );
    };
    expect(badgeX()).toBeGreaterThan(720);
    car.position.x = -4;
    expect(badgeX()).toBeLessThan(720);
  } finally {
    guidance.dispose();
    vi.unstubAllGlobals();
  }
});
