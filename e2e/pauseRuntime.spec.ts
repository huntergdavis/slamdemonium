import { expect, test } from '@playwright/test';
import handbrakeTurn from '../src/input/examples/handbrake-turn.json';

test('mounted pause menu shares live pause, respawn and Options wiring', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('./');
  await page.waitForFunction(() => window.__game?.ready);
  await page.evaluate(() => {
    window.__game.perf!.pauseSimulation(true);
    window.__game.setInput({ throttle: 1 });
    window.__game.stepMany(120);
    window.__game.releaseInput();
  });
  expect(
    await page.evaluate(() => Number(window.__game.getTelemetry().speed)),
  ).toBeGreaterThan(1);
  const canvas = page.getByLabel('Driving view');
  await canvas.focus();
  await page.keyboard.press('Escape');
  const menu = page.getByRole('dialog', { name: 'Pause menu', exact: true });
  await expect(menu).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('console-pause-live-game.png'),
  });
  const steps = await page.evaluate(
    () => window.__game.getTelemetry().totalSteps,
  );
  await page.getByRole('button', { name: 'Options', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: 'Paused — Options' }),
  ).toBeVisible();
  await expect(page.locator('.sl-options')).toHaveCount(1);
  await page.getByRole('button', { name: 'Close Options' }).click();
  await expect(menu).toBeVisible();
  expect(
    await page.evaluate(() => window.__game.getTelemetry().totalSteps),
  ).toBe(steps);
  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  await expect(menu).toBeHidden();
  expect(await page.evaluate(() => window.__game.getTelemetry().speed)).toBe(0);
  expect(await page.evaluate(() => window.__game.getTelemetry().paused)).toBe(
    true,
  );

  // Releasing the independent perf pause must not release an open menu.
  await page.keyboard.press('Escape');
  await expect(menu).toBeVisible();
  await page.evaluate(() => window.__game.perf!.pauseSimulation(false));
  expect(await page.evaluate(() => window.__game.getTelemetry().paused)).toBe(
    true,
  );
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect
    .poll(() => page.evaluate(() => window.__game.getTelemetry().paused))
    .toBe(false);
  await expect(canvas).toBeFocused();
  expect(errors).toEqual([]);
});

interface PauseTestPad {
  pulse(buttons: number[], axis?: number): Promise<void>;
}
declare global {
  interface Window {
    __pausePad: PauseTestPad;
  }
}

test('console menu blocks live driving and respawn, and can close during replay', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const pad = {
      id: 'WP18 standard controller',
      index: 0,
      connected: true,
      mapping: 'standard',
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({
        pressed: false,
        touched: false,
        value: 0,
      })),
    };
    let polls = 0;
    Object.defineProperty(navigator, 'getGamepads', {
      value: () => {
        polls++;
        return [pad];
      },
    });
    const set = (buttons: number[], axis: number) => {
      pad.axes[0] = axis;
      pad.buttons.forEach((button, index) => {
        button.pressed = buttons.includes(index);
        button.value = button.pressed ? 1 : 0;
      });
    };
    const nextPoll = () =>
      new Promise<void>((resolve) => {
        const before = polls;
        const check = () => {
          if (polls > before) resolve();
          else requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
      });
    window.__pausePad = {
      async pulse(buttons, axis = 0) {
        set(buttons, axis);
        await nextPoll();
        set([], 0);
        await nextPoll();
      },
    };
  });
  await page.goto('./');
  await page.waitForFunction(() => window.__game?.ready);
  await page.evaluate(() => {
    const game = window.__game;
    game.perf!.pauseSimulation(true);
    game.setInput({ throttle: 1 });
    game.stepMany(120);
    game.releaseInput();
  });
  await page.getByLabel('Driving view').focus();
  const openingPose = await page.evaluate(
    () => window.__game.getTelemetry().position,
  );
  await page.evaluate(() => window.__pausePad.pulse([3, 9]));
  expect(
    await page.evaluate(() => window.__game.getTelemetry().position),
  ).toEqual(openingPose);
  const menu = page.getByRole('dialog', { name: 'Pause menu', exact: true });
  await expect(menu).toBeVisible();
  // Only the menu now owns the pause: perf cannot hide an unpaused-game bug.
  await page.evaluate(() => window.__game.perf!.pauseSimulation(false));
  const before = await page.evaluate(() => window.__game.getTelemetry());
  expect(Number(before.speed)).toBeGreaterThan(1);
  await page.keyboard.down('KeyW');
  await page.keyboard.down('KeyA');
  // X, Y, both triggers and steering: Y must NOT call respawn behind the menu.
  await page.evaluate(() => window.__pausePad.pulse([2, 3, 6, 7], 1));
  await page.keyboard.up('KeyA');
  await page.keyboard.up('KeyW');
  const after = await page.evaluate(() => window.__game.getTelemetry());
  for (const key of [
    'position',
    'rotation',
    'velocity',
    'angularVelocity',
    'speed',
    'totalSteps',
  ])
    expect(after[key], key + ' while menu open').toEqual(before[key]);
  expect(after.paused).toBe(true);
  // A stopped live-input poll has not armed the script processor for a step.
  await page.evaluate(() => window.__pausePad.pulse([3, 9]));
  await expect(menu).toBeHidden();
  expect(
    Number(await page.evaluate(() => window.__game.getTelemetry().speed)),
  ).toBeGreaterThan(1);

  // Replay drives the actual mapper; pause polling must still accept menu commands.
  // Keep it short in simulated time, with perf owning a temporary setup pause.
  const slideAngle = await page.evaluate((source) => {
    const game = window.__game;
    game.scripts!.load(source, { tuning: 'apply' });
    game.perf!.pauseSimulation(true);
    game.stepMany(270); // Handbrake/steer segment starts at step 270.
    while (
      game.scripts!.progress().completedSteps < 330 &&
      Math.abs(Number(game.getTelemetry().beta)) < 0.1
    )
      game.stepMany(1);
    return Number(game.getTelemetry().beta);
  }, handbrakeTurn);
  expect(Math.abs(slideAngle)).toBeGreaterThanOrEqual(0.1);
  await page.keyboard.press('Escape');
  await expect(menu).toBeVisible();
  await page.evaluate(() => window.__game.perf!.pauseSimulation(false));
  const pausedAt = await page.evaluate(
    () => window.__game.scripts!.progress().completedSteps,
  );
  await page.evaluate(() => window.__pausePad.pulse([3, 7], -1));
  expect(
    await page.evaluate(() => window.__game.scripts!.progress().completedSteps),
  ).toBe(pausedAt);
  await page.evaluate(() => window.__pausePad.pulse([3, 9]));
  await expect(menu).toBeHidden();
  await expect
    .poll(() =>
      page.evaluate(() => window.__game.scripts!.progress().completedSteps),
    )
    .toBeGreaterThan(pausedAt);
  // Finish manually at EOF and compare with a fresh uninterrupted replay.
  const interrupted = await page.evaluate(() => {
    window.__game.perf!.pauseSimulation(true);
    window.__game.stepMany(1000);
    return window.__game.scripts!.result();
  });
  const uninterrupted = await page.evaluate((source) => {
    window.__game.scripts!.load(source, { tuning: 'verify' });
    window.__game.perf!.pauseSimulation(true);
    window.__game.stepMany(1000);
    return window.__game.scripts!.result();
  }, handbrakeTurn);
  expect(interrupted.completedSteps).toBe(handbrakeTurn.durationSteps);
  expect(interrupted.allFinite).toBe(true);
  expect(interrupted).toEqual(uninterrupted);
  expect(errors).toEqual([]);
});
