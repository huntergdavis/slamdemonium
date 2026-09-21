export interface BuildIdentityInput {
  version: string;
  lockVersion: string;
  lockRootVersion: string;
  commit: string;
  dirty: boolean;
  releaseTag?: string;
  releaseCandidate?: boolean;
}

/** No clock or host data: identical source and release intent produce the same identity. */
export function buildIdentity(input: BuildIdentityInput) {
  const { version, commit, dirty, releaseTag, releaseCandidate } = input;
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error(
      'package.json version must be a stable semantic version X.Y.Z',
    );
  }
  if (input.lockVersion !== version || input.lockRootVersion !== version) {
    throw new Error(
      'package.json and both package-lock.json versions must agree',
    );
  }
  if (!/^[a-f0-9]{40}$/.test(commit)) {
    throw new Error('Build identity requires the full source commit');
  }
  if (releaseTag && (releaseTag !== `v${version}` || dirty)) {
    throw new Error(
      'Release builds require a clean checkout and matching vX.Y.Z tag',
    );
  }
  if (releaseCandidate && !releaseTag) {
    throw new Error(
      'A release candidate requires the intended matching release tag',
    );
  }
  const channel = releaseCandidate
    ? 'candidate'
    : releaseTag
      ? 'release'
      : 'unreleased';
  const shortCommit = commit.slice(0, 7);
  const prefix = releaseCandidate
    ? 'UNRELEASED CANDIDATE · '
    : releaseTag
      ? 'RELEASE '
      : 'UNRELEASED · ';
  const label = `${prefix}v${version} · ${shortCommit}${dirty ? '-dirty' : ''}`;
  return {
    version,
    commit,
    shortCommit,
    channel,
    tag: releaseTag ?? null,
    dirty,
    label,
  };
}
