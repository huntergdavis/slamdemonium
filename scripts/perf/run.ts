import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { arch, cpus, loadavg, platform } from 'node:os';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import type { Browser } from '@playwright/test';
import { preview } from 'vite';
import type { PerformanceBatch } from '../../src/core/performance.ts';
import { PARAM_DEFS } from '../../src/tuning/schema.ts';
import { HELP, parseConfig } from './config.ts';
import { fingerprint, inputSource } from './input.ts';
import { assess, summarize } from './metrics.ts';
import type { MemorySample } from './metrics.ts';
import type { PerfScenario } from './scenario.ts';
import demo from './scenarios/physics-demo.ts';

async function main(): Promise<void> {
  const config = parseConfig(process.argv.slice(2));
  if (config.help) {
    console.log(HELP);
    return;
  }
  const loadAverageAtStart = loadavg();
  const scenario: PerfScenario = config.scenario
    ? (await import(pathToFileURL(resolve(config.scenario)).href)).default
    : demo;
  if (!scenario?.name || typeof scenario.setup !== 'function')
    throw new Error(
      'Scenario must export default { name, description, setup }.',
    );
  const driver = await inputSource(config);
  const scenarioModule = config.scenario
    ? pathToFileURL(resolve(config.scenario))
    : new URL('./scenarios/physics-demo.ts', import.meta.url);
  const scenarioFingerprint = fingerprint(
    await readFile(scenarioModule, 'utf8'),
  );
  const server = await preview({
    preview: {
      host: '127.0.0.1',
      port: config.port,
      strictPort: true,
      open: false,
    },
  });
  let browser: Browser | undefined;
  const watchdog = setTimeout(() => {
    console.error(
      'Performance run exceeded --timeout-seconds before completing its replay.',
    );
    void browser?.close();
  }, config.timeoutSeconds * 1000);
  watchdog.unref();
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--enable-unsafe-swiftshader'],
    });
    const page = await browser.newPage({
      viewport: { width: 1280, height: 720 },
    });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    const url = server.resolvedUrls?.local[0];
    if (!url) throw new Error('Preview server did not supply a local URL.');
    await page.goto(url);
    await page.waitForFunction(() => window.__game?.ready, undefined, {
      timeout: 60_000,
    });
    await page.evaluate(() => {
      if (!window.__game.perf)
        throw new Error('Missing window.__game.perf measurement hooks.');
      window.__game.perf.pauseSimulation(true);
    });
    const cdp = await page.context().newCDPSession(page);
    console.log('Scenario: ' + scenario.name + ' — ' + scenario.description);
    const spike = config.skipSpike
      ? null
      : await page.evaluate(async () => {
          if (!window.__game.runPhysicsSpike)
            throw new Error('Missing WP1 one-box baseline.');
          return window.__game.runPhysicsSpike();
        });
    const reference = {
      source: 'docs/DECISIONS.md WP1 / G0, 2026-09-20; hardware/load dependent',
      nodeMeanStepMs: 0.0923,
      chromiumMeanStepMs: 0.1118,
      measuredChromiumMeanStepMs: spike?.meanStepMs ?? null,
      chromiumRatio: spike ? spike.meanStepMs / 0.1118 : null,
      lifecycleAllocatorLostBytes: spike?.allocatorLostBytes ?? null,
    };
    if (spike)
      console.log(
        'WP1 replay: ' +
          spike.meanStepMs.toFixed(4) +
          ' ms/step; recorded Chromium 0.1118, Node 0.0923. Allocator lifecycle loss: ' +
          spike.allocatorLostBytes +
          ' bytes.',
      );

    async function prepareReplay(): Promise<number> {
      await page.evaluate(() => window.__game.perf!.pauseSimulation(true));
      await scenario.setup(page);
      const steps = await driver.prepare(page);
      if (!Number.isSafeInteger(steps) || steps < 1)
        throw new Error('Input source supplied an invalid replay step count.');
      return steps;
    }
    async function verifyScriptEof(): Promise<void> {
      if (config.inputScript)
        await page.evaluate(() => {
          const progress = window.__game.scripts!.progress();
          if (!progress.done || progress.completedSteps !== progress.totalSteps)
            throw new Error(
              'WP11 EOF disagrees with the measured step boundary.',
            );
        });
    }
    const keys = PARAM_DEFS.map(({ key }) => key);
    async function readParameters() {
      return page.evaluate(
        (keys) =>
          Object.fromEntries(
            keys.map((key) => [key, window.__game.tuning.get(key)]),
          ),
        keys,
      );
    }
    for (let i = 0; i < config.warmupReplays; i++) {
      const steps = await prepareReplay();
      await page.evaluate((steps) => {
        window.__game.perf!.start(steps);
        window.__game.stepMany(steps);
        window.__game.perf!.drain();
      }, steps);
      await verifyScriptEof();
    }
    const baselineSteps = await prepareReplay();
    const manual = await page.evaluate((steps) => {
      const game = window.__game;
      game.perf!.start(steps);
      const samples = {
        frameMs: [] as number[],
        physicsStepMs: [] as number[],
        engineStepMs: [] as number[],
        droppedSamples: 0,
      };
      for (
        let remaining = steps;
        remaining > 0;
        remaining -= Math.min(remaining, 2048)
      ) {
        game.stepMany(Math.min(remaining, 2048));
        const batch = game.perf!.drain();
        samples.physicsStepMs.push(...batch.physicsStepMs);
        samples.engineStepMs.push(...batch.engineStepMs);
        samples.droppedSamples += batch.droppedSamples;
      }
      return {
        progress: game.perf!.progress(),
        samples,
        terminalTelemetry: game.getTelemetry(),
      };
    }, baselineSteps);
    await verifyScriptEof();
    if (
      !manual.progress.done ||
      manual.progress.completedSteps !== baselineSteps ||
      manual.samples.droppedSamples ||
      manual.samples.physicsStepMs.length !== baselineSteps
    )
      throw new Error(
        'stepMany baseline did not capture exactly one complete replay.',
      );
    const manualBaseline = {
      completedSteps: manual.progress.completedSteps,
      physicsStep: summarize(manual.samples.physicsStepMs),
      engineStep: summarize(manual.samples.engineStepMs),
      terminalTelemetry: manual.terminalTelemetry,
    };
    const replaySteps = await prepareReplay();
    const parameters = await readParameters();
    const sortedParameters = Object.fromEntries(
      Object.entries(parameters).sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0,
      ),
    );
    const parameterFingerprint = fingerprint(JSON.stringify(sortedParameters));
    const configurationFingerprint = fingerprint(
      JSON.stringify({
        parameters: sortedParameters,
        input: driver.identity,
        scenario: scenarioFingerprint,
        replaySteps,
      }),
    );
    await cdp.send('HeapProfiler.collectGarbage');
    const initialDroppedSeconds = await page.evaluate(() =>
      Number(window.__game.getTelemetry().droppedSeconds),
    );
    const batches: PerformanceBatch = {
      frameMs: [],
      physicsStepMs: [],
      engineStepMs: [],
      droppedSamples: 0,
    };
    const memorySamples: MemorySample[] = [];
    const terminalStates: Readonly<Record<string, unknown>>[] = [];
    const started = performance.now();
    let gcMeasurementPauseMs = 0;
    let first: MemorySample | undefined;
    let last: MemorySample | undefined;
    let minuteFive: MemorySample | undefined;
    let completedReplays = 0;
    let completedSteps = 0;

    async function memory(): Promise<MemorySample> {
      const wasm = await page.evaluate(() => window.__game.perf!.getMemory());
      const heap = await cdp.send('Runtime.getHeapUsage');
      if (
        !Number.isFinite(wasm.heapBytes) ||
        !Number.isFinite(wasm.freeBytes) ||
        wasm.heapBytes <= 0 ||
        wasm.freeBytes < 0 ||
        wasm.freeBytes >= wasm.heapBytes
      )
        throw new Error('Invalid WASM allocator sample.');
      return {
        elapsedSeconds: (performance.now() - started) / 1000,
        jsUsedBytes: heap.usedSize,
        jsTotalBytes: heap.totalSize,
        backingStorageBytes: heap.backingStorageSize ?? 0,
        wasmHeapBytes: wasm.heapBytes,
        wasmFreeBytes: wasm.freeBytes,
        wasmUsedBytes: wasm.heapBytes - wasm.freeBytes,
      };
    }
    async function checkpoint(): Promise<MemorySample> {
      const before = performance.now();
      const resume = await page.evaluate(() => {
        const perf = window.__game.perf!;
        const running = !perf.progress().done;
        perf.pauseSimulation(true);
        perf.setPaused(true);
        return running;
      });
      try {
        await cdp.send('HeapProfiler.collectGarbage');
        return await memory();
      } finally {
        await page.evaluate((resume) => {
          window.__game.perf!.setPaused(false);
          if (resume) window.__game.perf!.pauseSimulation(false);
        }, resume);
        gcMeasurementPauseMs += performance.now() - before;
      }
    }
    async function drain(): Promise<void> {
      const batch = await page.evaluate(() => window.__game.perf!.drain());
      batches.frameMs.push(...batch.frameMs);
      batches.physicsStepMs.push(...batch.physicsStepMs);
      batches.engineStepMs.push(...batch.engineStepMs);
      batches.droppedSamples += batch.droppedSamples;
    }
    await page.evaluate(
      (steps) => window.__game.perf!.start(steps),
      replaySteps,
    );
    let nextProgress = 30;
    for (;;) {
      await drain();
      memorySamples.push(await memory());
      const elapsed = (performance.now() - started) / 1000;
      if (!first && elapsed >= config.durationSeconds)
        throw new Error(
          'The first memory checkpoint was missed; the run is invalid.',
        );
      if (!first && elapsed >= config.baselineSeconds)
        first = await checkpoint();
      if (!minuteFive && elapsed >= 300) minuteFive = await checkpoint();
      const progress = await page.evaluate(() =>
        window.__game.perf!.progress(),
      );
      if (progress.done) {
        await drain();
        await verifyScriptEof();
        completedReplays++;
        completedSteps += progress.completedSteps;
        terminalStates.push(
          await page.evaluate(() => window.__game.getTelemetry()),
        );
        if ((performance.now() - started) / 1000 >= config.durationSeconds) {
          last = await checkpoint();
          if (!minuteFive && last.elapsedSeconds >= 300) minuteFive = last;
          break;
        }
        const steps = await prepareReplay();
        if (
          steps !== replaySteps ||
          JSON.stringify(await readParameters()) !== JSON.stringify(parameters)
        )
          throw new Error('A repeated drive changed its step count or tuning.');
        await page.evaluate((steps) => window.__game.perf!.start(steps), steps);
      }
      if (errors.length) throw new Error(errors.join('\n'));
      if (elapsed >= nextProgress) {
        console.log(
          'Measured ' +
            Math.floor(elapsed) +
            '/' +
            config.durationSeconds +
            ' minimum seconds; ' +
            completedReplays +
            ' complete replays; ' +
            batches.physicsStepMs.length +
            ' captured steps.',
        );
        nextProgress += 30;
      }
      await delay(1000);
    }
    await page.evaluate(() => window.__game.perf!.setPaused(true));
    await drain();
    if (!first || !last || last.elapsedSeconds <= first.elapsedSeconds)
      throw new Error('Both distinct memory checkpoints are required.');
    const timing = {
      frame: summarize(batches.frameMs),
      physicsStep: summarize(batches.physicsStepMs),
      engineStep: summarize(batches.engineStepMs),
    };
    const checks = assess(
      timing.physicsStep,
      first,
      last,
      config.limits,
      batches.droppedSamples,
    );
    checks.failures.push(...errors);
    const finalParameters = await readParameters();
    if (JSON.stringify(parameters) !== JSON.stringify(finalParameters))
      checks.failures.push('Tuning changed during measurement.');
    if (
      batches.physicsStepMs.length !== batches.engineStepMs.length ||
      batches.physicsStepMs.length !== completedSteps
    )
      checks.failures.push(
        'Captured samples do not cover every completed replay step.',
      );
    const droppedSimulationSeconds =
      (await page.evaluate(() =>
        Number(window.__game.getTelemetry().droppedSeconds),
      )) - initialDroppedSeconds;
    const report = {
      schemaVersion: 1,
      recordedAt: new Date().toISOString(),
      revision: execFileSync('git', ['rev-parse', 'HEAD'], {
        encoding: 'utf8',
      }).trim(),
      worktreeDirty:
        execFileSync('git', ['status', '--porcelain'], {
          encoding: 'utf8',
        }).trim() !== '',
      host: {
        platform: platform(),
        arch: arch(),
        cpu: cpus()[0]?.model,
        logicalCpus: cpus().length,
        node: process.version,
        loadAverageAtStart,
        loadAverageAtEnd: loadavg(),
      },
      browser: browser.version(),
      viewport: { width: 1280, height: 720 },
      mode:
        config.durationSeconds >= 300 &&
        config.baselineSeconds === 60 &&
        !config.skipSpike
          ? 'sustained'
          : 'smoke/custom',
      scenario: { name: scenario.name, description: scenario.description },
      inputIdentity: driver.identity,
      scenarioFingerprint,
      parameters,
      finalParameters,
      parameterFingerprint,
      configurationFingerprint,
      replay: {
        stepsPerReplay: replaySteps,
        completedReplays,
        completedSteps,
        terminalStates,
      },
      config,
      reference,
      manualBaseline,
      timing,
      memory: {
        first,
        minuteFive: minuteFive ?? null,
        last,
        samples: memorySamples,
        ...checks.growth,
      },
      gcMeasurementPauseMs,
      droppedSimulationSeconds,
      droppedSamples: batches.droppedSamples,
      failures: checks.failures,
      passed: checks.failures.length === 0,
    };
    const output = resolve(config.output);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(report, null, 2) + '\n');
    console.table(
      Object.entries(timing).map(([metric, data]) => ({
        metric,
        samples: data.count,
        averageMs: data.meanMs.toFixed(4),
        p50Ms: data.p50Ms.toFixed(4),
        p95Ms: data.p95Ms.toFixed(4),
        p99Ms: data.p99Ms.toFixed(4),
        standardDeviationMs: data.standardDeviationMs.toFixed(4),
      })),
    );
    console.log(
      'Complete replays: ' +
        completedReplays +
        '; steps: ' +
        completedSteps +
        '; configuration: ' +
        configurationFingerprint,
    );
    console.log(
      'Physics state uses complete fixed-step replays; frame timing is a distribution, not a deterministic result.',
    );
    console.log(
      'Memory checkpoints: ' +
        first.elapsedSeconds.toFixed(2) +
        ' -> ' +
        last.elapsedSeconds.toFixed(2) +
        ' seconds (post-GC, final at EOF).',
    );
    console.log(
      'JS heap: ' +
        first.jsUsedBytes +
        ' -> ' +
        last.jsUsedBytes +
        ' bytes (' +
        checks.growth.jsUsedPercent!.toFixed(2) +
        '%).',
    );
    if (minuteFive)
      console.log(
        'JS heap at minute five: ' + minuteFive.jsUsedBytes + ' bytes.',
      );
    console.log(
      'WASM capacity: ' +
        last.wasmHeapBytes +
        '; free: ' +
        last.wasmFreeBytes +
        '; allocator used: ' +
        first.wasmUsedBytes +
        ' -> ' +
        last.wasmUsedBytes +
        ' (' +
        checks.growth.wasmUsedPercent!.toFixed(2) +
        '%).',
    );
    console.log(
      'Explicit measurement pauses: ' +
        gcMeasurementPauseMs.toFixed(1) +
        ' ms; dropped simulation time: ' +
        droppedSimulationSeconds.toFixed(3) +
        ' s.',
    );
    console.log(
      (report.passed ? 'PASS' : 'FAIL') + ' (' + report.mode + '): ' + output,
    );
    for (const failure of checks.failures) console.error(failure);
    if (!report.passed) process.exitCode = 1;
  } finally {
    clearTimeout(watchdog);
    await browser?.close();
    await new Promise<void>((resolveClose, reject) =>
      server.httpServer.close((error) =>
        error ? reject(error) : resolveClose(),
      ),
    );
  }
}
void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
