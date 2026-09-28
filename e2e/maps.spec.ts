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
  await page.evaluate(() => window.__game.perf!.pauseSimulation(true));
  const run = page.locator('.sl-hud__run');
  await expect(run).toHaveAttribute('data-phase', 'idle');
  // Retry: onto the line, and the arrival starts the countdown at once.
  await page.keyboard.press('Enter');
  await page.evaluate(() => window.__game.stepMany(2));
  await expect
    .poll(() =>
      page.evaluate(() => {
        const p = window.__game.getTelemetry().position as { z: number };
        return Math.round(p.z);
      }),
    )
    .toBe(-320);
  await expect(run).toHaveAttribute('data-phase', 'countdown');
  await expect(page.locator('[data-reading="runClock"]')).toHaveText('3');
  await page.evaluate(() => window.__game.stepMany(360));
  await expect(run).toHaveAttribute('data-phase', 'running');
  await page.evaluate(() => window.__game.stepMany(120));
  await expect(page.locator('[data-reading="runClock"]')).toHaveText('1.00');
  // R is the respawn that keeps the score and abandons the run.
  await page.keyboard.press('KeyR');
  await page.evaluate(() => window.__game.stepMany(2));
  await expect(run).toHaveAttribute('data-phase', 'idle');
  await expect(run).toHaveAttribute('data-visible', 'false');
});
