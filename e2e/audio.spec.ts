import { expect, test, type Page } from '@playwright/test';
import { installController, tap } from './controllerPad';
import { installAudioProbe } from './audioProbe';

test.use({
  launchOptions: {
    args: [
      '--enable-unsafe-swiftshader',
      '--autoplay-policy=user-gesture-required',
    ],
  },
});
interface AudioSnapshot {
  status: string;
  masterMuted: boolean;
  paused: boolean;
  output: {
    status: string;
    activeVoices: number;
    peakVoices: number;
    error: string | null;
  };
}
async function state(page: Page): Promise<AudioSnapshot> {
  return page.evaluate(
    () => window.__game.getTelemetry().audio as AudioSnapshot,
  );
}
async function rms(page: Page): Promise<number> {
  return page.evaluate(() => window.__audioProbe?.rms() ?? 0);
}
test.beforeEach(async ({ page }) => {
  await installController(page);
  await installAudioProbe(page);
});

test('controller-only play visibly explains locked sound; only a real click or key unlocks decoded audio', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 480 });
  const decodedFiles = new Set<string>();
  page.on('response', (response) => {
    if (/\.ogg(?:\?|$)/.test(response.url()) && response.ok())
      decodedFiles.add(response.url());
  });
  await page.goto('./');
  await page.waitForFunction(() => window.__game?.ready);
  const prompt = page.locator('.sl-audio-unlock');
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText('Enable sound');
  await expect(prompt).toContainText('Click or press a key');
  await expect
    .poll(async () => (await state(page)).output.status)
    .toBe('locked');
  expect(await rms(page)).toBe(0);
  await page.evaluate(() => window.__controllerPad.hold([4]));
  await expect(prompt).toBeVisible();
  await expect(page.locator('.sl-controller-legend__item')).toHaveCount(8);
  const fit = await page
    .locator('.sl-controller-overlay')
    .evaluate((overlay) => {
      const prompt = overlay
        .querySelector('.sl-audio-unlock')!
        .getBoundingClientRect();
      const items = [
        ...overlay.querySelectorAll('.sl-controller-legend__item'),
      ].map((item) => item.getBoundingClientRect());
      return {
        promptTop: prompt.top,
        promptBottom: prompt.bottom,
        firstTop: Math.min(...items.map((item) => item.top)),
        lastBottom: Math.max(...items.map((item) => item.bottom)),
        height: innerHeight,
      };
    });
  expect(fit.promptTop).toBeGreaterThanOrEqual(0);
  expect(fit.promptBottom).toBeLessThanOrEqual(fit.firstTop);
  expect(fit.lastBottom).toBeLessThan(fit.height / 2);
  await tap(page, [9]);
  await tap(page, [1]); // Opening/selecting menu via pad is not activation.
  expect((await state(page)).output.status).toBe('locked');
  await page.getByRole('button', { name: /Enable sound/ }).click();
  await expect
    .poll(async () => (await state(page)).output.status)
    .toBe('ready');
  await expect(prompt).toBeHidden();
  await expect.poll(() => rms(page)).toBeGreaterThan(0.0001);
  expect(decodedFiles.size).toBe(7);
  expect((await state(page)).output.peakVoices).toBeLessThanOrEqual(16);
});

test('pause fades real output to silence, resumes continuous sound, and zero SFX volume stays silent', async ({
  page,
}) => {
  await page.goto('./');
  await page.waitForFunction(() => window.__game?.ready);
  await page.keyboard.press('h'); // Genuine gesture, keeping driving focus.
  await expect
    .poll(async () => (await state(page)).output.status)
    .toBe('ready');
  await expect.poll(() => rms(page)).toBeGreaterThan(0.0001);
  await page.keyboard.press('p');
  await expect.poll(async () => (await state(page)).paused).toBe(true);
  const pausedStep = await page.evaluate(
    () => window.__game.getTelemetry().totalSteps,
  );
  await expect.poll(() => rms(page)).toBeLessThan(0.000001);
  expect(
    await page.evaluate(() => window.__game.getTelemetry().totalSteps),
  ).toBe(pausedStep);
  await page.keyboard.press('p');
  await expect.poll(() => rms(page)).toBeGreaterThan(0.0001);
  await page.evaluate(() => window.__game.tuning.set('sfxVolume', 0));
  await expect.poll(() => rms(page)).toBeLessThan(0.000001);
  expect((await state(page)).masterMuted).toBe(false);
  await page.evaluate(() => window.__game.tuning.set('sfxVolume', 0.35));
  await expect.poll(() => rms(page)).toBeGreaterThan(0.0001);
  await page.keyboard.press('m');
  await expect.poll(async () => (await state(page)).masterMuted).toBe(true);
  await expect.poll(() => rms(page)).toBeLessThan(0.000001);
  expect(await page.evaluate(() => window.__game.tuning.get('sfxVolume'))).toBe(
    0.35,
  );
  await page.evaluate(() => window.__game.tuning.applyPreset('Default'));
  expect((await state(page)).masterMuted).toBe(true);
  await expect.poll(() => rms(page)).toBeLessThan(0.000001);
  await page.keyboard.press('m');
  await expect.poll(() => rms(page)).toBeGreaterThan(0.0001);
});

test('master mute works by pad inside the pause menu, persists separately, and M never interrupts text entry', async ({
  page,
}) => {
  await page.goto('./');
  await page.waitForFunction(() => window.__game?.ready);
  await tap(page, [9]);
  const mute = page.getByRole('button', {
    name: 'Mute all audio',
    exact: true,
  });
  await expect(mute).toBeVisible();
  await tap(page, [4, 5]);
  await expect(
    page.getByRole('button', { name: 'Unmute audio', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await tap(page, [4, 5]);
  await expect(mute).toHaveAttribute('aria-pressed', 'false');
  // Resume, Restart, Options, Mute: the ordinary pad focus path reaches mute.
  await tap(page, [13]);
  await tap(page, [13]);
  await tap(page, [13]);
  await tap(page, [0]);
  await expect.poll(async () => (await state(page)).masterMuted).toBe(true);
  await page.reload();
  await page.waitForFunction(() => window.__game?.ready);
  expect((await state(page)).masterMuted).toBe(true);
  await tap(page, [8]);
  await tap(page, [3]);
  await expect(page.getByRole('searchbox')).toBeFocused();
  await page.keyboard.press('m');
  await expect(page.getByRole('searchbox')).toHaveValue('m');
  expect((await state(page)).masterMuted).toBe(true);
  await tap(page, [0]);
  await expect(page.locator('.sl-controller-keyboard')).toBeVisible();
  await page.keyboard.press('m'); // Text-entry grid buttons also count as editing.
  expect((await state(page)).masterMuted).toBe(true);
  await tap(page, [1]);
  await tap(page, [1]);
  await tap(page, [9]);
  await page.keyboard.press('m'); // Ordinary menu button, outside text editing.
  await expect.poll(async () => (await state(page)).masterMuted).toBe(false);
});

test('sound credits are reachable through controller Controls and link both creator and full library notices', async ({
  page,
}) => {
  await page.goto('./');
  await page.waitForFunction(() => window.__game?.ready);
  await tap(page, [9]);
  await tap(page, [12]);
  await tap(page, [0]);
  const credits = page.getByRole('region', { name: 'Sound credits' });
  await expect(credits).toContainText('Tom Haigh');
  await expect(credits).toContainText('qubodup');
  await expect(credits).toContainText('mono 48 kHz');
  await expect(
    credits.getByRole('link', { name: 'CC BY 3.0', exact: true }),
  ).toHaveAttribute('href', 'https://creativecommons.org/licenses/by/3.0/');
  await page.evaluate(async () => {
    const section = document.querySelector('[aria-label="Sound credits"]')!;
    const last = section.querySelector('p:last-child')!;
    for (
      let i = 0;
      i < 80 && last.getBoundingClientRect().bottom > innerHeight;
      i++
    )
      await window.__controllerPad.tap([13]);
    if (last.getBoundingClientRect().bottom > innerHeight)
      throw new Error('Controller could not scroll to the final sound credit');
  });
  const notice = credits.getByRole('link', {
    name: 'MIT licence and full notice',
  });
  const response = await page.request.get((await notice.getAttribute('href'))!);
  expect(response.ok()).toBe(true);
  expect(await response.text()).toContain('Permission is hereby granted');
  const kenney = credits.getByRole('link', {
    name: 'Full Kenney licence notice',
  });
  expect(
    (await page.request.get((await kenney.getAttribute('href'))!)).ok(),
  ).toBe(true);
});

test('visibility pause silences the native audio clock even when RAF and JavaScript timers stop', async ({
  page,
}) => {
  await page.goto('./');
  await page.waitForFunction(() => window.__game?.ready);
  await page.keyboard.press('h');
  await expect.poll(() => rms(page)).toBeGreaterThan(0.0001);
  const epoch = new Date('2026-09-21T00:00:00Z');
  await page.clock.install({ time: epoch });
  await page.clock.pauseAt(new Date(epoch.getTime() + 1000));
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect((await state(page)).paused).toBe(true);
  // Playwright freezes RAF/timers, not AudioContext.currentTime. Only the
  // visibility handler can have scheduled this native 30ms gain ramp.
  await expect.poll(() => rms(page)).toBeLessThan(0.000001);
});
