import { describe, expect, it } from 'vitest';
import type { CrashScoreState } from '../src/core/crashScore';
import { HUD_CHAIN_LINGER_MS, HudChainState, isChainAlive } from '../src/ui/hudChain';

const quiet: CrashScoreState = {
  total: 0,
  chainCount: 0,
  multiplier: 1,
  chainRemainingSeconds: 0,
  lastAward: 0,
  awardAgeSeconds: Infinity,
  awardSerial: 0,
};
const smash = (over: Partial<CrashScoreState>): CrashScoreState => ({
  ...quiet,
  total: 500,
  chainCount: 1,
  multiplier: 1,
  chainRemainingSeconds: 2,
  lastAward: 500,
  awardAgeSeconds: 0,
  awardSerial: 1,
  ...over,
});

describe('the transient chain readout', () => {
  it('is hidden while cruising and appears the moment something is smashed', () => {
    const chain = new HudChainState();
    expect(chain.update(0, quiet)).toBe(false);
    expect(chain.update(10_000, quiet)).toBe(false);
    expect(chain.update(10_034, smash({}))).toBe(true);
    expect(isChainAlive(quiet)).toBe(false);
    expect(isChainAlive(smash({}))).toBe(true);
  });

  it('stays while the chain is alive and fades out three seconds after it dies', () => {
    const chain = new HudChainState();
    chain.update(0, smash({}));
    expect(chain.update(1500, smash({ chainRemainingSeconds: 0.5 }))).toBe(true);
    // The window lapses: the model zeroes the chain.
    const dead = smash({ chainCount: 0, multiplier: 1, chainRemainingSeconds: 0 });
    expect(chain.update(2000, dead)).toBe(true);
    expect(chain.update(2000 + HUD_CHAIN_LINGER_MS - 1, dead)).toBe(true);
    expect(chain.update(2000 + HUD_CHAIN_LINGER_MS, dead)).toBe(false);
    expect(chain.update(60_000, dead)).toBe(false);
  });

  it('a new smash during the fade-out keeps it up and restarts the linger', () => {
    const chain = new HudChainState();
    chain.update(0, smash({}));
    const dead = smash({ chainCount: 0, chainRemainingSeconds: 0 });
    chain.update(2000, dead);
    expect(chain.update(4000, smash({ chainCount: 1 }))).toBe(true);
    chain.update(6000, dead);
    expect(chain.update(6000 + HUD_CHAIN_LINGER_MS - 1, dead)).toBe(true);
    expect(chain.update(6000 + HUD_CHAIN_LINGER_MS, dead)).toBe(false);
  });

  it('a respawn ends the chain like a lapse, and a bad clock changes nothing', () => {
    const chain = new HudChainState();
    chain.update(0, smash({ chainCount: 3, multiplier: 3 }));
    expect(chain.update(NaN, quiet)).toBe(true);
    expect(chain.update(100, quiet)).toBe(true); // Respawn: chain zeroed, total kept.
    expect(chain.update(100 + HUD_CHAIN_LINGER_MS, quiet)).toBe(false);
  });
});
