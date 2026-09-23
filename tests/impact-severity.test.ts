import { describe, expect, it } from 'vitest';
import {
  SEVERITY_FLOOR_SPEED,
  SEVERITY_FULL_SPEED,
  createImpactSeverity,
  estimateImpactSeverity,
} from '../src/core/impactSeverity';

const into = { x: 0, y: 0, z: 1 }; // Wall ahead of a car driving toward -Z.

describe('shared impact severity', () => {
  it('estimates closing speed along the normal into the vehicle and flags it as estimated', () => {
    const out = createImpactSeverity();
    estimateImpactSeverity(null, { x: 0, y: 0, z: -10 }, into, 1300, out);
    expect(out).toEqual({
      approachSpeed: 10,
      energy: 0.5 * 1300 * 100,
      severity:
        (10 - SEVERITY_FLOOR_SPEED) /
        (SEVERITY_FULL_SPEED - SEVERITY_FLOOR_SPEED),
      estimated: true,
    });
    estimateImpactSeverity(null, { x: 0, y: 0, z: 10 }, into, 1300, out);
    expect(out.approachSpeed).toBe(0); // Separating: no impact.
    expect(out.severity).toBe(0);
  });
  it('uses a solved impulse as a velocity change when an engine supplies one', () => {
    const out = estimateImpactSeverity(
      2600,
      { x: 0, y: 0, z: -50 },
      into,
      1300,
      createImpactSeverity(),
    );
    expect(out.approachSpeed).toBe(2);
    expect(out.estimated).toBe(false);
  });
  it('is a scrape below the floor speed and saturates at the full speed', () => {
    const out = createImpactSeverity();
    estimateImpactSeverity(
      null,
      { x: 0, y: 0, z: -SEVERITY_FLOOR_SPEED },
      into,
      1300,
      out,
    );
    expect(out.severity).toBe(0);
    estimateImpactSeverity(null, { x: 0, y: 0, z: -40 }, into, 1300, out);
    expect(out.severity).toBe(1);
  });
  it('treats a landing exactly like a smash: the ground normal and the vertical closing speed', () => {
    const out = estimateImpactSeverity(
      null,
      { x: 0, y: -6, z: -30 },
      { x: 0, y: 1, z: 0 },
      1300,
      createImpactSeverity(),
    );
    expect(out.approachSpeed).toBe(6); // Forward speed does not count on a flat landing.
  });
  it('yields a zero record for invalid mass or non-finite input', () => {
    const out = estimateImpactSeverity(
      null,
      { x: 0, y: 0, z: -10 },
      into,
      0,
      createImpactSeverity(),
    );
    expect(out).toEqual({
      approachSpeed: 0,
      energy: 0,
      severity: 0,
      estimated: true,
    });
    estimateImpactSeverity(null, { x: NaN, y: 0, z: 0 }, into, 1300, out);
    expect(out.approachSpeed).toBe(0);
  });
});
