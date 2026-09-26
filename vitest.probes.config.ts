import { defineConfig } from 'vitest/config';

/** Measurement probes, never a gate: `npx vitest run --config vitest.probes.config.ts [name]`.
 * They take minutes and write JSON to scratch/; CI never runs this config. */
export default defineConfig({
  test: {
    include: ['scripts/perf/probes/**/*.probe.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 3_600_000,
  },
});
