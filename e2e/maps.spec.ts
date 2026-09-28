import { expect, test } from '@playwright/test';

test.setTimeout(90_000);

/** The e2e build boots the lab ring by default (VITE_DEFAULT_MAP=lab in
 * playwright.config.ts) so every other spec keeps testing the world the
 * replay fixtures were recorded on. `?map=` switches worlds at runtime. */
test('the e2e build boots the lab ring, and ?map=proving-ground boots the proving ground', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('./');
  await page.waitForFunction(() => window.__game?.ready);
  const lab = await page.evaluate(() => {
    window.__game.respawn();
    window.__game.stepMany(1);
    return window.__game.getTelemetry();
  });
  expect((lab.position as { x: number }).x).toBeCloseTo(130, 1);
  expect((lab.position as { z: number }).z).toBeCloseTo(0, 1);

  await page.goto('./?map=proving-ground');
  await page.waitForFunction(() => window.__game?.ready);
  const spawn = await page.evaluate(() => {
    window.__game.respawn();
    window.__game.stepMany(1);
    return window.__game.getTelemetry();
  });
  expect((spawn.position as { x: number }).x).toBeCloseTo(0, 1);
  expect((spawn.position as { z: number }).z).toBeCloseTo(-340, 1);
  // Facing north up the runway: full throttle moves the car toward +Z.
  const driven = await page.evaluate(() => {
    window.__game.setInput({ throttle: 1 });
    window.__game.stepMany(240);
    window.__game.releaseInput();
    return window.__game.getTelemetry();
  });
  expect(Number(driven.speed)).toBeGreaterThan(15);
  expect((driven.position as { z: number }).z).toBeGreaterThan(-320);
  expect(Math.abs((driven.position as { x: number }).x)).toBeLessThan(1);
  expect(driven.groundedWheels).toBe(4);

  await page.goto('./?map=lab');
  await page.waitForFunction(() => window.__game?.ready);
  const back = await page.evaluate(() => {
    window.__game.respawn();
    window.__game.stepMany(1);
    return window.__game.getTelemetry();
  });
  expect((back.position as { x: number }).x).toBeCloseTo(130, 1);
  expect(errors).toEqual([]);
});

test('on the proving ground, Enter puts the car on the start line and the run counts down, runs, and abandons on respawn', async ({
  page,
}) => {
  await page.goto('./?map=proving-ground');
  await page.waitForFunction(() => window.__game?.ready);
  const run = page.locator('.sl-hud__run');
  await expect(run).toHaveAttribute('data-phase', 'idle');
  // Retry: onto the line (the start box is 8 m long at z -320), and the
  // arrival starts the countdown at once.
  await page.keyboard.press('Enter');
  await expect(run).toHaveAttribute('data-phase', 'countdown', {
    timeout: 15_000,
  });
  const z = await page.evaluate(
    () => (window.__game.getTelemetry().position as { z: number }).z,
  );
  expect(Math.abs(z + 320)).toBeLessThanOrEqual(4);
  await expect(page.locator('[data-reading="runClock"]')).toHaveText(/^[123]$/);
  await page.evaluate(() => window.__game.stepMany(360));
  await expect(run).toHaveAttribute('data-phase', 'running');
  await page.evaluate(() => window.__game.stepMany(120));
  await expect(page.locator('[data-reading="runClock"]')).toHaveText(
    /^\d+\.\d\d$/,
  );
  // R is the respawn that keeps the score and abandons the run.
  await page.keyboard.press('KeyR');
  await expect(run).toHaveAttribute('data-phase', 'idle');
  await expect(run).toHaveAttribute('data-visible', 'false');
});
