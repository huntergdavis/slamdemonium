/* global window */
import assert from 'node:assert/strict';
import console from 'node:console';
import process from 'node:process';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const output = process.argv[3] || '/tmp/slamdemonium-speed-preview';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  args: ['--enable-unsafe-swiftshader', '--no-sandbox'],
});
const errors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
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
  await page.goto(
    process.argv[2] || 'http://127.0.0.1:4186/docs/design/speed-preview/',
  );
  await page.waitForFunction(() => window.__speedPreview?.ready);
  await page.screenshot({ path: output + '/default.png' });
  const pixels = await page.evaluate(() => {
    const { cues, store } = window.__speedPreview;
    const ctx = cues.canvas.getContext('2d');
    const state = { speed: 60, topSpeed: 60, boostEnvelope: 0 };
    const sum = (data) => {
      let total = 0;
      for (let i = 3; i < data.length; i += 4) total += data[i];
      return total;
    };
    const read = () =>
      ctx.getImageData(0, 0, cues.canvas.width, cues.canvas.height);
    store.patch({ speedLinesStrength: 1, vignetteStrength: 0 });
    cues.update(state, 0);
    const lines = read();
    let centerAlpha = 0;
    for (let y = Math.ceil(lines.height * 0.2); y < lines.height * 0.8; y++)
      for (let x = Math.ceil(lines.width * 0.2); x < lines.width * 0.8; x++)
        centerAlpha += lines.data[(y * lines.width + x) * 4 + 3];
    cues.update(state, 0);
    const paused = read().data;
    const pauseStable = lines.data.every((value, i) => value === paused[i]);
    cues.update({ speed: 48, topSpeed: 60, boostEnvelope: 0 }, 0);
    const thresholdAlpha = sum(read().data);
    cues.update({ speed: 12, topSpeed: 60, boostEnvelope: 1 }, 0);
    const boostAlpha = sum(read().data);
    store.patch({ speedLinesStrength: 0, vignetteStrength: 1 });
    cues.update(state, 0);
    const vignette = read();
    const center = ctx.getImageData(
      cues.canvas.width / 2,
      cues.canvas.height / 2,
      1,
      1,
    ).data[3];
    let maxAlpha = 0;
    for (let i = 3; i < vignette.data.length; i += 4)
      maxAlpha = Math.max(maxAlpha, vignette.data[i]);
    store.patch({ speedLinesStrength: 0, vignetteStrength: 0 });
    const clearedImmediately = sum(read().data);
    return {
      lines: sum(lines.data),
      centerAlpha,
      pauseStable,
      thresholdAlpha,
      boostAlpha,
      vignette: sum(vignette.data),
      center,
      maxAlpha,
      clearedImmediately,
      hidden: cues.canvas.style.display === 'none',
    };
  });
  assert(pixels.lines > 0 && pixels.boostAlpha > 0 && pixels.vignette > 0);
  assert.equal(pixels.centerAlpha, 0);
  assert.equal(pixels.thresholdAlpha, 0);
  assert.equal(pixels.center, 0);
  assert(pixels.maxAlpha <= 31);
  assert.equal(pixels.clearedImmediately, 0);
  assert(pixels.hidden && pixels.pauseStable);
  const fractionalClears = await page.evaluate(() => {
    const { cues, store } = window.__speedPreview;
    return [1, 1.25, 1.5, 1.75, 2].map((dpr) => {
      cues.resize(321, 201, dpr);
      store.patch({ speedLinesStrength: 1, vignetteStrength: 1 });
      cues.update({ speed: 60, topSpeed: 60, boostEnvelope: 1 }, 0);
      store.patch({ speedLinesStrength: 0, vignetteStrength: 0 });
      const data = cues.canvas
        .getContext('2d')
        .getImageData(0, 0, cues.canvas.width, cues.canvas.height).data;
      let maxAlpha = 0;
      for (let i = 3; i < data.length; i += 4)
        maxAlpha = Math.max(maxAlpha, data[i]);
      return { dpr, maxAlpha };
    });
  });
  assert(fractionalClears.every((result) => result.maxAlpha === 0));
  await page.evaluate(() =>
    window.__speedPreview.cues.resize(
      window.innerWidth,
      window.innerHeight,
      window.devicePixelRatio,
    ),
  );
  const fog = await page.evaluate(() => {
    const { view, fog } = window.__speedPreview;
    const gl = view.renderer.getContext();
    const width = gl.drawingBufferWidth,
      height = gl.drawingBufferHeight;
    const withFog = new Uint8Array(width * height * 4),
      zero = new Uint8Array(withFog.length),
      none = new Uint8Array(withFog.length);
    const draw = (output) => {
      view.render();
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, output);
    };
    fog.density = 0.0025;
    view.scene.fog = fog;
    draw(withFog);
    fog.density = 0;
    draw(zero);
    view.scene.fog = null;
    draw(none);
    let maxZeroDifference = 0,
      hazyPixels = 0;
    for (let i = 0; i < zero.length; i++) {
      maxZeroDifference = Math.max(
        maxZeroDifference,
        Math.abs(zero[i] - none[i]),
      );
      if (Math.abs(withFog[i] - none[i]) > 2) hazyPixels++;
    }
    view.scene.fog = fog;
    fog.density = 0.0025;
    return { maxZeroDifference, hazyPixels };
  });
  assert(fog.maxZeroDifference <= 1);
  assert(fog.hazyPixels > 100);
  await page.evaluate(() => {
    const p = window.__speedPreview;
    p.store.patch({ speedLinesStrength: 1, vignetteStrength: 1 });
    p.cues.update({ speed: 85, topSpeed: 60, boostEnvelope: 1 }, 0);
    p.view.render();
  });
  await page.screenshot({ path: output + '/maximum.png' });
  await page.evaluate(() => window.__speedPreview.panel.setOpen(true));
  await page.getByRole('searchbox').fill('strength');
  const values = await page
    .locator('[data-key="speedLinesStrength"] input[type="number"]')
    .count();
  assert.equal(values, 1);
  assert.equal(
    await page
      .locator('[data-key="vignetteStrength"] input[type="number"]')
      .count(),
    1,
  );
  await page.setViewportSize({ width: 960, height: 600 });
  await page.waitForFunction(
    () => window.__speedPreview.cues.canvas.width === 960,
  );
  assert.equal(
    await page
      .locator('.sl-speed-cues')
      .evaluate((node) => node.style.pointerEvents),
    'none',
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      result: 'PASS',
      pixels,
      fractionalClears,
      fog,
      errors,
      screenshots: output,
    }),
  );
} catch (error) {
  console.error('Browser diagnostics:', errors);
  throw error;
} finally {
  await browser.close();
}
