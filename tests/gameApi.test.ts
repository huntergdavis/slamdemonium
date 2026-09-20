import { describe, expect, it } from 'vitest';
import { createGameStub } from '../src/core/gameApi';

describe('the scaffold automation contract', () => {
  it('starts unready and does not pretend unfinished gameplay is available', () => {
    const game = createGameStub();
    expect(game.ready).toBe(false);
    expect(() => game.stepMany(120)).toThrow('not wired yet');
    expect(() => game.tuning.get('gravity')).toThrow('not wired yet');
  });
});
