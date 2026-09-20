import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('./');
  await page.waitForFunction(
    () => window.__game?.ready && !!window.__inputFixture,
  );
});

test.afterEach(async ({ page }) => {
  await page.evaluate(() => window.__inputFixture?.dispose());
});

test('game Tab swaps A/B without moving focus; Options Tab navigates normally', async ({
  page,
}) => {
  const canvas = page.getByLabel('Driving view');
  await page.keyboard.press('Tab');
  await expect(canvas).toBeFocused();
  expect(
    await page.evaluate(() => window.__inputFixture.sample().actions.swapAB),
  ).toBe(1);
  await page.locator('#test-a').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('#test-b')).toBeFocused();
  expect(
    await page.evaluate(() => window.__inputFixture.sample().actions.swapAB),
  ).toBe(0);
  await page.locator('#test-b').evaluate((button) => {
    button.addEventListener('click', () => {
      button.setAttribute('data-clicked', 'true');
    });
  });
  await page.keyboard.down('Space');
  expect(
    await page.evaluate(() => window.__inputFixture.sample().handbrake),
  ).toBe(false);
  await page.keyboard.up('Space');
  await expect(page.locator('#test-b')).toHaveAttribute('data-clicked', 'true');
});

test('editing clears throttle and native slider keyboard interaction does not steer', async ({
  page,
}) => {
  await page.keyboard.down('w');
  expect(
    await page.evaluate(() => window.__inputFixture.sample().throttle),
  ).toBe(1);
  await page.getByLabel('Test parameter').focus();
  expect(
    await page.evaluate(() => window.__inputFixture.sample().throttle),
  ).toBe(0);
  await page.keyboard.up('w');
  await page.keyboard.type('42');
  await expect(page.getByLabel('Test parameter')).toHaveValue('42');
  await page.getByLabel('Test slider').focus();
  await page.keyboard.down('ArrowLeft');
  expect(await page.evaluate(() => window.__inputFixture.sample().steer)).toBe(
    0,
  );
  await page.keyboard.up('ArrowLeft');
  await page.getByLabel('Driving view').focus();
  await page.keyboard.down('ArrowLeft');
  expect(await page.evaluate(() => window.__inputFixture.sample().steer)).toBe(
    1,
  );
  await page.keyboard.up('ArrowLeft');
});

test('L records a sampled input-to-frame delta and reveals both flash indicators', async ({
  page,
}) => {
  await page.keyboard.press('l');
  await page.evaluate(async () => {
    window.__inputFixture.sample();
    for (let frame = 0; frame < 2; frame++) {
      await new Promise<void>((resolve) =>
        requestAnimationFrame((timestamp) => {
          window.__inputFixture.presented(timestamp);
          window.__inputFixture.paintProbe(timestamp);
          resolve();
        }),
      );
    }
  });
  const probe = page.getByLabel('Input latency probe');
  await expect(probe).toBeVisible();
  await expect(probe).toContainText('EVENT');
  await expect(probe).toContainText('FRAME');
  await expect(probe).toContainText('1/100 samples');
  await expect(probe).toContainText('rAF proxy:');
});
