import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 800, height: 450 } });

test('built renderer bounds boost FOV, draws skid strips and mounts live speed cues', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('./');
  await page.waitForFunction(() => window.__game?.ready);
  await page.evaluate(() => {
    const game = window.__game;
    game.respawn();
    game.stepMany(120);
    game.setCameraPreset('far');
    game.tuning.set('fovBase', 110);
    game.tuning.set('fovSpeedGain', 50);
    game.tuning.set('fovBoostKick', 50);
    game.setDriftMeter(1);
    game.setInput({ throttle: 1, boost: true });
    game.stepMany(90);
  });
  await expect
    .poll(() => page.evaluate(() => window.__game.getTelemetry().cameraFov))
    .toBe(115);
  const state = await page.evaluate(() => window.__game.getTelemetry());
  expect(state.cameraFovCapped).toBe(true);
  expect(Number(state.cameraFovRequested)).toBeGreaterThan(115);
  expect(state.cameraPreset).toBe('far');
  expect(Number(state.skidSegmentsWritten)).toBeGreaterThan(0);
  expect(Number(state.skidSegments)).toBeLessThanOrEqual(4 * 8192);
  await expect(page.locator('.sl-speed-cues')).toBeVisible();
  await expect(page.locator('.sl-speed-cues')).toHaveCSS(
    'pointer-events',
    'none',
  );
  await page.screenshot({ path: testInfo.outputPath('wp6-boost-camera.png') });
  await page.evaluate(() => {
    const game = window.__game;
    game.tuning.set('speedLinesStrength', 0);
    game.tuning.set('vignetteStrength', 0);
    game.tuning.set('fovBase', 70);
    game.tuning.set('fovSpeedGain', 0);
    game.tuning.set('fovBoostKick', 0);
    game.setCameraPreset('chase');
    game.setInput({ throttle: 0, boost: false });
  });
  await expect(page.locator('.sl-speed-cues')).toBeHidden();
  await expect
    .poll(() => page.evaluate(() => window.__game.getTelemetry().cameraFov))
    .toBe(70);
  expect(
    await page.evaluate(() => window.__game.getTelemetry().cameraFovCapped),
  ).toBe(false);
  await page.getByLabel('Driving view').focus();
  await page.keyboard.press('KeyC');
  await page.keyboard.press('KeyG');
  await page.evaluate(() => window.__game.stepMany(1));
  expect(
    await page.evaluate(() => window.__game.getTelemetry().cameraPreset),
  ).toBe('far');
  await page.setViewportSize({ width: 640, height: 360 });
  await expect(page.locator('.sl-speed-cues')).toHaveCSS('width', '640px');
  const scale = Number(
    await page.evaluate(() => window.__game.getTelemetry().renderScale),
  );
  expect(scale).toBeGreaterThanOrEqual(0.6);
  expect(scale).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});
