import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // The 300-second vehicle soak must not contend with the G0 timing gate.
    fileParallelism: false,
  },
});
