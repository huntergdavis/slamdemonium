import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { SETTLE_SECONDS, SHOTS, VIEWPORT } from './shotlist';
import type { Shot } from './shotlist';

const OUT_DIR = fileURLToPath(new URL('../docs/screenshots/', import.meta.url));

/** Resolve on the second animation frame so the picture reflects the latest physics state. */
async function nextRenderedFrame(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

async function runScenario(page: Page, shot: Shot): Promise<void> {
  switch (shot.scenario) {
    case 'rest': {
      // Deterministic: respawn to the fixed spawn pose, step a fixed number of
      // physics steps, then wait for the body to be at rest rather than sleeping.
      const target = await page.evaluate((settleSeconds) => {
        const game = window.__game;
        game.respawn();
        const steps = Math.round(settleSeconds * game.tuning.get('physicsHz'));
        game.stepMany(steps);
        return Number(game.getTelemetry().totalSteps);
      }, SETTLE_SECONDS);
      await page.waitForFunction(
        (minSteps) => {
          const t = window.__game.getTelemetry();
          return Number(t.totalSteps) >= minSteps && Number(t.speed) < 1e-3;
        },
        target,
        { timeout: 15_000 },
      );
      return;
    }
    default:
      throw new Error(
        `Scenario "${shot.scenario}" is not wired yet. Keep the shot pending until: ${shot.needs ?? 'unknown'}`,
      );
  }
}

test.describe.configure({ mode: 'serial' });

for (const shot of SHOTS) {
  test(`${shot.file} (${shot.preset}, ${shot.scenario})`, async ({ page }) => {
    test.skip(
      shot.status === 'pending',
      `pending: needs ${shot.needs ?? 'a dependency that has not landed'}`,
    );
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });

    await page.setViewportSize(VIEWPORT);
    await page.goto('./');
    await page.waitForFunction(() => window.__game?.ready);
    await page.evaluate(
      (preset) => window.__game.tuning.applyPreset(preset),
      shot.preset,
    );
    await runScenario(page, shot);
    await nextRenderedFrame(page);

    await mkdir(OUT_DIR, { recursive: true });
    const file = path.join(OUT_DIR, shot.file);
    await page.screenshot({
      path: file,
      animations: 'disabled',
      caret: 'hide',
      clip: { x: 0, y: 0, ...VIEWPORT },
    });
    expect(errors).toEqual([]);
    console.log(`wrote ${path.relative(process.cwd(), file)}`);
  });
}
