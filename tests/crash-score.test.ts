import { describe, expect, it } from 'vitest';
import { CrashScore } from '../src/core/crashScore';

describe('crash score', () => {
  it('awards severity-based points and chains successive breaks', () => {
    const score = new CrashScore();
    score.recordBreakSeverity(0);
    expect(score.state.total).toBe(100);
    expect(score.state.lastAward).toBe(100);
    score.update(0.5);
    score.recordBreakSeverity(1);
    expect(score.state.lastAward).toBe(1000);
    expect(score.state.total).toBe(1100);
    expect(score.state.chainCount).toBe(2);
    expect(score.state.multiplier).toBe(2);
  });

  it('expires the chain but preserves the free-drive total', () => {
    const score = new CrashScore();
    score.recordBreakSeverity(0.5);
    const total = score.state.total;
    score.update(2);
    expect(score.state.total).toBe(total);
    expect(score.state.chainCount).toBe(0);
    expect(score.state.multiplier).toBe(1);
    expect(score.state.chainRemainingSeconds).toBe(0);
  });

  it('clears only the chain for a respawn', () => {
    const score = new CrashScore();
    score.recordBreakSeverity(0.5);
    const total = score.state.total;
    score.resetChain();
    expect(score.state.total).toBe(total);
    expect(score.state.chainCount).toBe(0);
    expect(score.state.chainRemainingSeconds).toBe(0);
  });
});
