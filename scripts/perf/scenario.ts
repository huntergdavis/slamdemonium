import type { Page } from '@playwright/test';

/** Scene/reset policy is separate from WP11's input document and player. */
export interface PerfScenario {
  name: string;
  description: string;
  /** Called with simulation paused, before each complete replay. */
  setup(page: Page): Promise<void>;
}

export interface PerfInputSource {
  identity: string;
  /** Arm while paused; return exact totalSteps. Never sample by wall time. */
  prepare(page: Page): Promise<number>;
}
