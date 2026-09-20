import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.E2E_PORT || 4173);
const origin = 'http://127.0.0.1:' + port;
const baseURL = origin + (process.env.VITE_BASE_PATH || '/');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  // Full track shadows run in software WebGL on CI; preserve real input assertions.
  timeout: 90_000,
  // Bound CPU contention between software WebGL and the physics benchmark.
  workers: 2,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { args: ['--enable-unsafe-swiftshader'] },
      },
    },
  ],
  webServer: {
    // Every spec exercises built assets; only E2E builds include the input fixture.
    env: { VITE_TEST_API: '1' },
    command:
      'npm run build && npm run preview -- --port ' + port + ' --strictPort',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
