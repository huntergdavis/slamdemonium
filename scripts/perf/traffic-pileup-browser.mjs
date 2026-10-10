/* Headed GPU gate for traffic pileups. Stage five already-pooled cars on the
 * opening straight, then time ten seconds of their impact. Run main and the PR
 * interleaved on the same box; compare full-step p99 and frame cost.
 *
 * xvfb-run -a -s "-screen 0 1920x1080x24" node scripts/perf/traffic-pileup-browser.mjs <url> <out.json> [cars=5]
 */
/* global process, console, window, document, fetch, performance, requestAnimationFrame */
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';

const url = process.argv[2];
const out = process.argv[3];
const cars = Number(process.argv[4] ?? 5);
if (!url || !out)
  throw new Error('Expected a preview URL and output JSON path.');
if (!Number.isInteger(cars) || cars < 2 || cars > 12)
  throw new Error('Pileup size must be an integer from 2 to 12.');
const loadBefore = loadavg()[0];
const browser = await chromium.launch({
  headless: false,
  args: [
    '--use-angle=vulkan',
    '--enable-features=Vulkan',
    '--ignore-gpu-blocklist',
    '--disable-gpu-vsync',
    '--disable-frame-rate-limit',
    '--window-size=1280,720',
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.goto(
  url.includes('?') ? `${url}&map=circuit` : `${url}?map=circuit`,
);
await page.waitForFunction(() => window.__game?.ready, null, {
  timeout: 60_000,
});
await page.waitForTimeout(1500);
if (await page.evaluate(() => !!document.querySelector('dialog[open]')))
  await page.keyboard.press('Escape');
const build = await page.evaluate(() =>
  fetch('build-info.json?t=' + Date.now()).then((response) => response.json()),
);
const renderer = await page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl2');
  const extension = gl?.getExtension('WEBGL_debug_renderer_info');
  return extension
    ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)
    : String(gl?.getParameter(gl.RENDERER));
});

await page.evaluate((count) => {
  const game = window.__game;
  game.respawn();
  game.releaseInput();
  const ids = game.stageTrafficPileup?.(count);
  if (!ids || ids.length !== count)
    throw new Error(`${count}-body pileup not staged.`);
  const state = {
    done: false,
    timedOut: false,
    started: performance.now(),
    frames: 0,
    ids,
    crushed: new Set(),
    wrecked: new Set(),
    maxNearby: 0,
    lastFrameAt: null,
    burstFrameMs: [],
  };
  window.__pileup = state;
  game.perf.start(1e9);
  const tick = () => {
    const now = performance.now();
    if (state.lastFrameAt !== null && now - state.started <= 2000)
      state.burstFrameMs.push(now - state.lastFrameAt);
    state.lastFrameAt = now;
    if (state.frames++ % 12 === 0) {
      const traffic = game.getTraffic?.() ?? [];
      const player = game.getTelemetry().position;
      let nearby = 0;
      for (const car of traffic) {
        const distance = Math.hypot(car.x - player.x, car.z - player.z);
        if (distance > 80) continue;
        nearby++;
        if (car.wrecked) state.wrecked.add(car.id);
        if (Object.values(car.crush ?? {}).some((value) => value > 0.02))
          state.crushed.add(car.id);
      }
      state.maxNearby = Math.max(state.maxNearby, nearby);
    }
    if (now - state.started >= 10000) state.done = true;
    else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}, cars);

const frame = [];
const fullStep = [];
const jolt = [];
let dropped = 0;
while (!(await page.evaluate(() => window.__pileup.done))) {
  await page.waitForTimeout(1000);
  const batch = await page.evaluate(() => window.__game.perf.drain());
  frame.push(...batch.frameMs);
  fullStep.push(...batch.physicsStepMs);
  jolt.push(...batch.engineStepMs);
  dropped += batch.droppedSamples;
}
const batch = await page.evaluate(() => window.__game.perf.drain());
frame.push(...batch.frameMs);
fullStep.push(...batch.physicsStepMs);
jolt.push(...batch.engineStepMs);
dropped += batch.droppedSamples;
const pileup = await page.evaluate(() => ({
  timedOut: window.__pileup.timedOut,
  stagedIds: window.__pileup.ids,
  crushedIds: [...window.__pileup.crushed],
  wreckedIds: [...window.__pileup.wrecked],
  maxNearby: window.__pileup.maxNearby,
  burstFrameMs: window.__pileup.burstFrameMs,
  stagedCrush: (window.__game.getTraffic?.() ?? [])
    .filter((car) => window.__pileup.ids.includes(car.id))
    .map((car) => ({ id: car.id, crush: car.crush, wrecked: car.wrecked })),
}));
const pace = await page.evaluate(() => window.__game.perf.pace());
await browser.close();

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return +sorted[Math.floor((sorted.length - 1) * fraction)].toFixed(2);
}
const mean = (values) =>
  values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
const report = {
  build: build.shortCommit,
  renderer,
  loadBefore: +loadBefore.toFixed(2),
  pileup,
  pace,
  burstFrame: {
    count: pileup.burstFrameMs.length,
    p99: percentile(pileup.burstFrameMs, 0.99),
    worst: pileup.burstFrameMs.length
      ? +Math.max(...pileup.burstFrameMs).toFixed(2)
      : null,
    over100ms: pileup.burstFrameMs.filter((ms) => ms > 100).length,
  },
  frame: {
    count: frame.length,
    fps: mean(frame) ? +(1000 / mean(frame)).toFixed(1) : null,
    p50: percentile(frame, 0.5),
    p99: percentile(frame, 0.99),
    worst: frame.length ? +Math.max(...frame).toFixed(2) : null,
    over100ms: frame.filter((ms) => ms > 100).length,
  },
  fullStep: {
    count: fullStep.length,
    p50: percentile(fullStep, 0.5),
    p99: percentile(fullStep, 0.99),
  },
  jolt: {
    count: jolt.length,
    p50: percentile(jolt, 0.5),
    p99: percentile(jolt, 0.99),
  },
  dropped,
  errors,
};
writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
