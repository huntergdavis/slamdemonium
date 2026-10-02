/* Browser perf gate (2026-10-01): a real headed Chromium on the real GPU
 * drives a fixed route on the circuit while the game runs on its own frame
 * loop, and the game's own recorder reports frames, full physics steps and
 * Jolt steps. Headless swiftshader numbers are not a browser; these are.
 *
 *   xvfb-run -a -s "-screen 0 1920x1080x24" node scripts/perf/browser-drive.mjs <url> [seconds] [WxH] [out.json]
 *
 * The report names the GL renderer so a software fallback cannot pass as a
 * GPU. Route: spawn, north up the opening straight through the chicane,
 * pure pursuit on the circuit centreline, speed held at 35 m/s. */
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const URL = process.argv[2] ?? 'http://localhost:4173/';
const SECONDS = Number(process.argv[3] ?? 45);
const [W, H] = (process.argv[4] ?? '1280x720').split('x').map(Number);
const OUT = process.argv[5] ?? `scratch/browser-drive-${Date.now()}.json`;
const TARGET_SPEED = 35;
const here = dirname(fileURLToPath(import.meta.url));
const route = JSON.parse(readFileSync(join(here, 'circuit-path.json'), 'utf8'));

const browser = await chromium.launch({
  headless: false,
  args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', `--window-size=${W},${H}`],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const url = URL.includes('?') ? `${URL}&map=circuit` : `${URL}?map=circuit`;
await page.goto(url);
await page.waitForFunction(() => window.__game?.ready, null, { timeout: 60000 });
await page.waitForTimeout(2000);
if (await page.evaluate(() => !!document.querySelector('dialog[open]'))) { await page.keyboard.press('Escape'); await page.waitForTimeout(1000); }
const build = await page.evaluate(() => fetch('build-info.json?t=' + Date.now()).then((r) => r.json()));
const renderer = await page.evaluate(() => { const c = document.createElement('canvas'); const gl = c.getContext('webgl2') || c.getContext('webgl'); const d = gl?.getExtension('WEBGL_debug_renderer_info'); return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : String(gl?.getParameter(gl.RENDERER)); });

await page.evaluate(() => { window.__game.respawn(); });
await page.waitForTimeout(1500);
await page.screenshot({ path: OUT.replace(/\.json$/, '-spawn.png') });
// The driver lives in the page and runs on the game's frame loop.
await page.evaluate(([route, target, seconds]) => {
  const g = window.__game;
  const pts = route.points;
  const fwd = (q) => ({ x: -2 * (q.x * q.z + q.y * q.w), z: -(1 - 2 * (q.x * q.x + q.y * q.y)) });
  let nearest = 0;
  const state = { done: false, started: performance.now(), frames: 0, traffic: [], maxTraffic: 0, distance: 0, last: null, recoveries: 0 };
  window.__drive = state;
  g.respawn(); g.releaseInput(); g.setDriftMeter(0);
  g.perf.start(1e9); // Recorder on; never "done".
  const tick = () => {
    const t = g.getTelemetry();
    const p = t.position;
    // Advance the nearest-point index monotonically along the route.
    for (let k = 0; k < 40; k++) { const a = pts[nearest], b = pts[Math.min(nearest + 1, pts.length - 1)]; if (Math.hypot(b[0] - p.x, b[1] - p.z) < Math.hypot(a[0] - p.x, a[1] - p.z)) nearest++; else break; }
    const look = Math.max(40, 1.2 * t.speed);
    const goal = pts[Math.min(nearest + Math.round(look / route.step), pts.length - 1)];
    const f = fwd(t.rotation);
    const dx = goal[0] - p.x, dz = goal[1] - p.z, l = Math.hypot(dx, dz) || 1;
    const cross = f.x * (dz / l) - f.z * (dx / l);
    const err = target - t.speed;
    g.setInput({ throttle: Math.max(0, Math.min(1, 0.6 * err)), brake: err < -1.5 ? Math.min(1, -0.3 * err) : 0, steer: Math.max(-1, Math.min(1, -3 * cross)), boost: false, handbrake: false });
    if (state.last) state.distance += Math.hypot(p.x - state.last.x, p.z - state.last.z);
    state.last = { x: p.x, z: p.z };
    state.frames++;
    state.recoveries = t.recoveryCount;
    if (state.frames % 60 === 0) {
      // In play, within the 750 m visual radius, within 180 m, and moving.
      const all = g.getTraffic?.() ?? [];
      let near750 = 0, near180 = 0, moving = 0, inFrame4 = 0, inFrame8 = 0;
      for (const c of all) { const d = Math.hypot(c.x - p.x, c.z - p.z); if (d <= 750) { near750++; if (c.speed > 1) moving++; } if (d <= 180) near180++; if (c.inFrame && c.screenPixels >= 4) inFrame4++; if (c.inFrame && c.screenPixels >= 8) inFrame8++; }
      state.traffic.push([all.length, near750, moving, near180, inFrame4, inFrame8]);
      state.maxTraffic = Math.max(state.maxTraffic, near750);
      state.maxInFrame4 = Math.max(state.maxInFrame4 ?? 0, inFrame4); state.maxInFrame8 = Math.max(state.maxInFrame8 ?? 0, inFrame8);
    }
    if (performance.now() - state.started < seconds * 1000) requestAnimationFrame(tick); else { g.releaseInput(); state.done = true; }
  };
  requestAnimationFrame(tick);
}, [route, TARGET_SPEED, SECONDS]);

// Drain the fixed-capacity recorder every ten seconds so nothing drops.
const frames = [], steps = [], engine = []; let dropped = 0;
const drain = async () => { const b = await page.evaluate(() => window.__game.perf.drain()); frames.push(...b.frameMs); steps.push(...b.physicsStepMs); engine.push(...b.engineStepMs); dropped += b.droppedSamples; };
const started = Date.now();
while (!(await page.evaluate(() => window.__drive.done))) { await page.waitForTimeout(10000); await drain(); }
await drain();
const drive = await page.evaluate(() => ({ ...window.__drive, last: undefined }));
await page.screenshot({ path: OUT.replace(/\.json$/, '.png') });
await browser.close();

const q = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))].toFixed(2); };
const mean = (a) => (a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) : null);
// The first second of frames is warm-up (shader compiles, first promotions).
const warm = frames.slice(60);
const report = {
  build: build.shortCommit, url, renderer, viewport: `${W}x${H}`, seconds: SECONDS, wallSeconds: +((Date.now() - started) / 1000).toFixed(1), errors,
  route: { targetSpeed: TARGET_SPEED, distance_m: +drive.distance.toFixed(0), recoveries: drive.recoveries, frames: drive.frames },
  traffic: { samples: drive.traffic, max: drive.maxTraffic, inFrame4: { max: drive.maxInFrame4 ?? null, median: q(drive.traffic.map((r) => r[4] ?? 0), 0.5) }, inFrame8: { max: drive.maxInFrame8 ?? null, median: q(drive.traffic.map((r) => r[5] ?? 0), 0.5) } },
  frame: { count: warm.length, fps_mean: warm.length ? +(1000 / mean(warm)).toFixed(1) : null, ms_p50: q(warm, 0.5), ms_p95: q(warm, 0.95), ms_p99: q(warm, 0.99), ms_max: q(warm, 1) },
  fullStep: { count: steps.length, ms_p50: q(steps, 0.5), ms_p99: q(steps, 0.99), ms_max: q(steps, 1) },
  jolt: { count: engine.length, ms_p50: q(engine, 0.5), ms_p99: q(engine, 0.99), ms_max: q(engine, 1) },
  droppedSamples: dropped,
};
writeFileSync(OUT, JSON.stringify(report, null, 1));
console.log(`${report.build} ${report.viewport} ${report.renderer.includes('SwiftShader') ? 'SOFTWARE GL' : 'GPU'} | fps ${report.frame.fps_mean} (frame p50 ${report.frame.ms_p50} p99 ${report.frame.ms_p99} ms) | full step p50 ${report.fullStep.ms_p50} p99 ${report.fullStep.ms_p99} ms | jolt p50 ${report.jolt.ms_p50} p99 ${report.jolt.ms_p99} ms | within 750 m max ${report.traffic.max}, in frame >=4px median ${report.traffic.inFrame4.median} max ${report.traffic.inFrame4.max}, >=8px median ${report.traffic.inFrame8.median} max ${report.traffic.inFrame8.max} | ${report.route.distance_m} m, recoveries ${report.route.recoveries}, dropped ${dropped}, errors ${errors.length}`);
console.log(JSON.stringify({ renderer, traffic: report.traffic.samples }));
