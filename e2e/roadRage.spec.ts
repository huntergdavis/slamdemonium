import { expect, test } from '@playwright/test';

test('Road Rage holds the start, shows GO, and retries with fresh rivals', async ({
  page,
}) => {
  test.setTimeout(180_000); // software WebGL + four live Jolt rivals
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('./?map=road-rage');
  await page.waitForFunction(() => window.__game?.ready);
  const card = page.locator('.sl-hud__road-rage');
  await expect(card).toContainText('ROAD RAGE');
  const before = await page.evaluate(() => ({
    event: window.__game.getRoadRage?.(),
    rivals: window.__game.getTraffic?.().filter((car) => car.rival),
  }));
  expect(before.event?.phase).toBe('countdown');
  expect(before.rivals).toHaveLength(4);
  await page.evaluate(() => window.__game.tuning.set('physicsHz', 60));

  const during = await page.evaluate(() => {
    window.__game.setInput({ throttle: 1 });
    window.__game.stepMany(60);
    return {
      event: window.__game.getRoadRage?.(),
      speed: Number(window.__game.getTelemetry().speed),
    };
  });
  expect(during.event?.phase).toBe('countdown');
  expect(during.event?.count).toBe(0);
  expect(during.speed).toBeLessThan(1);

  // The countdown is three simulated seconds. Keep the browser journey short
  // enough that a software-rendered CI worker can still exercise Enter.
  await page.evaluate(() => window.__game.stepMany(130));
  await expect(card).not.toHaveAttribute('data-phase', 'countdown');
  const running = await page.evaluate(() => ({
    event: window.__game.getRoadRage?.(),
    speed: Number(window.__game.getTelemetry().speed),
  }));
  expect(running.event?.phase).toBe('running');
  expect(running.speed).toBeGreaterThan(1);

  await page.keyboard.press('Enter');
  await expect(card).toHaveAttribute('data-phase', 'countdown');
  const retried = await page.evaluate(() => ({
    event: window.__game.getRoadRage?.(),
    rivals: window.__game.getTraffic?.().filter((car) => car.rival),
    speed: Number(window.__game.getTelemetry().speed),
  }));
  expect(retried.event?.count).toBe(0);
  expect(retried.event?.remaining).toBe(180);
  expect(retried.speed).toBeLessThan(1);
  expect(retried.rivals).toHaveLength(4);
  expect(retried.rivals?.every((car) => !car.wrecked)).toBe(true);
  const oldIds = new Set(before.rivals?.map((car) => car.id));
  expect(retried.rivals?.every((car) => !oldIds.has(car.id))).toBe(true);
  expect(errors).toEqual([]);
});
