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
  await expect(page.locator('.sl-controller-legend__item')).toHaveCount(8);
  await tap(page, [4, 12]);
  // Boots off, so the first HUD command turns it on.
  await expect(page.locator('.sl-hud')).toHaveAttribute('data-mode', 'full');
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

test('controller alone searches and filters tuning controls with visible wrapping focus', async ({
  page,
}) => {
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
  await expect(page.locator('#group-mass-range')).toBeVisible();
  await expect(page.locator('#group-gripRear-range')).not.toBeVisible();
  await expect(options.locator('[data-selected=true]')).toHaveCount(1);
  expect(await page.evaluate(() => window.__game.tuning.get('mass'))).toBe(
    1300,
  );
  await tap(page, [1]);
  await expect(options).toHaveAttribute('data-open', 'false');
});

// Each mapping is its own pad-only journey: a failure identifies the encoding,
// rather than inheriting the duration/state of text entry or preset persistence.
for (const scenario of [
  {
    key: 'mass',
    encoding: 'logarithmic',
    group: 'Chassis',
    sectionSteps: 3,
    advanced: false,
    rangeMax: '1000',
    initial: 1300,
    fine: 1310,
    coarse: 1410,
  },
  {
    key: 'physicsHz',
    encoding: 'discrete',
    group: 'World',
    sectionSteps: 2,
    advanced: true,
    rangeMax: '4',
    initial: 120,
    fine: 180,
    coarse: 240,
  },
] as const) {
  test(`controller alone edits and resets ${scenario.encoding} ${scenario.key} in schema units`, async ({
    page,
  }) => {
    await tap(page, [8]);
    const options = page.locator('.sl-options');
    const groupSelector = `.sl-options__groups > [data-group="${scenario.group}"]`;
    for (let step = 0; step < scenario.sectionSteps; step++)
      await tap(page, [7]);
    await expect(page.locator(groupSelector + ' > summary')).toBeFocused();
    await tap(page, [0]);
    if (scenario.advanced) {
      await padFocus(page, groupSelector + ' [data-advanced=true] > summary');
      await tap(page, [0]);
    }
    const range = `#group-${scenario.key}-range`;
    await padFocus(page, range);
    // These DOM coordinates differ from parameter units; do not add DOM steps.
    await expect(page.locator(range)).toHaveAttribute('max', scenario.rangeMax);
    await tap(page, [15]);
    expect(
      await page.evaluate((key) => window.__game.tuning.get(key), scenario.key),
    ).toBe(scenario.fine);
    await tap(page, [5, 15]);
    expect(
      await page.evaluate((key) => window.__game.tuning.get(key), scenario.key),
    ).toBe(scenario.coarse);
    await tap(page, [2]);
    expect(
      await page.evaluate((key) => window.__game.tuning.get(key), scenario.key),
    ).toBe(scenario.initial);
    await expect(options.locator('[data-selected=true]')).toHaveCount(1);
    await expect(page.locator(range)).toBeInViewport({ ratio: 1 });
    await tap(page, [1]);
    await expect(options).toHaveAttribute('data-open', 'false');
  });
}

test('controller alone saves a named preset through the on-screen keyboard', async ({
  page,
}, info) => {
  await tap(page, [8]);
  const options = page.locator('.sl-options');
  // Both triggers navigate sections, including wrapping footer to header.
  await tap(page, [6]);
  await expect(
    page.getByRole('button', { name: 'Export', exact: true }),
  ).toBeFocused();
  await tap(page, [7]);
  await expect(
    page.getByRole('button', { name: 'Close Options' }),
  ).toBeFocused();
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
