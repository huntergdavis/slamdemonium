import { defineConfig, loadEnv } from 'vite';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { buildIdentity } from './scripts/build-info.ts';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  const identity = buildIdentity({
    version: pkg.version,
    lockVersion: lock.version,
    lockRootVersion: lock.packages[''].version,
    commit: execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim(),
    dirty: Boolean(
      execFileSync('git', ['status', '--porcelain'], {
        encoding: 'utf8',
      }).trim(),
    ),
    ...(process.env.RELEASE_TAG ? { releaseTag: process.env.RELEASE_TAG } : {}),
  });
  return {
    base: env.VITE_BASE_PATH || '/',
    define: {
      'import.meta.env.VITE_BUILD_LABEL': JSON.stringify(identity.label),
    },
    plugins: [
      {
        name: 'build-identity',
        generateBundle() {
          this.emitFile({
            type: 'asset',
            fileName: 'build-info.json',
            source: JSON.stringify(identity, null, 2) + '\n',
          });
        },
      },
    ],
  };
});
