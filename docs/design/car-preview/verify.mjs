/* global window */
import assert from 'node:assert/strict';
import console from 'node:console';
import { mkdir } from 'node:fs/promises';
import process from 'node:process';
import { chromium } from '@playwright/test';

const url = process.argv[2] || 'http://127.0.0.1:4185/docs/design/car-preview/';
const output = process.argv[3] || '/tmp/slamdemonium-car-preview';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  args: ['--enable-unsafe-swiftshader', '--no-sandbox'],
});
const errors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  page.setDefaultTimeout(90_000);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('response', (response) => {
    if (response.status() >= 400)
      errors.push(response.status() + ' ' + response.url());
  });
  await page.goto(url);
  await page.waitForFunction(() => window.__carPreview?.ready);
  await page.locator('#animate').uncheck();
  await page.screenshot({ path: output + '/front.png' });

  await page.locator('#mode').selectOption('brake');
  await page.waitForFunction(() => window.__carPreview.state.brake01 === 1);
  assert.equal(
    await page.evaluate(() =>
      window.__carPreview.car.root
        .getObjectByName('car.tail')
        .material.color.getHex(),
    ),
    0xff6570,
  );
  await page.locator('[data-camera="rear"]').click();
  await page.waitForFunction(
    () =>
      window.__carPreview.renderedCamera === 'rear' &&
      window.__carPreview.renderedMode === 'brake',
  );
  await page.screenshot({ path: output + '/rear-braking.png' });
  await page.locator('#mode').selectOption('reverse');
  await page.waitForFunction(
    () => window.__carPreview.state.velocityWorld.z > 0,
  );
  assert.equal(
    await page.evaluate(() =>
      window.__carPreview.car.root
        .getObjectByName('car.tail')
        .material.color.getHex(),
    ),
    0x9f2838,
  );

  await page.locator('#mode').selectOption('lock');
  await page.locator('#animate').check();
  await page.waitForFunction(() => window.__carPreview.state.wheels[3].locked);
  const frozen = await page.evaluate(
    () => window.__carPreview.state.wheels[3].spinAngle,
  );
  await page.waitForFunction(
    () => window.__carPreview.state.wheels[0].spinAngle > 0.5,
  );
  assert.equal(
    await page.evaluate(() => window.__carPreview.state.wheels[3].spinAngle),
    frozen,
  );
  await page.locator('#mode').selectOption('spin');
  await page.waitForFunction(
    () => window.__carPreview.state.wheels[3].spinning,
  );
  assert(
    await page.evaluate(() =>
      window.__carPreview.state.wheels.every(
        (wheel) => wheel.spinAngle >= 0 && wheel.spinAngle < 2 * Math.PI,
      ),
    ),
  );

  await page.locator('#mode').selectOption('air');
  await page.waitForFunction(
    () => !window.__carPreview.state.wheels[0].grounded,
  );
  assert(
    await page.evaluate(() =>
      ['FL', 'FR', 'RL', 'RR'].every(
        (wheel) =>
          !window.__carPreview.view.scene.getObjectByName(
            'car.gizmos.force.' + wheel,
          ).visible,
      ),
    ),
  );
  // Native editing targets keep G; game canvas consumes it once, ignoring repeat.
  await page.locator('#steer').focus();
  await page.keyboard.press('g');
  assert.equal(
    await page.locator('#gizmos').getAttribute('aria-pressed'),
    'true',
  );
  await page.locator('#app canvas').click({ position: { x: 1100, y: 600 } });
  await page.keyboard.down('g');
  await page.waitForFunction(
    () => !window.__carPreview.view.scene.getObjectByName('car.gizmos').visible,
  );
  await page.keyboard.down('g');
  await page.keyboard.up('g');
  assert.equal(
    await page.locator('#gizmos').getAttribute('aria-pressed'),
    'false',
  );
  await page.keyboard.press('g');
  await page.waitForFunction(
    () => window.__carPreview.view.scene.getObjectByName('car.gizmos').visible,
  );

  await page.locator('#mode').selectOption('drift');
  await page.locator('#animate').uncheck();
  await page.locator('[data-camera="top"]').click();
  await page.waitForFunction(
    () =>
      window.__carPreview.renderedCamera === 'top' &&
      window.__carPreview.renderedMode === 'drift',
  );
  await page.waitForFunction(() => window.__carPreview.state.handbrake01 > 0);
  await page.screenshot({ path: output + '/top-drift.png' });
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      result: 'PASS',
      errors,
      screenshots: output,
      checks: [
        'brake/reverse',
        'lock/spin/wrap',
        'airborne forces',
        'G focus/repeat',
        'front/rear/top rendering',
      ],
    }),
  );
} catch (error) {
  console.error('Browser diagnostics:', errors);
  throw error;
} finally {
  await browser.close();
}
