import { MeshBasicMaterial, MeshStandardMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import {
  applyPropGlow,
  describeImpostor,
  impostorScale,
} from '../src/render/propLook';

describe('small-prop visibility levers', () => {
  it('scales a far prop linearly from true size at the near radius to the far scale at the far radius', () => {
    expect(impostorScale(0, 2.5, 90, 200)).toBe(1);
    expect(impostorScale(90, 2.5, 90, 200)).toBe(1);
    expect(impostorScale(145, 2.5, 90, 200)).toBeCloseTo(1.75, 9);
    expect(impostorScale(200, 2.5, 90, 200)).toBe(2.5);
    expect(impostorScale(600, 2.5, 90, 200)).toBe(2.5);
    // Honest settings and bad radii degrade to true size.
    expect(impostorScale(300, 1, 90, 200)).toBe(1);
    expect(impostorScale(300, 0.5, 90, 200)).toBe(1);
    expect(impostorScale(300, 2, 200, 90)).toBe(1);
    expect(describeImpostor(2.5, 90, 200)).toBe(
      'true size inside 90 m, 2.5x at 200 m and beyond, linear between',
    );
    expect(describeImpostor(1, 90, 200)).toBe('true size everywhere');
  });

  it('turns the base colour into self-light by the glow fraction, clamped, and ignores materials without emissive', () => {
    const material = new MeshStandardMaterial({ color: 0xc86432 });
    applyPropGlow(material, 0.35);
    expect(material.emissive.getHex()).toBe(0xc86432);
    expect(material.emissiveIntensity).toBeCloseTo(0.35, 9);
    applyPropGlow(material, -1);
    expect(material.emissiveIntensity).toBe(0);
    applyPropGlow(material, 5);
    expect(material.emissiveIntensity).toBe(1);
    expect(() => applyPropGlow(new MeshBasicMaterial(), 0.5)).not.toThrow();
  });
});
