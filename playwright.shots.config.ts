import { defineConfig, devices } from '@playwright/test';

// Documentation screenshots: `npm run shots`. Builds the real production bundle
// (no test fixture) and captures each shot listed in shots/shotlist.ts into
// docs/screenshots/. See docs/screenshots/README.md for the conventions.
const port = Number(process.env.SHOTS_PORT || 4179);
const origin = 'http://127.0.0.1:' + port;
const baseURL = origin + (process.env.VITE_BASE_PATH || '/');

export default defineConfig({
  testDir: './shots',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: 'test-results/shots',
  use: {
    baseURL,
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    trace: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: 1,
        launchOptions: { args: ['--enable-unsafe-swiftshader'] },
      },
    },
  ],
  webServer: {
    command:
      'npm run build && npm run preview -- --port ' + port + ' --strictPort',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
