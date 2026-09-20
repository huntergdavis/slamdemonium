import { expect, test } from '@playwright/test';
import { GAME_NAME } from '../src/core/constants';

test('renders the physics scene and exposes the ready automation surface', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    // Headless SwiftShader emits this driver diagnostic during trace readback.
    // Keep application warnings and every other browser diagnostic visible.
    if (
      message.type() === 'warning' &&
      /^\[\.WebGL-0x[0-9a-f]+\]GL Driver Message .*GPU stall due to ReadPixels/.test(
        message.text(),
      )
    )
      return;
    if (message.type() === 'error' || message.type() === 'warning')
      errors.push(message.text());
  });
  await page.goto('./');
  await page.waitForFunction(() => window.__game?.ready);
  await expect(page).toHaveTitle(GAME_NAME);
  const canvas = page.getByLabel('Driving view');
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveJSProperty('width', 1280);
  await page.setViewportSize({ width: 800, height: 600 });
  await expect(canvas).toHaveJSProperty('width', 800);
  await expect(canvas).toHaveJSProperty('height', 600);
  expect(errors).toEqual([]);
});
