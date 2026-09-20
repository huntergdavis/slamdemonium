import { expect, test } from '@playwright/test';

test('five simulated minutes keep JS/WASM memory bounded and warmed shader variants stable', async ({
  page,
}, testInfo) => {
  // CI traces spent 87–90 s in completed batches before the 90 s suite deadline.
  // Keep the full 36,000 steps and heap limits; this is not a timing benchmark.
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 320, height: 180 });
  await page.goto('./');
  await page.waitForFunction(
    () => window.__game?.ready && window.__allocationFixture,
  );
  await page.evaluate(() => {
    const game = window.__game;
    game.perf!.pauseSimulation(true);
    game.respawn();
    // One input object for the entire run, following the real input/vehicle path.
    const input = {
      throttle: 1,
      brake: 0,
      steer: 0.5,
      handbrake: false,
      boost: false,
    };
    game.perf!.setStepDriver((step) => {
      input.throttle = step % 960 < 720 ? 1 : 0;
      input.brake = step % 960 >= 720 ? 1 : 0;
      input.steer = step % 960 < 360 ? 0.5 : -0.5;
      input.handbrake = step % 960 >= 600 && step % 960 < 720;
      game.setInput(input);
    });
    game.perf!.start(36000);
    game.perf!.pauseSimulation(true);
  });
  const cdp = await page.context().newCDPSession(page);
  // Accelerated simulation: 120 Hz physics, one explicit render per simulated
  // second plus normal RAF. The separate npm run perf checks sustained wall time.
  async function advance(seconds: number): Promise<void> {
    for (let i = 0; i < seconds; i += 10) {
      await page.evaluate(() => {
        for (let second = 0; second < 10; second++) {
          window.__game.stepMany(120);
          window.__allocationFixture!.renderFrames(1);
        }
      });
    }
  }
  async function memory() {
    await cdp.send('HeapProfiler.collectGarbage');
    return {
      js: (await cdp.send('Runtime.getHeapUsage')).usedSize,
      wasm: await page.evaluate(() => window.__game.perf!.getMemory()),
    };
  }
  await advance(60);
  const baseline = await memory();
  await advance(240);
  const final = await memory();
  const result = await page.evaluate(() => {
    const fixture = window.__allocationFixture!;
    // Warm whatever the terminal view exposes, then detect repeated invalidation
    // without camera/culling changes. Material count alone cannot detect this.
    fixture.renderFrames(3);
    fixture.resetProgramCalls();
    fixture.renderFrames(12);
    return {
      progress: window.__game.perf!.progress(),
      shaderParameterBuilds: fixture.programCalls(),
      telemetry: window.__game.getTelemetry(),
    };
  });
  const evidence = { baseline, final, ...result };
  console.log(
    'WP13 heap regression',
    JSON.stringify({
      baseline,
      final,
      completedSteps: result.progress.completedSteps,
      shaderParameterBuilds: result.shaderParameterBuilds,
    }),
  );
  await testInfo.attach('heap-regression.json', {
    body: JSON.stringify(evidence, null, 2),
    contentType: 'application/json',
  });
  expect(result.progress.completedSteps).toBe(36000);
  expect(result.progress.done).toBe(true);
  expect(result.telemetry.recoveryCount).toBe(0);
  expect(result.telemetry.skidSegmentsWritten).toBeGreaterThan(0);
  expect(final.js).toBeLessThanOrEqual(baseline.js * 1.1);
  expect(final.wasm.heapBytes).toBe(baseline.wasm.heapBytes);
  expect(final.wasm.freeBytes).toBeGreaterThanOrEqual(baseline.wasm.freeBytes);
  expect(result.shaderParameterBuilds).toBe(0);
  const negativeControl = await page.evaluate(() => {
    const fixture = window.__allocationFixture!;
    fixture.restoreSharedMaterials();
    fixture.renderFrames(3);
    fixture.resetProgramCalls();
    fixture.renderFrames(12);
    return fixture.programCalls();
  });
  console.log('WP13 shared-material negative control', negativeControl);
  expect(negativeControl).toBeGreaterThan(0);
});
