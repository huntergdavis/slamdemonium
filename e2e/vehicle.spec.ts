import { expect, test } from '@playwright/test';

test.setTimeout(90_000);
test.use({ viewport: { width: 800, height: 450 } });

test('G1: keyboard drives the suspended box on the track and the camera follows', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('./');
  await page.waitForFunction(() => window.__game?.ready);
  await page.locator('canvas').focus();
  await page.evaluate(() => {
    window.__game.respawn();
    window.__game.stepMany(240);
  });
  const before = await page.evaluate(() => window.__game.getTelemetry());
  await page.keyboard.down('KeyW');
  await page.evaluate(() => window.__game.stepMany(120));
  const driven = await page.evaluate(() => window.__game.getTelemetry());
  expect(Number(driven.speed)).toBeGreaterThan(10);
  expect(driven.groundedWheels).toBe(4);
  expect((driven.position as { z: number }).z).toBeLessThan(
    (before.position as { z: number }).z - 5,
  );
  await page.keyboard.down('KeyA');
  await page.evaluate(() => window.__game.stepMany(90));
  await page.keyboard.up('KeyA');
  await page.keyboard.up('KeyW');
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const turned = await page.evaluate(() => window.__game.getTelemetry());
  expect((turned.position as { x: number }).x).toBeLessThan(129);
  expect(Number(turned.yawRate)).toBeGreaterThan(0);
  const camera = turned.cameraPosition as { x: number; y: number; z: number };
  const car = turned.position as { x: number; y: number; z: number };
  expect(
    Math.hypot(camera.x - car.x, camera.y - car.y, camera.z - car.z),
  ).toBeLessThan(12);
  expect(turned.recoveryCount).toBe(0);
  expect(errors).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath('g1-keyboard-driving.png'),
  });
  await page.keyboard.press('KeyR');
  await page.evaluate(() => window.__game.stepMany(1));
  const reset = await page.evaluate(() => window.__game.getTelemetry());
  expect((reset.position as { x: number }).x).toBeCloseTo(130, 1);
  expect(Number(reset.speed)).toBeLessThan(1);
});

test('the tuning-lab API refills boost without requiring a drift first', async ({
  page,
}) => {
  await page.goto('./');
  await page.waitForFunction(() => window.__game?.ready);
  const result = await page.evaluate(() => {
    const game = window.__game;
    game.respawn();
    game.stepMany(240);
    const empty = game.getTelemetry().boostMeter;
    game.tuning.set('mass', 1500);
    const pendingMass = game.getTelemetry().massRebuildStatus;
    game.stepMany(0); // Flush synchronously; there is no Options panel in this test.
    const appliedMass = game.getTelemetry();

    game.setDriftMeter(1);
    game.setInput({ throttle: 1, boost: true });
    game.stepMany(120);
    return { empty, pendingMass, appliedMass, after: game.getTelemetry() };
  });
  expect(result.empty).toBe(0);
  expect(result.pendingMass).toBe('pending');
  expect(result.appliedMass.massRebuildStatus).toBe('idle');
  expect(result.appliedMass.mass).toBe(1500);
  expect(Number(result.after.boostMeter)).toBeCloseTo(0.75, 1);
  expect(Number(result.after.boostEnvelope)).toBeGreaterThan(0.9);
});
