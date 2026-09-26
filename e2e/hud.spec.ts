import { expect, test as base, type Page } from '@playwright/test';
import { serveHudBuild } from '../tests/hud/server';
import { readFile } from 'node:fs/promises';

const test = base.extend<
  { hudPage: Page },
  { hudBuild: Awaited<ReturnType<typeof serveHudBuild>> }
>({
  hudBuild: [
    // eslint-disable-next-line no-empty-pattern -- Playwright parses this dependency list.
    async ({}, use) => {
      const server = await serveHudBuild();
      try {
        await use(server);
      } finally {
        await server.close();
      }
    },
    { scope: 'worker' },
  ],
  hudPage: async ({ page, hudBuild }, use) => {
    await page.goto(hudBuild.url);
    await page.waitForFunction(() => Boolean(window.__hudTest));
    await page.evaluate(() => {
      window.__hudTest.manual();
      // The HUD boots off now, and off skips telemetry reads; these
      // instrument tests want it on with one read already made.
      window.__hudTest.hud.setMode('full');
      window.__hudTest.advance(34);
    });
    await use(page);
  },
});

test('boots with the HUD off and the reminder at the bottom, which times out, returns when idle and vanishes on input', async ({
  page,
  hudBuild,
}) => {
  await page.goto(hudBuild.url);
  await page.waitForFunction(() => Boolean(window.__hudTest));
  await page.evaluate(() => window.__hudTest.manual());
  const hud = page.locator('.sl-hud');
  const hint = page.locator('.sl-hud__hint');
  await expect(hud).toHaveAttribute('data-mode', 'off');
  // The instruments are hidden; the persistent mini-map is asserted on the
  // real game in runtime.spec (this harness mounts no map).
  await expect(page.locator('[data-reading="speed"]')).toBeHidden();
  // The two persistent driving instruments stay up and keep reading with
  // the HUD off: speed in mph and the boost bar.
  const drive = page.locator('.sl-hud__drive');
  await expect(drive).toBeVisible();
  await page.evaluate(() => {
    const api = window.__hudTest;
    api.telemetry.speed = 44.704; // 100 mph
    api.telemetry.boostMeter = 0.35;
    api.advance(34);
  });
  await expect(page.locator('[data-reading="driveMph"]')).toHaveText('100');
  await expect(drive.locator('.sl-meter')).toHaveAttribute(
    'aria-valuenow',
    '0.35',
  );
  await page.evaluate(() => window.__hudTest.advance(34));
  await expect(hint).toHaveAttribute('data-visible', 'true');
  await expect(hint).toHaveText('Esc menu · O options · H HUD');
  const viewport = page.viewportSize()!;
  const box = (await hint.boundingBox())!;
  expect(box.y + box.height / 2).toBeGreaterThan(viewport.height * 0.8);
  // Times out after five seconds on its own.
  await page.evaluate(() => window.__hudTest.advance(5000));
  await expect(hint).toHaveAttribute('data-visible', 'false');
  // Comes back after five idle seconds and stays.
  await page.evaluate(() => window.__hudTest.advance(5000));
  await expect(hint).toHaveAttribute('data-visible', 'true');
  await page.evaluate(() => window.__hudTest.advance(30000));
  await expect(hint).toHaveAttribute('data-visible', 'true');
  // Any driving input hides it at once; a resting stick does not count.
  await page.evaluate(() => {
    const api = window.__hudTest;
    api.hud.noteInput({
      throttle: 0,
      brake: 0,
      steer: 0.03,
      handbrake: false,
      boost: false,
    });
    api.advance(34);
  });
  await expect(hint).toHaveAttribute('data-visible', 'true');
  await page.evaluate(() => {
    const api = window.__hudTest;
    api.hud.noteInput({
      throttle: 1,
      brake: 0,
      steer: 0,
      handbrake: false,
      boost: false,
    });
    api.advance(34);
  });
  await expect(hint).toHaveAttribute('data-visible', 'false');
  await page.evaluate(() => window.__hudTest.advance(5000));
  await expect(hint).toHaveAttribute('data-visible', 'true');
  // With the HUD on, the reminder is gone entirely.
  await page.getByLabel('Driving telemetry').focus();
  await page.evaluate(() => {
    window.__hudTest.hud.cycleMode(1);
    window.__hudTest.advance(34);
  });
  await expect(hud).toHaveAttribute('data-mode', 'full');
  await expect(hint).toBeHidden();
  await expect(page.locator('[data-reading="speed"]')).toBeVisible();
});

test('capacity and live rate changes stop visibly and explain the stop in the CSV header', async ({
  hudPage: page,
}) => {
  const capacity = await page.evaluate(async () => {
    const api = window.__hudTest;
    api.hud.toggleRecording();
    api.sample(130);
    api.advance();
    return (await api.state.exports[0]!.blob.text()).trim().split('\n');
  });
  expect(JSON.parse(capacity[0]!.slice(2))).toMatchObject({
    stopReason: 'capacity',
    sampleCount: 120,
    physicsHz: 120,
  });
  expect(capacity).toHaveLength(122);
  expect(capacity[2]!.split(',')[3]).not.toBe(capacity[121]!.split(',')[3]);
  await expect(page.locator('.sl-hud__recording')).toContainText(
    'capacity reached',
  );
  const rate = await page.evaluate(async () => {
    const api = window.__hudTest;
    api.hud.toggleRecording();
    api.sample(3);
    api.store.set('physicsHz', 60);
    api.sample(10);
    api.advance();
    return JSON.parse(
      (await api.state.exports[1]!.blob.text()).split('\n')[0]!.slice(2),
    );
  });
  expect(rate).toMatchObject({
    stopReason: 'physics-rate-changed',
    sampleCount: 3,
    physicsHz: 120,
  });
  await expect(page.locator('.sl-hud__recording')).toContainText(
    'physicsHz changed',
  );
});

test('native exporter downloads complete CSV rows on F9 stop', async ({
  hudPage: page,
}) => {
  await page.evaluate(() => window.__hudTest.useNativeDownload());
  await page.getByLabel('Driving view').focus();
  await page.keyboard.press('F9');
  await expect
    .poll(() => page.evaluate(() => window.__hudTest.hud.recorder.recording))
    .toBe(true);
  await page.evaluate(() => window.__hudTest.sample(4));
  await page.keyboard.press('F9');
  await expect
    .poll(() => page.evaluate(() => window.__hudTest.hud.recorder.recording))
    .toBe(false);
  const downloadPromise = page.waitForEvent('download');
  await page.evaluate(() => window.__hudTest.advance());
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(
    /^slamdemonium-telemetry-.*\.csv$/,
  );
  const csv = await readFile((await download.path())!, 'utf8');
  const lines = csv.trim().split('\n');
  expect(JSON.parse(lines[0]!.slice(2)).sampleCount).toBe(4);
  expect(lines).toHaveLength(6);
});

test('Options shifts the HUD, narrow layouts scroll, and the dock collapses without changing mode', async ({
  hudPage: page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: '⚙ Options' }).click();
  await expect(page.locator('.sl-options')).toHaveAttribute(
    'data-open',
    'true',
  );
  const hud = await page.locator('.sl-hud').boundingBox();
  expect(hud!.x + hud!.width).toBeLessThanOrEqual(1050);
  await page.getByRole('button', { name: 'Close Options' }).click();
  await page.setViewportSize({ width: 1440, height: 720 });
  const wheelCard = await page.locator('.sl-hud__wheels').boundingBox();
  const bottom = await page.locator('.sl-hud__bottom').boundingBox();
  expect(bottom!.y + bottom!.height).toBeLessThanOrEqual(wheelCard!.y);
  await expect(page.locator('[data-reading="speed"]')).toBeInViewport();
  await page.setViewportSize({ width: 390, height: 680 });
  await expect(page.locator('[data-reading="speed"]')).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  await page.getByRole('button', { name: 'Collapse instruments' }).click();
  await expect(page.locator('.sl-hud')).toHaveAttribute('data-mode', 'full');
  await expect(page.locator('.sl-hud__wheels')).toBeHidden();
  await page.getByRole('button', { name: 'Expand instruments' }).click();
  await expect(page.locator('.sl-hud__wheels')).toBeVisible();
  await page.evaluate(() => window.__hudTest.hud.toggleRecording());
  await expect(page.locator('.sl-hud__recording')).toBeInViewport();
});

test('instruments preserve nodes, units, thresholds, state text and the FOV cap', async ({
  hudPage: page,
}) => {
  await expect(page.locator('[data-reading="speed"]')).toHaveText('198');
  await expect(page.locator('[data-reading="fov"]')).toHaveText(
    'FOV 115.0° CAPPED · requested 140.0°',
  );
  await expect(page.locator('[data-meter="FR"]')).toHaveAttribute(
    'data-state',
    'over',
  );
  await expect(page.locator('[data-meter="FR"]')).toContainText('LOCK');
  await expect(page.locator('[data-meter="RR"]')).toContainText('AIR');
  const speed = await page
    .locator('[data-reading="speed"]')
    .evaluateHandle((element) => element.firstChild);
  const changes = await page.evaluate(() => {
    const api = window.__hudTest;
    let rebuilt = 0;
    const observer = new MutationObserver((records) => {
      rebuilt += records.length;
    });
    observer.observe(api.hud.element, { childList: true, subtree: true });
    api.telemetry.speed = 60;
    api.telemetry.speedKmh = 216;
    api.telemetry.beta = 2;
    api.telemetry.wheels[1].gripUsage = 1.8;
    api.store.set('driftMinAngle', 30);
    api.advance();
    rebuilt += observer.takeRecords().length;
    observer.disconnect();
    return {
      rebuilt,
      position: api.hud.element
        .querySelector<HTMLElement>('.sl-gauge')!
        .style.getPropertyValue('--sl-position'),
    };
  });
  expect(changes).toEqual({ rebuilt: 0, position: '100%' });
  expect(
    await speed.evaluate(
      (text) => text?.isConnected && text.nodeValue === '216',
    ),
  ).toBe(true);
  await expect(page.locator('[data-reading="beta"]')).toHaveText(
    'Slide β 114.6°',
  );
  await expect(page.locator('[data-reading="driftThreshold"]')).toHaveText(
    'Drift ticks ±30.0°',
  );
  await expect(page.locator('[data-meter="FR"] .sl-meter__value')).toHaveText(
    '1.80 !',
  );
  await page.evaluate(() => {
    window.__hudTest.panel.session.applyBuiltin('Drifty');
    window.__hudTest.panel.session.swapSlots();
  });
  await expect(page.locator('[data-reading="slot"]')).toHaveText('B ACTIVE');
});

test('tachometer reads RPM, marks redline, and reacts to upshifts without rebuilding', async ({
  hudPage: page,
}) => {
  await expect(page.locator('[data-reading="tachGear"]')).toHaveText('G1');
  await expect(page.locator('[data-reading="tachRpm"]')).toHaveText('6200 rpm');
  await expect(page.locator('.sl-tachometer')).toHaveAttribute(
    'data-state',
    'normal',
  );
  await page.evaluate(() => {
    const api = window.__hudTest;
    api.telemetry.gear = 2;
    api.telemetry.rpm = 4800;
    api.telemetry.upshiftCount = 1;
    api.advance();
  });
  await expect(page.locator('[data-reading="tachGear"]')).toHaveText('G2');
  await expect(page.locator('[data-reading="tachRpm"]')).toHaveText('4800 rpm');
  await expect(page.locator('.sl-tachometer')).toHaveAttribute(
    'data-shift',
    'up',
  );
  await expect(page.locator('.sl-tachometer')).toHaveAttribute(
    'data-state',
    'normal',
  );
  await page.evaluate(() => {
    const api = window.__hudTest;
    api.telemetry.vLong = -2;
    api.telemetry.gear = 1;
    api.telemetry.rpm = 1000;
    api.advance();
  });
  await expect(page.locator('[data-reading="tachGear"]')).toHaveText('R');
  await expect(page.locator('.sl-tachometer')).toHaveAttribute(
    'data-state',
    'normal',
  );
  await page.evaluate(() => {
    const api = window.__hudTest;
    api.telemetry.vLong = 0;
    api.telemetry.rpm = 7100;
    api.advance();
  });
  await expect(page.locator('.sl-tachometer')).toHaveAttribute(
    'data-state',
    'redline',
  );
});

test('tachometer stays unavailable before engine identity is published', async ({
  hudPage: page,
}) => {
  await page.evaluate(() => {
    const api = window.__hudTest;
    api.telemetry.idleRpm = 0;
    api.telemetry.redlineRpm = 0;
    api.telemetry.gearCount = 0;
    api.advance();
  });
  await expect(page.locator('.sl-tachometer')).toHaveAttribute(
    'data-state',
    'unavailable',
  );
  await expect(page.locator('[data-reading="tachGear"]')).toHaveText('—');
  await expect(page.locator('[data-reading="tachRpm"]')).toHaveText('— rpm');
});

test('gates both getters before reading, cycles H, and keeps recording independent of HUD visibility', async ({
  hudPage: page,
}) => {
  const reads = await page.evaluate(() => {
    const api = window.__hudTest;
    const observer = new MutationObserver(() => {});
    observer.observe(api.hud.element, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    });
    for (let i = 0; i < 120; i++) {
      api.hud.cycleMode(0);
      api.hud.cycleMode(3);
      api.hud.setMode('full');
    }
    const noOpWrites = observer.takeRecords().length;
    observer.disconnect();
    api.state.reads = api.state.renderReads = 0;
    for (let i = 0; i < 1000; i++) api.advance(1);
    const full = api.state.reads,
      render = api.state.renderReads;
    api.hud.setMode('off');
    for (let i = 0; i < 1000; i++) api.advance(1);
    return {
      full,
      render,
      afterOff: api.state.reads,
      renderAfterOff: api.state.renderReads,
      noOpWrites,
    };
  });
  expect(reads.noOpWrites).toBe(0);
  expect(reads.full).toBeGreaterThan(0);
  expect(reads.full).toBeLessThanOrEqual(30);
  expect(reads.render).toBe(reads.full);
  // Off still reads telemetry at the same 30 Hz for the persistent mph and
  // boost instruments (a cheap object read and two writes); the render
  // telemetry getter, which only the instrument cards need, is not read.
  expect(reads.afterOff).toBe(reads.full * 2);
  expect(reads.renderAfterOff).toBe(reads.render);
  await page.getByLabel('Driving view').focus();
  await page.keyboard.press('KeyH');
  await expect(page.locator('.sl-hud')).toHaveAttribute('data-mode', 'full');
  await page.keyboard.press('KeyH');
  await expect(page.locator('.sl-hud')).toHaveAttribute('data-mode', 'minimal');
  await expect(page.locator('.sl-hud__graphs')).toBeHidden();
  await expect(page.locator('[data-reading="speed"]')).toBeVisible();
  await page.keyboard.press('KeyH');
  await expect(page.locator('.sl-hud')).toHaveAttribute('data-mode', 'off');
  await expect(page.locator('[data-reading="speed"]')).toBeHidden();
  await page.keyboard.press('F9');
  await expect(page.locator('.sl-hud__recording')).toContainText('REC');
  await page.evaluate(() => {
    window.__hudTest.sample(5);
    window.__hudTest.advance();
  });
  await page.keyboard.press('F9');
  await expect
    .poll(() => page.evaluate(() => window.__hudTest.hud.recorder.recording))
    .toBe(false);
  await page.evaluate(() => window.__hudTest.advance());
  await expect(page.locator('.sl-hud__recording')).toContainText('5 samples');
  await expect(page.locator('.sl-hud__recording')).toBeVisible();
});

test('the chain readout shows the score only when it is happening: in with the first smash, up while the chain lives, out three seconds after it dies, HUD off throughout', async ({
  page,
  hudBuild,
}) => {
  await page.goto(hudBuild.url);
  await page.waitForFunction(() => Boolean(window.__hudTest));
  await page.evaluate(() => window.__hudTest.manual());
  const chain = page.locator('.sl-hud__chain');
  await expect(page.locator('.sl-hud')).toHaveAttribute('data-mode', 'off');
  await page.evaluate(() => window.__hudTest.advance(34));
  await expect(chain).toHaveAttribute('data-visible', 'false');
  // First smash: 500 points, a fresh two-second window.
  await page.evaluate(() => {
    const api = window.__hudTest;
    Object.assign(api.score, {
      total: 500,
      chainCount: 1,
      multiplier: 1,
      chainRemainingSeconds: 2,
      lastAward: 500,
      awardAgeSeconds: 0,
      awardSerial: 1,
    });
    api.advance(34);
  });
  await expect(chain).toHaveAttribute('data-visible', 'true');
  await expect(chain).toBeInViewport({ ratio: 1 });
  await expect(page.locator('[data-reading="chainMult"]')).toHaveText('×1');
  await expect(page.locator('[data-reading="chainAward"]')).toHaveText('+500');
  await expect(page.locator('[data-reading="chainTotal"]')).toHaveText('500');
  // Third hit in the window: on 3x with half a second left, the award faded.
  await page.evaluate(() => {
    const api = window.__hudTest;
    Object.assign(api.score, {
      total: 3300,
      chainCount: 3,
      multiplier: 3,
      chainRemainingSeconds: 0.5,
      lastAward: 1500,
      awardAgeSeconds: 1.5,
      awardSerial: 3,
    });
    api.advance(34);
  });
  await expect(page.locator('[data-reading="chainMult"]')).toHaveText('×3');
  await expect(page.locator('[data-reading="chainAward"]')).toBeHidden();
  await expect(page.locator('.sl-chain__track')).toHaveAttribute(
    'style',
    /--sl-chain-progress:\s*25%/,
  );
  await expect(chain).toHaveAttribute('data-max', 'false');
  // The window lapses: the model zeroes the chain; the readout lingers.
  await page.evaluate(() => {
    const api = window.__hudTest;
    Object.assign(api.score, {
      chainCount: 0,
      multiplier: 1,
      chainRemainingSeconds: 0,
      awardAgeSeconds: 2,
    });
    api.advance(34);
  });
  await expect(chain).toHaveAttribute('data-visible', 'true');
  await page.evaluate(() => window.__hudTest.advance(2900));
  await expect(chain).toHaveAttribute('data-visible', 'true');
  await page.evaluate(() => window.__hudTest.advance(100));
  await expect(chain).toHaveAttribute('data-visible', 'false');
});
