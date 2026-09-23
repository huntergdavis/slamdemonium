import { expect, it } from 'vitest';
import { BREAKABLE_PROP_PLACEMENTS } from '../src/world/breakablePlacements';

it('keeps the proving-ground banks and gates outside runways and targets', () => {
  expect(BREAKABLE_PROP_PLACEMENTS).toHaveLength(48);
  for (const placement of BREAKABLE_PROP_PLACEMENTS) {
    const { x, z } = placement.position;
    // Five metres outside each 16 m runway lane.
    expect(!(Math.abs(x) <= 13 && z >= -350 && z <= 350)).toBe(true);
    expect(!(Math.abs(z) <= 13 && x >= -350 && x <= 350)).toBe(true);
    expect(!(x >= -47 && x <= -25 && z >= -200 && z <= 40)).toBe(true);
    expect(!(x >= 23 && x <= 49 && z >= -200 && z <= 40)).toBe(true);
    // Giant-ramp landing corridor and both loop target corridors.
    expect(!(Math.abs(x) <= 20 && z >= 35 && z <= 445)).toBe(true);
    expect(!(x >= -57 && x <= -25 && z >= 17 && z <= 63)).toBe(true);
    expect(!(x >= 25 && x <= 57 && z >= 17 && z <= 63)).toBe(true);
    expect(placement.position.y).toBeGreaterThanOrEqual(0.5);
    expect(Math.hypot(x, z)).toBeLessThan(380);
  }
  const banks = BREAKABLE_PROP_PLACEMENTS.slice(0, 32).filter(
    (_, index) => index % 8 === 0,
  );
  for (let i = 0; i < banks.length; i++)
    for (let j = i + 1; j < banks.length; j++) {
      const a = banks[i]!.position;
      const b = banks[j]!.position;
      expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(80);
    }
  for (const placement of BREAKABLE_PROP_PLACEMENTS.slice(0, 32)) {
    expect(placement.position.y).toBe(0.5);
  }
});
