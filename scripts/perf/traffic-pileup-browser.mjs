/* Headed GPU gate for traffic pileups. Drive into the opening-straight lane,
 * then time the six seconds after the first nearby traffic wreck. Run main
 * and the PR interleaved on the same box; compare full-step p99 and frame cost.
 *
 * xvfb-run -a -s "-screen 0 1920x1080x24" node scripts/perf/traffic-pileup-browser.mjs <url> <out.json>
 */
/* global process, console, window, document, fetch, performance, requestAnimationFrame */
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';

const url = process.argv[2];
const out = process.argv[3];
if (!url || !out)
  throw new Error('Expected a preview URL and output JSON path.');
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

await page.evaluate(() => {
  const game = window.__game;
  game.respawn();
  game.releaseInput();
  const state = {
    done: false,
    timedOut: false,
    started: performance.now(),
    pileupStart: 0,
    frames: 0,
    crushed: new Set(),
    wrecked: new Set(),
    maxNearby: 0,
  };
  window.__pileup = state;
  const forward = (rotation) => ({
    x: -2 * (rotation.x * rotation.z + rotation.y * rotation.w),
    z: -(1 - 2 * (rotation.x * rotation.x + rotation.y * rotation.y)),
  });
  const tick = () => {
    const telemetry = game.getTelemetry();
    const { position, rotation, speed } = telemetry;
    const heading = forward(rotation);
    const dx = -846.5 - position.x;
    const dz = 55;
    const length = Math.hypot(dx, dz) || 1;
    const cross = heading.x * (dz / length) - heading.z * (dx / length);
    const error = 45 - speed;
    game.setInput({
      throttle: Math.max(0, Math.min(1, 0.6 * error)),
      brake: error < -1.5 ? Math.min(1, -0.3 * error) : 0,
      steer: Math.max(-1, Math.min(1, -3 * cross)),
      handbrake: false,
      boost: false,
    });
    const now = performance.now();
    if (
      state.frames++ % 12 === 0 &&
      (!state.pileupStart || now - state.pileupStart < 6000)
    ) {
      const traffic = game.getTraffic?.() ?? [];
      let nearby = 0;
      for (const car of traffic) {
        const distance = Math.hypot(car.x - position.x, car.z - position.z);
        if (distance > 80) continue;
        nearby++;
        if (car.wrecked) state.wrecked.add(car.id);
        if (Object.values(car.crush ?? {}).some((value) => value > 0.02))
          state.crushed.add(car.id);
        if (!state.pileupStart && car.wrecked && distance < 25) {
          // Start after shaders and the approach have warmed up. This is the
          // same trigger on main and PR, independent of the new damage rule.
          game.perf.start(1e9);
          state.pileupStart = now;
        }
      }
      state.maxNearby = Math.max(state.maxNearby, nearby);
    }
    if (state.pileupStart && now - state.pileupStart >= 6000) {
      game.releaseInput();
      state.done = true;
    } else if (now - state.started >= 40_000) {
      game.releaseInput();
      state.timedOut = true;
      state.done = true;
    } else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

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
  crushedIds: [...window.__pileup.crushed],
  wreckedIds: [...window.__pileup.wrecked],
  maxNearby: window.__pileup.maxNearby,
}));
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
  frame: {
    count: frame.length,
    fps: mean(frame) ? +(1000 / mean(frame)).toFixed(1) : null,
    p50: percentile(frame, 0.5),
    p99: percentile(frame, 0.99),
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
