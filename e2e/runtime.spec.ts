import { expect, test as base } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import standingStart from '../src/input/examples/standing-start.json' with { type: 'json' };

const test = base.extend<{ runtimeErrors: void }>({
  runtimeErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      await use();
      expect(errors).toEqual([]);
    },
    { auto: true },
  ],
});

test('live boot dispatches O/H/F9/Tab/T/P/R/C/G and a slider changes vehicle behavior', async ({
  page,
}) => {
  await page.goto('./');
  await page.waitForFunction(() => window.__game?.ready);
  const canvas = page.getByLabel('Driving view');
  await canvas.focus();
  await page.keyboard.down('KeyW');
  await page.evaluate(() => window.__game.stepMany(120));
  expect(
    await page.evaluate(() => window.__game.getTelemetry().speed),
  ).toBeGreaterThan(1);
  await page.keyboard.press('KeyO');
  await expect(page.locator('.sl-options')).toHaveAttribute(
    'data-open',
    'true',
  );
  await page.keyboard.up('KeyW');

  // Paused polling must keep all UI commands alive without advancing physics.
  await page.keyboard.press('KeyP');
  await expect
    .poll(() => page.evaluate(() => window.__game.getTelemetry().paused))
    .toBe(true);
  const before = await page.evaluate(
    () => window.__game.getTelemetry().totalSteps,
  );
  await page.keyboard.press('KeyH');
  await expect(page.locator('.sl-hud')).toHaveAttribute('data-mode', 'minimal');
  await page.keyboard.press('KeyH');
  await expect(page.locator('.sl-hud')).toHaveAttribute('data-mode', 'off');
  await page.keyboard.press('KeyH');
  await expect(page.locator('.sl-hud')).toHaveAttribute('data-mode', 'full');
  expect(
    await page.evaluate(() => window.__game.getTelemetry().totalSteps),
  ).toBe(before);
  await page.keyboard.press('KeyT');
  await expect
    .poll(() => page.evaluate(() => window.__game.tuning.get('timeScale')))
    .toBe(0.25);
  await page.keyboard.press('KeyT');
  await expect
    .poll(() => page.evaluate(() => window.__game.tuning.get('timeScale')))
    .toBe(1);
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('button', { name: 'Activate slot B' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('button', { name: 'Activate slot A' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('KeyC');
  await expect
    .poll(() => page.evaluate(() => window.__game.getTelemetry().cameraPreset))
    .toBe('far');
  await page.keyboard.press('KeyG');
  await expect
    .poll(() => page.evaluate(() => window.__game.getTelemetry().gizmosVisible))
    .toBe(true);

  // Use the real slider event, then compare equal fixed-step launches.
  await page.getByRole('searchbox').fill('accel0');
  const slider = page.locator('#group-accel0-range');
  await slider.evaluate((element) => {
    const range = element as HTMLInputElement;
    range.value = range.min;
    range.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const slow = await page.evaluate(() => {
    window.__game.respawn();
    window.__game.setInput({ throttle: 1, brake: 0, steer: 0 });
    window.__game.stepMany(240);
    return Number(window.__game.getTelemetry().speed);
  });
  await slider.evaluate((element) => {
    const range = element as HTMLInputElement;
    range.value = range.max;
    range.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const fast = await page.evaluate(() => {
    window.__game.respawn();
    window.__game.stepMany(240);
    return Number(window.__game.getTelemetry().speed);
  });
  expect(fast).toBeGreaterThan(slow * 1.5);

  await canvas.focus();
  await page.keyboard.press('KeyR');
  await expect
    .poll(() => page.evaluate(() => window.__game.getTelemetry().speed))
    .toBe(0);
  await page.keyboard.press('F9');
  await expect(page.locator('.sl-hud__recording')).toContainText('REC');
  await page.evaluate(() => window.__game.stepMany(24));
  const downloadEvent = page.waitForEvent('download');
  await page.keyboard.press('F9');
  const download = await downloadEvent;
  const lines = (await readFile((await download.path())!, 'utf8'))
    .trim()
    .split('\n');
  expect(JSON.parse(lines[0]!.slice(2)).sampleCount).toBe(24);
  expect(lines).toHaveLength(26);
  await page.keyboard.press('KeyO');
  await expect(page.locator('.sl-options')).toHaveAttribute(
    'data-open',
    'false',
  );
  await page.keyboard.press('KeyP');
  await expect
    .poll(() => page.evaluate(() => window.__game.getTelemetry().paused))
    .toBe(false);
  await expect
    .poll(() =>
      page.evaluate(() => Number(window.__game.getTelemetry().totalSteps)),
    )
    .toBeGreaterThan(Number(before));
});

test('boot mass rebuild preserves motion; tuning survives reload, JSON import and share hashes', async ({
  page,
}) => {
  await page.goto('./');
  await page.waitForFunction(() => window.__game?.ready);
  await page.evaluate(() => {
    window.__game.perf!.pauseSimulation(true);
    window.__game.setOptionsOpen(true);
    window.__game.setInput({ throttle: 1 });
    window.__game.stepMany(240);
  });
  const pose = await page.evaluate(() => window.__game.getTelemetry());
  await page.getByRole('searchbox').fill('mass');
  await page.locator('#group-mass-number').fill('1800');
  await expect
    .poll(() => page.evaluate(() => window.__game.getTelemetry().mass))
    .toBe(1800);
  const rebuilt = await page.evaluate(() => window.__game.getTelemetry());
  const oldPosition = pose.position as { x: number; y: number; z: number };
  const position = rebuilt.position as { x: number; y: number; z: number };
  for (const axis of ['x', 'y', 'z'] as const)
    expect(position[axis]).toBeCloseTo(oldPosition[axis], 4);
  expect(Number(rebuilt.speed)).toBeCloseTo(Number(pose.speed), 4);
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
  await page.reload();
  await page.waitForFunction(() => window.__game?.ready);
  expect(await page.evaluate(() => window.__game.tuning.get('mass'))).toBe(
    1800,
  );
  expect(await page.evaluate(() => window.__game.getTelemetry().mass)).toBe(
    1800,
  );
  await page.evaluate(() => window.__game.setOptionsOpen(true));
  const exportEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const exported = await exportEvent;
  const json = await readFile((await exported.path())!, 'utf8');
  expect(JSON.parse(json).values.mass).toBe(1800);
  await page.evaluate(() => window.__game.tuning.set('mass', 1200));
  await page.locator('input[type=file]').setInputFiles({
    name: 'roundtrip.json',
    mimeType: 'application/json',
    buffer: Buffer.from(json),
  });
  await expect
    .poll(() => page.evaluate(() => window.__game.tuning.get('mass')))
    .toBe(1800);
  await page.getByRole('button', { name: 'Share link', exact: true }).click();
  const shared = page.url();
  expect(new URL(shared).hash.length).toBeGreaterThan(10);
  // Clear after pagehide saves, before the next boot reads persistence.
  await page.addInitScript(() => localStorage.clear());
  await page.goto(shared);
  await page.reload();
  await page.waitForFunction(() => window.__game?.ready);
  expect(await page.evaluate(() => window.__game.tuning.get('mass'))).toBe(
    1800,
  );
});

test('runtime scripts reset injected input and mass work, replay exactly, and resume commands after EOF', async ({
  page,
}) => {
  await page.goto('./');
  await page.waitForFunction(() => window.__game?.ready);
  const result = await page.evaluate((source) => {
    const game = window.__game;
    const script = { ...source, durationSteps: 37, frames: [source.frames[0]] };
    game.setInput({ throttle: 0, brake: 1 });
    game.tuning.set('mass', 1800); // pending debounce must not fire mid-replay
    game.scripts!.load(script, { tuning: 'apply' });
    let playbackInjectionRejected = false;
    try {
      game.setInput({ throttle: 0 });
    } catch {
      playbackInjectionRejected = true;
    }
    game.stepMany(100);
    const first = game.scripts!.result();
    const terminalSteps = game.getTelemetry().totalSteps;
    game.stepMany(100);
    const afterExtra = game.getTelemetry().totalSteps;
    game.scripts!.load(script, { tuning: 'verify' });
    game.stepMany(100);
    return {
      first,
      playbackInjectionRejected,
      second: game.scripts!.result(),
      progress: game.scripts!.progress(),
      terminalSteps,
      afterExtra,
      mass: game.getTelemetry().mass,
      tuningMass: script.tuning.mass,
    };
  }, standingStart);
  expect(result.progress).toEqual({
    completedSteps: 37,
    totalSteps: 37,
    done: true,
  });
  expect(result.playbackInjectionRejected).toBe(true);
  expect(result.first).toEqual(result.second);
  expect(result.afterExtra).toBe(result.terminalSteps);
  expect(result.mass).toBe(result.tuningMass);
  await page.getByLabel('Driving view').focus();
  await page.keyboard.press('KeyO');
  await expect(page.locator('.sl-options')).toHaveAttribute(
    'data-open',
    'true',
  );
  await page.keyboard.press('KeyR');
  await expect
    .poll(() =>
      page.evaluate(() => window.__game.scripts!.progress().totalSteps),
    )
    .toBe(0);
});

test('input recording rejects mismatched automation and captures only mapper controls', async ({
  page,
}) => {
  await page.goto('./');
  await page.waitForFunction(() => window.__game?.ready);
  const result = await page.evaluate(() => {
    const game = window.__game;
    game.perf!.pauseSimulation(true);
    game.respawn();
    game.setInput({ throttle: 1 });
    let startRejected = false,
      injectionRejected = false,
      driverRejected = false;
    try {
      game.scripts!.startRecording('unsafe');
    } catch {
      startRejected = true;
    }
    game.releaseInput();
    game.scripts!.startRecording('mapper-only');
    try {
      game.setInput({ throttle: 1 });
    } catch {
      injectionRejected = true;
    }
    try {
      game.perf!.setStepDriver(() => {});
    } catch {
      driverRejected = true;
    }
    game.stepMany(4);
    const recording = game.scripts!.stopRecording();
    return { startRejected, injectionRejected, driverRejected, recording };
  });
  expect(
    result.startRejected && result.injectionRejected && result.driverRejected,
  ).toBe(true);
  expect(result.recording.durationSteps).toBe(4);
  expect(result.recording.frames[0]!.input.throttle).toBe(0);
});
