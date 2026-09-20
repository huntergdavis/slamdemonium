import { expect, test } from '@playwright/test';

test('performance capture stops at exact EOF in manual and RAF modes', async ({
  page,
}) => {
  await page.goto('./');
  await page.waitForFunction(() => window.__game?.ready);
  const manual = await page.evaluate(() => {
    const game = window.__game;
    const perf = game.perf!;
    perf.pauseSimulation(true);
    game.respawn();
    perf.setStepDriver((step) =>
      game.setInput({ throttle: 1, brake: 0, steer: step < 18 ? 0.5 : -0.5 }),
    );
    perf.start(37);
    game.stepMany(100);
    game.stepMany(100);
    return {
      progress: perf.progress(),
      samples: perf.drain(),
      telemetry: game.getTelemetry(),
    };
  });
  expect(manual.progress).toEqual({
    completedSteps: 37,
    totalSteps: 37,
    done: true,
  });
  expect(manual.samples.physicsStepMs).toHaveLength(37);
  expect(manual.samples.engineStepMs).toHaveLength(37);
  await page.evaluate(() => {
    window.__game.respawn();
    window.__game.perf!.start(37);
  });
  await page.waitForFunction(() => window.__game.perf!.progress().done);
  const rendered = await page.evaluate(() => ({
    progress: window.__game.perf!.progress(),
    samples: window.__game.perf!.drain(),
    telemetry: window.__game.getTelemetry(),
  }));
  expect(rendered.progress).toEqual(manual.progress);
  expect(rendered.samples.physicsStepMs).toHaveLength(37);
  expect(rendered.samples.engineStepMs).toHaveLength(37);
  expect(rendered.samples.frameMs.length).toBeGreaterThan(0);
  expect(rendered.telemetry.position).toEqual(manual.telemetry.position);
  expect(rendered.telemetry.rotation).toEqual(manual.telemetry.rotation);
  expect(rendered.telemetry.speed).toEqual(manual.telemetry.speed);
});
