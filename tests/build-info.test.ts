import { describe, expect, it } from 'vitest';
import { buildIdentity } from '../scripts/build-info';

const source = {
  version: '0.1.0',
  lockVersion: '0.1.0',
  lockRootVersion: '0.1.0',
  commit: 'a'.repeat(40),
  dirty: false,
};

describe('player build identity', () => {
  it('marks every ordinary build unreleased, even from a clean checkout', () => {
    expect(buildIdentity(source).label).toBe('UNRELEASED · v0.1.0 · aaaaaaa');
    expect(buildIdentity({ ...source, dirty: true }).label).toContain(
      'aaaaaaa-dirty',
    );
  });
  it('identifies a clean release without changing the source version', () => {
    expect(buildIdentity({ ...source, releaseTag: 'v0.1.0' })).toMatchObject({
      channel: 'release',
      tag: 'v0.1.0',
      label: 'RELEASE v0.1.0 · aaaaaaa',
      commit: source.commit,
    });
  });
  it('keeps staged candidates visibly unreleased inside the pause menu', () => {
    expect(
      buildIdentity({
        ...source,
        releaseTag: 'v0.1.0',
        releaseCandidate: true,
      }),
    ).toMatchObject({
      channel: 'candidate',
      tag: 'v0.1.0',
      label: 'UNRELEASED CANDIDATE · v0.1.0 · aaaaaaa',
    });
    expect(() =>
      buildIdentity({ ...source, releaseCandidate: true }),
    ).toThrow();
  });
  it('rejects mismatched tags, lockfiles, dirty releases and invalid source identity', () => {
    for (const change of [
      { releaseTag: 'v0.2.0' },
      { releaseTag: 'v0.1.0', dirty: true },
      { lockVersion: '0.0.0' },
      { lockRootVersion: '0.0.0' },
      { commit: 'unknown' },
      { version: '01.0.0' },
      { version: '0.1.0-beta' },
    ])
      expect(() => buildIdentity({ ...source, ...change })).toThrow();
  });
});
