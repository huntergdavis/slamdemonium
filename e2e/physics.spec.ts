import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test('production WASM passes the Day-1 spike without isolation headers', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  let wasmStatus = 0;
  let wasmType = '';
  let wasmUrl = '';
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('response', (response) => {
    if (response.url().endsWith('.wasm')) {
      wasmStatus = response.status();
      wasmType = response.headers()['content-type'] ?? '';
      wasmUrl = response.url();
    }
  });
  await page.goto('./');
  await page.waitForFunction(() => window.__game?.ready);
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(false);
  expect(wasmStatus).toBe(200);
  expect(wasmType).toContain('application/wasm');
  expect(wasmUrl).toContain((process.env.VITE_BASE_PATH || '/') + 'assets/');
  const result = await page.evaluate(async () => {
    if (!window.__game.runPhysicsSpike)
      throw new Error('Missing physics spike harness.');
    return window.__game.runPhysicsSpike();
  });
  await writeFile(
    testInfo.outputPath('physics-spike.json'),
    JSON.stringify(result, null, 2),
  );
  await testInfo.attach('physics-spike.json', {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  });
  expect(result.settledHeight).toBeCloseTo(0.5, 1);
  expect(result.rayDistance).toBeCloseTo(4, 5);
  expect(result.rayNormalY).toBe(1);
  expect(result.forceVelocityZ).toBeLessThan(0);
  expect(result.torqueVelocityY).toBeGreaterThan(0);
  expect(result.ccdMaxX).toBeLessThan(0);
  expect(result.meanStepMs).toBeLessThan(0.2);
  expect(result.replayHashes[0]).toBe(result.replayHashes[1]);
  expect(result.finiteSteps).toBe(72_000);
  expect(result.allocatorLostBytes).toBe(0);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('physics-scene.png') });
});

test('the loop reads live physicsHz/timeScale and supports deterministic manual stepping', async ({
  page,
}) => {
  await page.goto('./');
  await page.waitForFunction(() => window.__game?.ready);
  const result = await page.evaluate(() => {
    const game = window.__game;
    game.tuning.set('physicsHz', 240);
    game.tuning.set('timeScale', 0.5);
    game.respawn();
    const before = game.getTelemetry();
    game.stepMany(240);
    return { before, after: game.getTelemetry() };
  });
  expect(result.after.physicsHz).toBe(240);
  expect(result.after.timeScale).toBe(0.5);
  expect(
    Number(result.after.totalSteps) - Number(result.before.totalSteps),
  ).toBe(240);
  expect(Number(result.after.speed)).toBeGreaterThanOrEqual(0);
});
