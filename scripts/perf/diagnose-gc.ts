import { chromium } from '@playwright/test';
import { preview } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import type { PerformanceBatch } from '../../src/core/performance.ts';

declare global {
  interface Window {
    __perfDiagnosis?: {
      stamps: Float64Array;
      anchor: number;
      manual?: PerformanceBatch;
    };
  }
}
const output = resolve(process.argv[2] ?? 'test-results/perf-gc');
await mkdir(output, { recursive: true });
import { setTimeout as delay } from 'node:timers/promises';
const server = await preview({
  preview: { host: '127.0.0.1', port: 0, strictPort: true },
});
const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
  });
  await page.goto(server.resolvedUrls!.local[0]!);
  page.setDefaultTimeout(60_000);
  await page.waitForFunction(() => window.__game?.ready, undefined, {
    timeout: 60000,
  });
  await page.evaluate(() => {
    const game = window.__game;
    game.perf!.pauseSimulation(true);
    const stamps = new Float64Array(960);
    const input = {
      throttle: 0,
      brake: 0,
      steer: 0,
      handbrake: false,
      boost: false,
    };
    window.__perfDiagnosis = { stamps, anchor: 0 };
    game.perf!.setStepDriver((step) => {
      stamps[step] = performance.now();
      input.throttle = step < 720 ? 1 : 0;
      input.brake = step >= 720 ? 1 : 0;
      input.steer = step < 360 ? 0.5 : -0.5;
      game.setInput(input);
    });
    for (let warm = 0; warm < 2; warm++) {
      game.respawn();
      game.perf!.start(960);
      game.stepMany(960);
      game.perf!.drain();
    }
    game.respawn();
    game.perf!.start(960);
    game.stepMany(960);
    window.__perfDiagnosis!.manual = game.perf!.drain();
    game.respawn();
    stamps.fill(0);
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('HeapProfiler.startSampling', {
    samplingInterval: 16384,
    includeObjectsCollectedByMajorGC: true,
    includeObjectsCollectedByMinorGC: true,
  });
  await cdp.send('Tracing.start', {
    categories:
      'devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.frame,v8,disabled-by-default-v8.gc,blink.user_timing',
    transferMode: 'ReturnAsStream',
  });
  await page.evaluate(() => {
    const mark = performance.mark('wp9a-diagnostic-origin');
    window.__perfDiagnosis!.anchor = mark.startTime;
    window.__game.perf!.start(960);
  });
  const physics: number[] = [],
    engine: number[] = [],
    frames: number[] = [],
    heaps: { atMs: number; usedSize: number; totalSize: number }[] = [];
  let dropped = 0;
  for (;;) {
    const data = await page.evaluate(() => ({
      batch: window.__game.perf!.drain(),
      progress: window.__game.perf!.progress(),
      atMs: performance.now(),
    }));
    physics.push(...data.batch.physicsStepMs);
    engine.push(...data.batch.engineStepMs);
    frames.push(...data.batch.frameMs);
    dropped += data.batch.droppedSamples;
    heaps.push({
      atMs: data.atMs,
      ...(await cdp.send('Runtime.getHeapUsage')),
    });
    console.log('Diagnostic steps ' + data.progress.completedSteps + '/960');
    if (data.progress.done) break;
    await delay(15000);
  }
  await page.evaluate(() => window.__game.perf!.setPaused(true));
  const data = await page.evaluate(() => ({
    stamps: Array.from(window.__perfDiagnosis!.stamps),
    anchor: window.__perfDiagnosis!.anchor,
    manual: window.__perfDiagnosis!.manual,
    terminal: window.__game.getTelemetry(),
  }));
  const tracingComplete = new Promise<{
    stream?: string;
    dataLossOccurred: boolean;
  }>((resolve) => cdp.once('Tracing.tracingComplete', resolve));
  await cdp.send('Tracing.end');
  const complete = await tracingComplete;
  if (!complete.stream)
    throw new Error('Chromium did not return a trace stream.');
  const profile = await cdp.send('HeapProfiler.stopSampling');
  let trace = '';
  for (;;) {
    const chunk = await cdp.send('IO.read', {
      handle: complete.stream,
      size: 1024 * 1024,
    });
    trace += chunk.base64Encoded
      ? Buffer.from(chunk.data, 'base64').toString()
      : chunk.data;
    if (chunk.eof) break;
  }
  await cdp.send('IO.close', { handle: complete.stream });
  await writeFile(join(output, 'trace.json'), trace);
  await writeFile(join(output, 'allocation.json'), JSON.stringify(profile));
  await writeFile(
    join(output, 'samples.json'),
    JSON.stringify({
      ...data,
      physics,
      engine,
      frames,
      heaps,
      dropped,
      traceDataLoss: complete.dataLossOccurred,
    }),
  );
  console.log('Saved GC trace, allocation profile and chronological samples.');
} finally {
  await browser.close();
  await new Promise<void>((resolve) =>
    server.httpServer.close(() => resolve()),
  );
}
