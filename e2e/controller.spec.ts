import { expect, test } from '@playwright/test';
import { installController, keyboardKey, padFocus, tap } from './controllerPad';

test.beforeEach(async ({ page }) => {
  await installController(page);
  await page.goto('./');
  await page.waitForFunction(() => window.__game?.ready);
  await page.evaluate(() => window.__game.perf!.pauseSimulation(true));
});

test('controller command legend drives the real HUD, camera, slow motion, A/B, gizmos and telemetry', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.evaluate(() => window.__controllerPad.hold([4]));
  await expect(
    page.getByRole('region', { name: 'Controller commands' }),
  ).toBeVisible();
  await expect(page.locator('.sl-controller-legend__item')).toHaveCount(7);
  await tap(page, [4, 12]);
  await expect(page.locator('.sl-hud')).toHaveAttribute('data-mode', 'minimal');
  await tap(page, [4, 15]);
  expect(
    await page.evaluate(() => window.__game.getTelemetry().cameraPreset),
  ).toBe('far');
  await tap(page, [4, 13]);
  expect(await page.evaluate(() => window.__game.tuning.get('timeScale'))).toBe(
    0.25,
  );
  await tap(page, [4, 13]);
  await tap(page, [4, 14]);
  await expect(
    page.getByRole('button', { name: 'Activate slot B', includeHidden: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await tap(page, [4, 2]);
  expect(
    await page.evaluate(() => window.__game.getTelemetry().gizmosVisible),
  ).toBe(true);
  await tap(page, [4, 0]);
  await expect(page.locator('.sl-hud__recording')).toContainText('REC');
  await page.evaluate(() => window.__game.stepMany(12));
  const download = page.waitForEvent('download');
  await tap(page, [4, 0]);
  expect((await download).suggestedFilename()).toMatch(/\.csv$/);
  // P remains a separate keyboard owner. Start never clears the perf owner.
  await tap(page, [9]);
  await expect(
    page.getByRole('dialog', { name: 'Pause menu', exact: true }),
  ).toBeVisible();
  await tap(page, [1]);
  await expect(page.locator('.sl-pause')).not.toBeVisible();
  expect(await page.evaluate(() => window.__game.getTelemetry().paused)).toBe(
    true,
  );
  expect(errors).toEqual([]);
});

test('controller alone edits logarithmic tuning with fine/coarse steps, resets it, searches and saves a named preset', async ({
  page,
}, info) => {
  await tap(page, [8]);
  const options = page.locator('.sl-options');
  await expect(options).toHaveAttribute('data-open', 'true');
  await expect(options.locator('[data-selected=true]')).toHaveCount(1);
  await tap(page, [12]);
  await expect(
    page.getByRole('button', { name: 'Reset everything', exact: true }),
  ).toBeFocused();
  await tap(page, [13]);
  await expect(
    page.getByRole('button', { name: 'Close Options' }),
  ).toBeFocused();
  await tap(page, [3]); // Search shortcut, then controller text entry.
  await expect(page.getByRole('searchbox')).toBeFocused();
  await tap(page, [0]);
  for (const key of 'mass') await keyboardKey(page, key);
  await keyboardKey(page, 'Done');
  await expect(page.getByRole('searchbox')).toHaveValue('mass');
  await padFocus(page, '#group-mass-range');
  await tap(page, [15]);
  expect(await page.evaluate(() => window.__game.tuning.get('mass'))).toBe(
    1310,
  );
  await tap(page, [5, 15]);
  expect(await page.evaluate(() => window.__game.tuning.get('mass'))).toBe(
    1410,
  );
  await tap(page, [2]);
  expect(await page.evaluate(() => window.__game.tuning.get('mass'))).toBe(
    1300,
  );
  await expect(options.locator('[data-selected=true]')).toHaveCount(1);
  await expect(page.locator('#group-mass-range')).toBeInViewport({ ratio: 1 });
  // Triggers jump sections without steering or changing the tuning control.
  await tap(page, [6]);
  await padFocus(page, '[data-controller-text=preset]');
  await tap(page, [0]);
  await keyboardKey(page, 'Clear');
  for (const key of 'pad') await keyboardKey(page, key);
  await keyboardKey(page, 'Done');
  await expect(page.getByLabel('Preset', { exact: true })).toHaveValue(
    'user:pad',
  );
  await page.screenshot({ path: info.outputPath('controller-options.png') });
  await tap(page, [1]);
  await expect(options).toHaveAttribute('data-open', 'false');
});

test('controller focus and prompts survive unplugging, and Options cannot leak driving into real physics', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await tap(page, [8]);
  const hints = page.locator('.sl-options__header .sl-input-prompts__item');
  await expect(hints.first()).toHaveAttribute('data-input-device', 'gamepad');
  await page.evaluate(() => window.__controllerPad.connect(false));
  await expect(hints.first()).toHaveAttribute('data-input-device', 'keyboard');
  await page.evaluate(() => window.__controllerPad.connect(true));
  await tap(page, [13]);
  await expect(hints.first()).toHaveAttribute('data-input-device', 'gamepad');
  await expect(page.locator('.sl-options [data-selected=true]')).toHaveCount(1);
  await page.getByLabel('Driving view').click({ position: { x: 400, y: 280 } });
  await expect(hints.first()).toHaveAttribute('data-input-device', 'keyboard');
  await expect(page.locator('.sl-options [data-selected=true]')).toHaveCount(0);
  await tap(page, [13]);
  await expect(hints.first()).toHaveAttribute('data-input-device', 'gamepad');
  await expect(page.locator('.sl-options [data-selected=true]')).toHaveCount(1);
  const result = await page.evaluate(() => {
    const game = window.__game;
    const run = (buttons: number[], axis: number) => {
      window.__controllerPad.set([]);
      game.respawn();
      game.setInput({ throttle: 1 });
      game.stepMany(120);
      game.releaseInput();
      window.__controllerPad.set(buttons, axis);
      game.stepMany(120);
      const t = game.getTelemetry();
      return {
        position: t.position,
        rotation: t.rotation,
        velocity: t.velocity,
        angularVelocity: t.angularVelocity,
      };
    };
    const baseline = run([], 0);
    const held = run([0, 2, 3, 4, 6, 7, 12], 1);
    window.__controllerPad.set([]);
    return { baseline, held };
  });
  expect(result.held).toEqual(result.baseline);
  expect(errors).toEqual([]);
});

test('mounted haptics follows real wheelspin and cancels on pause or zero intensity', async ({
  page,
}) => {
  await page.evaluate(() => {
    window.__game.tuning.set('accel0', 20);
    window.__game.tuning.set('gripRear', 0.8);
    window.__game.respawn();
    window.__game.perf!.pauseSimulation(false);
  });
  await page.evaluate(() => window.__controllerPad.hold([7]));
  await expect
    .poll(() => page.evaluate(() => window.__controllerPad.effects.length))
    .toBeGreaterThan(0);
  const effects = await page.evaluate(() => window.__controllerPad.effects);
  expect(
    effects.every(
      (effect) =>
        Number(effect.weakMagnitude) <= 0.35 &&
        Number(effect.strongMagnitude) <= 0.35,
    ),
  ).toBe(true);
  await tap(page, [9]);
  await expect(
    page.getByRole('dialog', { name: 'Pause menu', exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => window.__controllerPad.resets),
  ).toBeGreaterThan(0);
  await page.evaluate(() => window.__game.tuning.set('hapticsIntensity', 0));
  await tap(page, [9]);
  const before = await page.evaluate(
    () => window.__controllerPad.effects.length,
  );
  await page.evaluate(async () => {
    await window.__controllerPad.hold([7]);
    await window.__controllerPad.hold([7]);
    await window.__controllerPad.hold([7]);
  });
  expect(await page.evaluate(() => window.__controllerPad.effects.length)).toBe(
    before,
  );
});
