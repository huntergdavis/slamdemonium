/* Fixed-camera near/far/near gate for the lazy hero model. Keep player pose,
 * viewport and camera side identical on the parent and candidate builds.
 *
 * xvfb-run -a -s "-screen 0 1920x1080x24" node scripts/perf/hero-lod-capture.mjs <url> <out-prefix> [side=-1]
 */
/* global process, console, window, document, fetch */
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const url = process.argv[2];
const prefix = process.argv[3];
const side = Number(process.argv[4] ?? -1);
if (!url || !prefix || ![-1, 1].includes(side))
  throw new Error(
    'Expected preview URL, output prefix and optional side -1 or 1.',
  );
const browser = await chromium.launch({
  headless: false,
  args: [
    '--use-angle=vulkan',
    '--enable-features=Vulkan',
    '--ignore-gpu-blocklist',
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
try {
  await page.goto(url);
  await page.waitForFunction(() => window.__game?.ready, null, {
    timeout: 60_000,
  });
  if (await page.evaluate(() => !!document.querySelector('dialog[open]')))
    await page.keyboard.press('Escape');
  await page.waitForFunction(
    () => Number.isFinite(window.__game?.getHeroLod?.().pixels),
    null,
    { timeout: 30_000 },
  );
  const build = await page.evaluate(() =>
    fetch('build-info.json?t=' + Date.now()).then((response) =>
      response.json(),
    ),
  );
  const script = await page.evaluate(() =>
    document.querySelector('script[type="module"]')?.src.split('/').at(-1),
  );
  const target = await page.evaluate(() => {
    const game = window.__game;
    game.releaseInput();
    game.perf.pauseSimulation(true);
    game.setHudMode('off');
    return { ...game.getTelemetry().position };
  });
  const samples = [];
  // Cross the 7 px near→far and 10 px far→near thresholds in small steps.
  // The adjacent captures differ little in camera scale, so a silhouette
  // jump is the LOD switch rather than the camera move.
  for (const distance of [15, 340, 349, 355, 260, 249, 245, 240]) {
    await page.evaluate(
      ({ target, side, distance }) =>
        window.__game.setInspectionCamera({
          position: {
            x: target.x + side * distance,
            y: target.y + 45,
            z: target.z,
          },
          target,
        }),
      { target, side, distance },
    );
    await page.waitForTimeout(250);
    const lod = await page.evaluate(() => window.__game.getHeroLod());
    const frame = `${prefix}-${distance}.png`;
    await page.screenshot({ path: frame });
    samples.push({ distance, ...lod, frame });
  }
  const result = {
    build: build.shortCommit,
    script,
    side,
    target,
    samples,
    errors,
  };
  writeFileSync(`${prefix}.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
