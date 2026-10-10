import { Scene } from 'three';
import { expect, it } from 'vitest';
import { createWreckParticles } from '../src/render/wreckParticles';

const point = { x: 0, y: 1.2, z: 0 };
const normal = { x: 1, y: 0, z: 0 };
const velocity = { x: 22, y: 0, z: 0 };
const player = { x: 0, z: 0 };

it('bounds a hard crash burst, deduplicates the contact, and clears without bodies', () => {
  const scene = new Scene();
  const effects = createWreckParticles(scene);
  try {
    expect(scene.children).toHaveLength(3);
    effects.noteContact(1, 2, point, 0, normal, velocity, 24, 0, true, player);
    effects.advance(1 / 60);
    expect(effects.burstCount).toBe(1);
    expect(effects.activeSparks).toBeGreaterThan(0);
    expect(effects.activeMetal).toBeGreaterThan(0);
    expect(effects.activeGlass).toBeGreaterThan(0);
    effects.noteContact(1, 2, point, 0, normal, velocity, 24, 0, true, player);
    effects.advance(1 / 60);
    expect(effects.burstCount).toBe(1);
    for (let id = 3; id < 16; id++)
      effects.noteContact(
        id,
        id + 100,
        point,
        0,
        normal,
        velocity,
        60,
        0,
        true,
        player,
      );
    effects.advance(1 / 60);
    expect(effects.activeSparks).toBeLessThanOrEqual(48);
    expect(effects.activeMetal).toBeLessThanOrEqual(24);
    expect(effects.activeGlass).toBeLessThanOrEqual(16);
    expect(effects.dropped).toBeGreaterThan(0);
    effects.advance(3);
    expect(
      effects.activeSparks + effects.activeMetal + effects.activeGlass,
    ).toBe(0);
    effects.reset();
    expect(effects.burstCount).toBe(0);
    effects.render();
    expect(
      scene.children.every(
        (child) =>
          child instanceof Object && 'count' in child && child.count === 0,
      ),
    ).toBe(true);
  } finally {
    effects.dispose();
  }
  expect(scene.children).toHaveLength(0);
});

it('emits sparks only after sustained nearby grind contact', () => {
  const effects = createWreckParticles(new Scene());
  try {
    effects.noteContact(
      1,
      2,
      { x: 500, y: 1, z: 0 },
      0,
      normal,
      velocity,
      0,
      8,
      false,
      player,
    );
    effects.advance(1 / 60);
    expect(effects.grindCount).toBe(0);
    for (let step = 0; step < 12; step++) {
      effects.noteContact(
        1,
        2,
        point,
        0,
        normal,
        velocity,
        0,
        8,
        false,
        player,
      );
      effects.advance(1 / 60);
    }
    expect(effects.grindCount).toBeGreaterThan(0);
    expect(effects.burstCount).toBe(0);
    expect(effects.activeSparks).toBeGreaterThan(0);
    const count = effects.grindCount;
    effects.advance(0.2);
    expect(effects.grindCount).toBe(count);
  } finally {
    effects.dispose();
  }
});
