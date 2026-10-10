import { describe, expect, it } from 'vitest';
import { racePaceTarget } from '../src/world/racePace';

describe('circuit race pace', () => {
  it('pulses boost and caps catch-up without a position jump', () => {
    expect(racePaceTarget(50, 50, 20, 0, 0)).toBe(62);
    expect(racePaceTarget(50, 85, -300, 0, 0)).toBe(70);
    expect(racePaceTarget(50, 85, -300, 3, 7)).toBe(58);
  });

  it('lets a far-ahead rival ease back while a coasting player can be beaten', () => {
    expect(racePaceTarget(50, 0, 230, 3, 7)).toBe(38);
    expect(racePaceTarget(50, 0, 20, 3, 7)).toBe(50);
  });
});
