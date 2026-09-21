import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  expect,
  test as base,
  type Page,
  type Locator,
} from '@playwright/test';
import { serveOptionsBuild } from '../tests/options/server';

const test = base.extend<
  { menuPage: Page },
  { menuBuild: Awaited<ReturnType<typeof serveOptionsBuild>> }
>({
  menuBuild: [
    // eslint-disable-next-line no-empty-pattern -- Playwright parses dependencies.
    async ({}, use) => {
      const build = await serveOptionsBuild('tests/pauseMenu');
      try {
        await use(build);
      } finally {
        await build.close();
      }
    },
    { scope: 'worker' },
  ],
  menuPage: async ({ page, menuBuild }, use) => {
    await page.goto(menuBuild.url);
    await page.waitForFunction(() => Boolean(window.__pauseTest));
    await page.getByLabel('Driving view').focus();
    await use(page);
  },
});

async function frames(page: Page, count = 3): Promise<void> {
  const target = await page.evaluate(
    (n) => window.__pauseTest.state.frames + n,
    count,
  );
  await page.waitForFunction(
    (n) => window.__pauseTest.state.frames >= n,
    target,
  );
}
async function pressPad(page: Page, button: number): Promise<void> {
  await page.evaluate((b) => window.__pauseTest.tapPad(b), button);
}

async function expectSelection(dialog: Locator, name: string): Promise<void> {
  const selected = dialog.locator('[data-selected="true"]');
  await expect(selected).toHaveCount(1);
  await expect(selected).toHaveAccessibleName(name);
  await expect(selected).toBeFocused();
  await expect(selected).toBeInViewport({ ratio: 1 });
}

async function expectFullViewport(dialog: Locator): Promise<void> {
  const geometry = await dialog.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    const backdrop = getComputedStyle(node, '::backdrop');
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      blur: style.backdropFilter,
      backdropBlur: backdrop.backdropFilter,
    };
  });
  expect(geometry.x).toBeCloseTo(0);
  expect(geometry.y).toBeCloseTo(0);
  expect(geometry.width).toBeCloseTo(geometry.viewportWidth);
  expect(geometry.height).toBeCloseTo(geometry.viewportHeight);
  expect(geometry.blur).toBe('none');
  expect(geometry.backdropBlur).toBe('none');
}

for (const size of [
  { width: 1920, height: 1080 },
  { width: 320, height: 480 },
]) {
  test(
    'full viewfield and one visible selection at ' + size.width + 'px',
    async ({ menuPage: page }, testInfo) => {
      await page.setViewportSize(size);
      await page.keyboard.press('Escape');
      const dialog = page.locator('.sl-pause');
      await expectFullViewport(dialog);
      await expectSelection(dialog, 'Resume');
      await page.screenshot({
        path: testInfo.outputPath('console-pause-menu.png'),
      });
      const entry = page.getByRole('button', { name: 'Resume', exact: true });
      const typography = await entry.evaluate((button) => ({
        fontSize: parseFloat(getComputedStyle(button).fontSize),
        height: button.getBoundingClientRect().height,
      }));
      expect(typography.fontSize).toBeGreaterThanOrEqual(
        size.width > 1000 ? 28 : 20,
      );
      expect(typography.height).toBeGreaterThanOrEqual(48);
      await page.keyboard.press('ArrowUp');
      await expectSelection(dialog, 'Controls');
      await page.keyboard.press('ArrowDown');
      await expectSelection(dialog, 'Resume');
      await page.keyboard.press('Shift+Tab');
      await expectSelection(dialog, 'Controls');
      await page.keyboard.press('Tab');
      await expectSelection(dialog, 'Resume');
      await pressPad(page, 12);
      await expectSelection(dialog, 'Controls');
      await pressPad(page, 13);
      await expectSelection(dialog, 'Resume');
      // Losing focus to the native dialog background cannot leave pad A inert.
      expect(
        await dialog.evaluate((node) => {
          node.focus();
          node.dispatchEvent(
            new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true }),
          );
          const blocked = !window.__pauseTest.input.keyboard.state.held.KeyW;
          node.dispatchEvent(
            new KeyboardEvent('keyup', { code: 'KeyW', bubbles: true }),
          );
          return blocked;
        }),
      ).toBe(true);
      await frames(page);
      await expectSelection(dialog, 'Resume');
      await page.getByRole('button', { name: 'Controls', exact: true }).click();
      await expectFullViewport(dialog);
      await expectSelection(dialog, 'Back');
      await page.screenshot({
        path: testInfo.outputPath('console-pause-controls.png'),
      });
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      await page.getByRole('button', { name: 'Options', exact: true }).click();
      await expectFullViewport(dialog);
      await expectSelection(dialog, 'Close Options');
      await page.screenshot({
        path: testInfo.outputPath('console-pause-options.png'),
      });
      await page.getByRole('button', { name: 'Close Options' }).click();
      await expectSelection(dialog, 'Resume');
      // Pointer selection gets the same persistent styling as pad/keyboard focus.
      await page.getByRole('button', { name: 'Restart', exact: true }).focus();
      await expectSelection(dialog, 'Restart');
      expect(await entry.getAttribute('data-selected')).not.toBe('true');
    },
  );
}

test('menu pause stops driving samples and resumes at the same physics time after a long clock gap', async ({
  menuPage: page,
}) => {
  const result = await page.evaluate(() => {
    const { loop, menu, input, state } = window.__pauseTest;
    // Run the complete pause/clock sequence synchronously, between real RAFs.
    loop.resetClock();
    loop.frame(0);
    loop.frame(1000 / 60);
    menu.setOpen(true);
    const before = {
      steps: loop.totalSteps,
      samples: state.scriptSamples,
      time: loop.simulationSeconds,
      driving: { ...input.state },
    };
    window.__pauseTest.setPad([0, 2], 1, 0, 1, 1);
    input.sampleActions();
    loop.frame(300_000);
    const paused = {
      steps: loop.totalSteps,
      samples: state.scriptSamples,
      time: loop.simulationSeconds,
      throttle: input.state.throttle,
      steer: input.state.steer,
    };
    window.__pauseTest.setPad([]);
    menu.setOpen(false);
    loop.frame(600_000);
    const resumed = { steps: loop.totalSteps, time: loop.simulationSeconds };
    loop.frame(600_000 + 1000 / 120);
    const next = { steps: loop.totalSteps, time: loop.simulationSeconds };
    return { before, paused, resumed, next };
  });
  expect(result.paused).toMatchObject({
    steps: result.before.steps,
    samples: result.before.samples,
    time: result.before.time,
    throttle: result.before.driving.throttle,
    steer: result.before.driving.steer,
  });
  expect(result.resumed).toEqual({
    steps: result.before.steps,
    time: result.before.time,
  });
  expect(result.next.steps).toBe(result.before.steps + 1);
  expect(result.next.time - result.before.time).toBeCloseTo(1 / 120);
});

test('Escape menu pauses the real loop, traps focus, shows Controls and resumes without tuning changes', async ({
  menuPage: page,
}) => {
  await page.keyboard.press('Escape');
  const dialog = page.getByRole('dialog', { name: 'Pause menu' });
  await expect(dialog).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Resume', exact: true }),
  ).toBeFocused();
  const before = await page.evaluate(() => ({
    steps: window.__pauseTest.loop.totalSteps,
    samples: window.__pauseTest.state.scriptSamples,
    tuning: window.__pauseTest.store.snapshot(),
  }));
  await frames(page, 8);
  expect(await page.evaluate(() => window.__pauseTest.loop.totalSteps)).toBe(
    before.steps,
  );
  expect(
    await page.evaluate(() => window.__pauseTest.state.scriptSamples),
  ).toBe(before.samples);
  await page.keyboard.press('Shift+Tab');
  await expect(
    page.getByRole('button', { name: 'Controls', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('dialog', { name: 'Controls', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/press a controller button to wake/),
  ).toBeVisible();
  await expect(
    page.getByRole('cell', { name: 'Start / Menu', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Enter'); // Back has focus.
  await expect(
    page.getByRole('button', { name: 'Resume', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel('Driving view')).toBeFocused();
  await frames(page);
  expect(
    await page.evaluate(() => window.__pauseTest.loop.totalSteps),
  ).toBeGreaterThan(before.steps);
  expect(
    await page.evaluate(() => window.__pauseTest.store.snapshot()),
  ).toEqual(before.tuning);
});

test('controller alone opens menu, edits existing Options, returns, reads Controls, restarts and resumes', async ({
  menuPage: page,
}) => {
  const original = await page.locator('#group-mass-number').elementHandle();
  await pressPad(page, 9);
  await expect(
    page.getByRole('button', { name: 'Resume', exact: true }),
  ).toBeFocused();
  await pressPad(page, 13);
  await pressPad(page, 13);
  await expect(
    page.getByRole('button', { name: 'Options', exact: true }),
  ).toBeFocused();
  await pressPad(page, 0);
  await expect(
    page.getByRole('dialog', { name: 'Paused — Options', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Close Options' }),
  ).toBeFocused();
  await pressPad(page, 13);
  await expect(page.getByRole('combobox', { name: 'Preset' })).toBeFocused();
  await pressPad(page, 15);
  await expect(page.getByRole('combobox', { name: 'Preset' })).toHaveValue(
    'builtin:Grip',
  );
  expect(await original?.evaluate((node) => node.isConnected)).toBe(true);
  await pressPad(page, 1);
  await expect(
    page.getByRole('button', { name: 'Resume', exact: true }),
  ).toBeFocused();
  expect(await page.evaluate(() => window.__pauseTest.state.menuPaused)).toBe(
    true,
  );
  await pressPad(page, 12); // Wrap to Controls.
  await pressPad(page, 0);
  await expect(
    page.getByRole('dialog', { name: 'Controls', exact: true }),
  ).toBeVisible();
  await pressPad(page, 1);
  await pressPad(page, 13);
  await expect(
    page.getByRole('button', { name: 'Restart', exact: true }),
  ).toBeFocused();
  await pressPad(page, 0);
  expect(await page.evaluate(() => window.__pauseTest.state.restarts)).toBe(1);
  await expect(page.getByRole('dialog')).toBeHidden();
  await pressPad(page, 9);
  await pressPad(page, 9);
  await expect(page.getByRole('dialog')).toBeHidden();
});

test('closing menu preserves P, Options and external pause requests; Escape in Options returns to menu', async ({
  menuPage: page,
}) => {
  await page.keyboard.press('KeyP');
  await expect
    .poll(() => page.evaluate(() => window.__pauseTest.state.userPaused))
    .toBe(true);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  const stopped = await page.evaluate(() => window.__pauseTest.loop.totalSteps);
  await frames(page);
  expect(await page.evaluate(() => window.__pauseTest.loop.totalSteps)).toBe(
    stopped,
  );
  await page.keyboard.press('KeyP');
  await page.evaluate(() => window.__pauseTest.setExternalPaused(true));
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Options', exact: true }).click();
  await page.getByRole('searchbox').fill('gravity');
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('dialog', { name: 'Pause menu', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  expect(
    await page.evaluate(() => window.__pauseTest.state.externalPaused),
  ).toBe(true);
  await page.evaluate(() => window.__pauseTest.setExternalPaused(false));
  await page.keyboard.press('KeyO');
  await page.getByRole('checkbox', { name: 'Pause while open' }).check();
  await pressPad(page, 9);
  await page.getByRole('button', { name: 'Options', exact: true }).click();
  await pressPad(page, 9);
  expect(
    await page.evaluate(() => window.__pauseTest.state.optionsPaused),
  ).toBe(true);
  await expect(
    page.getByRole('checkbox', { name: 'Pause while open' }),
  ).toBeChecked();
});

for (const mode of ['fullscreen', 'pointer'] as const) {
  test(
    'Escape stays browser-owned in ' + mode + ' before the next menu press',
    async ({ menuPage: page }) => {
      await page.locator('#' + mode).click();
      await expect
        .poll(() =>
          page.evaluate(
            (m) =>
              Boolean(
                m === 'fullscreen'
                  ? document.fullscreenElement
                  : document.pointerLockElement,
              ),
            mode,
          ),
        )
        .toBe(true);
      if (process.env.WP16_NATIVE_ESCAPE === '1') {
        // CDP page key injection does not invoke Chromium's browser-level
        // exit gesture. A headed X11 run sends an actual OS key instead.
        await promisify(execFile)('xdotool', [
          'key',
          '--clearmodifiers',
          'Escape',
        ]);
      } else {
        await page.keyboard.press('Escape');
        expect(
          await page.evaluate(() => window.__pauseTest.escapePrevented()),
        ).toBe(false);
        await expect(page.getByRole('dialog')).toBeHidden();
        await page.evaluate(async (m) => {
          if (m === 'fullscreen') await document.exitFullscreen();
          else document.exitPointerLock();
        }, mode);
      }
      await expect
        .poll(() =>
          page.evaluate(
            (m) =>
              Boolean(
                m === 'fullscreen'
                  ? document.fullscreenElement
                  : document.pointerLockElement,
              ),
            mode,
          ),
        )
        .toBe(false);
      await expect(page.getByRole('dialog')).toBeHidden();
      // A separate gesture after the browser's exit notification, not an
      // auto-repeat or key event from the same unlock gesture.
      await page.bringToFront();
      await page.getByLabel('Driving view').focus();
      const exited = await page.evaluate(() => performance.now());
      await page.waitForFunction((t) => performance.now() - t >= 150, exited, {
        polling: 50,
      });
      await page.keyboard.press('Escape');
      await expect(
        page.getByRole('dialog', { name: 'Pause menu', exact: true }),
      ).toBeVisible();
      if (process.env.WP16_NATIVE_ESCAPE === '1')
        await page.screenshot({ path: 'scratch/wp16-' + mode + '.png' });
    },
  );
}

test('small viewport keeps menu actions reachable and teardown releases only its pause request', async ({
  menuPage: page,
}) => {
  await page.setViewportSize({ width: 320, height: 480 });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Controls', exact: true }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Resume', exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    window.__pauseTest.setExternalPaused(true);
    window.__pauseTest.dispose();
  });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => window.__pauseTest.state)).toMatchObject({
    menuPaused: false,
    externalPaused: true,
  });
});
