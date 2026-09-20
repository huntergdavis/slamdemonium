import { expect, test } from '@playwright/test';

test('mounted pause menu shares live pause, respawn and Options wiring', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('./');
  await page.waitForFunction(() => window.__game?.ready);
  await page.evaluate(() => {
    window.__game.perf!.pauseSimulation(true);
    window.__game.setInput({ throttle: 1 });
    window.__game.stepMany(120);
    window.__game.releaseInput();
  });
  expect(
    await page.evaluate(() => Number(window.__game.getTelemetry().speed)),
  ).toBeGreaterThan(1);
  const canvas = page.getByLabel('Driving view');
  await canvas.focus();
  await page.keyboard.press('Escape');
  const menu = page.getByRole('dialog', { name: 'Pause menu', exact: true });
  await expect(menu).toBeVisible();
  const steps = await page.evaluate(
    () => window.__game.getTelemetry().totalSteps,
  );
  await page.getByRole('button', { name: 'Options', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: 'Paused — Options' }),
  ).toBeVisible();
  await expect(page.locator('.sl-options')).toHaveCount(1);
  await page.getByRole('button', { name: 'Close Options' }).click();
  await expect(menu).toBeVisible();
  expect(
    await page.evaluate(() => window.__game.getTelemetry().totalSteps),
  ).toBe(steps);
  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  await expect(menu).toBeHidden();
  expect(await page.evaluate(() => window.__game.getTelemetry().speed)).toBe(0);
  expect(await page.evaluate(() => window.__game.getTelemetry().paused)).toBe(
    true,
  );

  // Releasing the independent perf pause must not release an open menu.
  await page.keyboard.press('Escape');
  await expect(menu).toBeVisible();
  await page.evaluate(() => window.__game.perf!.pauseSimulation(false));
  expect(await page.evaluate(() => window.__game.getTelemetry().paused)).toBe(
    true,
  );
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect
    .poll(() => page.evaluate(() => window.__game.getTelemetry().paused))
    .toBe(false);
  await expect(canvas).toBeFocused();
  expect(errors).toEqual([]);
});
