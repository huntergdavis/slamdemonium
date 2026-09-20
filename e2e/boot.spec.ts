import { expect, test, type Page } from '@playwright/test';
import { GAME_NAME } from '../src/core/constants';

async function expectCanvasSize(page: Page, width: number, height: number) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const canvas = document.querySelector<HTMLCanvasElement>(
          'canvas[aria-label="Driving view"]',
        )!;
        const bounds = canvas.getBoundingClientRect();
        const scale = Number(window.__game.getTelemetry().renderScale);
        const pixelRatio = Math.min(window.devicePixelRatio, 2) * scale;
        return {
          width: bounds.width,
          height: bounds.height,
          validScale: scale >= 0.6 && scale <= 1,
          correctBacking:
            canvas.width === Math.floor(bounds.width * pixelRatio) &&
            canvas.height === Math.floor(bounds.height * pixelRatio),
        };
      }),
    )
    .toEqual({ width, height, validScale: true, correctBacking: true });
}

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
  await expectCanvasSize(page, 1280, 720);
  await page.setViewportSize({ width: 800, height: 600 });
  await expectCanvasSize(page, 800, 600);
  expect(errors).toEqual([]);
});
