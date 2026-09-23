import { expect, it } from 'vitest';
import { BREAKABLE_PROP_PLACEMENTS } from '../src/world/breakablePlacements';

it('keeps four authored banks inside the ring and ahead of spawn', () => {
  expect(BREAKABLE_PROP_PLACEMENTS).toHaveLength(32);
  for (const placement of BREAKABLE_PROP_PLACEMENTS) {
    expect(placement.position.z).toBeLessThan(0);
    expect(Math.hypot(placement.position.x, placement.position.z)).toBeLessThan(
      105,
    );
    expect(placement.position.y).toBe(0.5);
  }
});
