import { expect, it } from 'vitest';
import { BREAKABLE_PROP_PLACEMENTS } from '../src/world/breakablePlacements';

it('keeps the proving-ground banks and gates outside runways and targets', () => {
  expect(BREAKABLE_PROP_PLACEMENTS).toHaveLength(192);
  for (const placement of BREAKABLE_PROP_PLACEMENTS) {
    const { x, z } = placement.position;
    // Five metres outside each 16 m runway lane.
    expect(!(Math.abs(x) <= 13 && z >= -350 && z <= 350)).toBe(true);
    expect(!(Math.abs(z) <= 13 && x >= -350 && x <= 350)).toBe(true);
    expect(!(x >= -47 && x <= -25 && z >= -200 && z <= 40)).toBe(true);
    expect(!(x >= 23 && x <= 49 && z >= -200 && z <= 40)).toBe(true);
    // The widened east-loop exit runs north from z=58 with shoulders to x=70.
    expect(!(x >= 48 && x <= 80 && z >= 58 && z <= 350)).toBe(true);
    // Giant-ramp landing corridor and both loop target corridors.
    expect(!(Math.abs(x) <= 20 && z >= 35 && z <= 445)).toBe(true);
    expect(!(x >= -57 && x <= -25 && z >= 17 && z <= 63)).toBe(true);
    expect(!(x >= 25 && x <= 57 && z >= 17 && z <= 63)).toBe(true);
    expect(placement.position.y).toBeGreaterThanOrEqual(0.5);
    expect(Math.hypot(x, z)).toBeLessThan(380);
  }
  // The first 144 records are twelve 12-prop encounter cells. Their centres
  // remain well apart so an 80 m/s car cannot pull two contact islands together.
  const cellCentres = [];
  for (let cell = 0; cell < 12; cell++) {
    const first = BREAKABLE_PROP_PLACEMENTS[cell * 12]!.position;
    cellCentres.push(first);
    for (let i = 1; i < 12; i++) {
      const member = BREAKABLE_PROP_PLACEMENTS[cell * 12 + i]!.position;
      expect(Math.hypot(member.x - first.x, member.z - first.z)).toBeLessThan(20);
    }
  }
  for (let i = 0; i < cellCentres.length; i++)
    for (let j = i + 1; j < cellCentres.length; j++) {
      const a = cellCentres[i]!;
      const b = cellCentres[j]!;
      expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(80);
    }
  for (const placement of BREAKABLE_PROP_PLACEMENTS.slice(0, 144)) {
    expect(placement.position.y).toBe(0.5);
  }
  expect(BREAKABLE_PROP_PLACEMENTS.slice(144)).toHaveLength(48);
});
