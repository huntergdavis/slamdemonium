import { URL } from 'node:url';
import assert from 'node:assert/strict';
import process from 'node:process';
import console from 'node:console';
import { chromium } from '@playwright/test';

const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {}),
  args: ['--no-sandbox'],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  const errors = [],
    remote = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (!request.url().startsWith('file:')) remote.push(request.url());
  });
  await page.goto(new URL('./index.html', import.meta.url).href);
  const panel = page.locator('#kit-options');
  assert.equal((await panel.boundingBox()).width, 380);
  const range = page.locator('#gravity-range');
  const originalRange = await range.elementHandle();
  await page.locator('#gravity-number').fill('15.1');
  assert.equal(await range.inputValue(), '15.1');
  assert.equal(
    await page.locator('[data-key="gravity"]').getAttribute('data-edited'),
    'true',
  );
  await page.locator('#gravity-number').fill('');
  assert.equal(
    await page.locator('#gravity-number').getAttribute('aria-invalid'),
    'true',
  );
  await page
    .getByRole('button', { name: 'Reset gravity to default', exact: true })
    .click();
  assert.equal(await range.inputValue(), '14.7');
  assert.ok(
    await range.evaluate((node, original) => node === original, originalRange),
  );
  await page.locator('#gravity-number').focus();
  await page.keyboard.press('Tab');
  assert.equal(
    await page.locator('#slot-a').getAttribute('aria-pressed'),
    'true',
  );
  await page.locator('#kit-main').focus();
  await page.keyboard.press('Tab');
  assert.equal(
    await page.locator('#slot-b').getAttribute('aria-pressed'),
    'true',
  );
  assert.equal(
    await page
      .locator('#kit-main')
      .evaluate((node) => node === node.ownerDocument.activeElement),
    true,
  );
  await page
    .getByRole('button', { name: 'Help for gravity', exact: true })
    .focus();
  assert.ok(await page.locator('#gravity-help').isVisible());
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#gravity-help').isVisible(), false);
  await page.locator('#search').fill('no-such-control');
  assert.ok(await page.locator('#search-empty').isVisible());
  await page.locator('#search').fill('gripRear');
  assert.ok(await page.locator('#gripRear-number').isVisible());
  assert.equal(await page.locator('.sl-options__quick').isVisible(), false);
  await page.locator('#search').fill('');
  await page.locator('#close-options').click();
  assert.equal(await panel.evaluate((node) => node.inert), true);
  await panel.waitFor({ state: 'hidden' });
  await page.locator('#animate').click();
  const changes = await page.locator('#speed').evaluate(
    (node) =>
      new Promise((resolve) => {
        let count = 0;
        const observer = new globalThis.MutationObserver((records) => {
          count += records.length;
        });
        observer.observe(node, { characterData: true, subtree: true });
        globalThis.setTimeout(() => {
          observer.disconnect();
          resolve(count);
        }, 1150);
      }),
  );
  assert.ok(
    changes > 0 && changes <= 35,
    'Expected at most 30 samples/second, observed ' + changes,
  );
  await page.locator('#animate').click();
  await page.locator('#open-options').click();
  for (const viewport of [
    { width: 1024, height: 768 },
    { width: 390, height: 680 },
    { width: 320, height: 480 },
  ]) {
    await page.setViewportSize(viewport);
    assert.ok(
      await page
        .locator('html')
        .evaluate((node) => node.scrollWidth <= globalThis.innerWidth),
    );
    assert.equal(
      (await panel.boundingBox()).width,
      Math.min(380, viewport.width),
    );
    await page.locator('#reset-all').click();
    assert.ok(await page.locator('#close-options').isVisible());
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(
    await panel.evaluate(
      (node) => globalThis.getComputedStyle(node).transitionDuration,
    ),
    '0s',
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(remote, []);
  console.log(
    JSON.stringify(
      {
        result: 'PASS',
        browser: await browser.version(),
        samplesIn1150ms: changes,
        errors,
        remoteRequests: remote,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
