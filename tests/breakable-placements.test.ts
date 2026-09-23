import { expect, it } from 'vitest';
import { BREAKABLE_PROP_PLACEMENTS } from '../src/world/breakablePlacements';

it('keeps four banks and two gates within their authored infield zones', () => {
  expect(BREAKABLE_PROP_PLACEMENTS).toHaveLength(48);
  for (const placement of BREAKABLE_PROP_PLACEMENTS.slice(0, 32)) {
    expect(placement.position.z).toBeLessThan(0);
    expect(Math.hypot(placement.position.x, placement.position.z)).toBeLessThan(
      105,
    );
    expect(placement.position.y).toBe(0.5);
  }
  for (const placement of BREAKABLE_PROP_PLACEMENTS.slice(32)) {
    expect(placement.position.y).toBeGreaterThanOrEqual(0.5);
    expect(Math.hypot(placement.position.x, placement.position.z)).toBeLessThan(
      125,
    );
  }
});
