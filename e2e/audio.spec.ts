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

test.describe('unactivated controller audio', () => {
  // Keep automatic trace observers out of this activation-sensitive journey.
  // Native activation state and requests are attached explicitly below instead.
  test.use({ trace: 'off' });
  test('controller-only play visibly explains locked sound; only a real click or key unlocks decoded audio', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 320, height: 480 });
    const audioRequests: string[] = [];
    page.on('request', (request) => {
      if (/\.ogg(?:\?|$)|howlerOutput[^/]*\.js/.test(request.url()))
        audioRequests.push(request.url());
    });
    const decodedFiles = new Set<string>();
    page.on('response', (response) => {
      if (/\.ogg(?:\?|$)/.test(response.url()) && response.ok())
        decodedFiles.add(response.url());
    });
    // Playwright page.evaluate/waitForFunction set CDP userGesture:true. That
    // silently activates the page before asynchronous boot reads sticky activation.
    // Keep this entire pre-unlock journey genuinely unactivated, including polling.
    const cdp = await page.context().newCDPSession(page);
    const read = async <T>(fn: () => T | Promise<T>): Promise<T> => {
      const result = await cdp.send('Runtime.evaluate', {
        expression: '(' + fn.toString() + ')()',
        awaitPromise: true,
        returnByValue: true,
        userGesture: false,
      });
      if (result.exceptionDetails)
        throw new Error(result.exceptionDetails.text);
      return result.result.value as T;
    };
    await page.goto('./');
    const activationAfterNavigation = await read(
      () => navigator.userActivation.hasBeenActive,
    );
    await expect
      .poll(() => read(() => window.__game?.ready), { timeout: 30_000 })
      .toBe(true);
    const locked = await read(() => {
      const prompt = document.querySelector<HTMLElement>('.sl-audio-unlock')!;
      const rect = prompt.getBoundingClientRect();
      return {
        activated: navigator.userActivation.hasBeenActive,
        fixtureInstalled: Boolean(window.__inputFixture),
        visible: rect.width > 0 && rect.height > 0 && !prompt.hidden,
        text: prompt.textContent,
        status: (window.__game.getTelemetry().audio as AudioSnapshot).output
          .status,
        rms: window.__audioProbe?.rms() ?? 0,
      };
    });
    await testInfo.attach('native-activation-before-input.json', {
      body: JSON.stringify(
        { activationAfterNavigation, locked, audioRequests },
        null,
        2,
      ),
      contentType: 'application/json',
    });
    expect(activationAfterNavigation).toBe(false);
    expect(locked.activated).toBe(false);
    expect(locked.fixtureInstalled).toBe(true);
    expect(locked.visible).toBe(true);
    expect(locked.text).toContain('Enable sound');
    expect(locked.text).toContain('Click or press a key');
    expect(locked.status).toBe('locked');
    expect(locked.rms).toBe(0);
    await read(() => window.__controllerPad.hold([4]));
    const fit = await read(() => {
      const overlay = document.querySelector('.sl-controller-overlay')!;
      const prompt = overlay
        .querySelector('.sl-audio-unlock')!
        .getBoundingClientRect();
      const items = [
        ...overlay.querySelectorAll('.sl-controller-legend__item'),
      ].map((item) => item.getBoundingClientRect());
      return {
        promptTop: prompt.top,
        promptBottom: prompt.bottom,
        promptHeight: prompt.height,
        firstTop: Math.min(...items.map((item) => item.top)),
        lastBottom: Math.max(...items.map((item) => item.bottom)),
        count: items.length,
        height: innerHeight,
      };
    });
    expect(fit.count).toBe(8);
    expect(fit.promptHeight).toBeGreaterThan(0);
    expect(fit.promptTop).toBeGreaterThanOrEqual(0);
    expect(fit.promptBottom).toBeLessThanOrEqual(fit.firstTop);
    expect(fit.lastBottom).toBeLessThan(fit.height / 2);
    await read(() => window.__controllerPad.tap([9]));
    await read(() => window.__controllerPad.tap([1]));
    expect(
      await read(
        () =>
          (window.__game.getTelemetry().audio as AudioSnapshot).output.status,
      ),
    ).toBe('locked');
    const beforeDrive = await read(
      () => window.__game.getTelemetry().totalSteps as number,
    );
    await read(() => window.__controllerPad.hold([7]));
    await expect
      .poll(() => read(() => window.__game.getTelemetry().totalSteps))
      .toBeGreaterThan(beforeDrive + 10);
    await read(() => window.__controllerPad.hold([]));
    expect(await read(() => navigator.userActivation.hasBeenActive)).toBe(
      false,
    );
    expect(audioRequests).toEqual([]); // Async eager loading still steals boot bandwidth.
    await page.getByRole('button', { name: /Enable sound/ }).click();
    await expect
      .poll(async () => (await state(page)).output.status)
      .toBe('ready');
    await expect(page.locator('.sl-audio-unlock')).toBeHidden();
    await expect.poll(() => rms(page)).toBeGreaterThan(0.0001);
    expect(decodedFiles.size).toBe(7);
    expect((await state(page)).output.peakVoices).toBeLessThanOrEqual(16);
    await cdp.detach();
  });
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
  await page.getByRole('searchbox').fill('sfxVolume');
  await page.locator('#group-sfxVolume-range').focus();
  await page.keyboard.press('m'); // A slider is adjustable, not a text editor.
  await expect.poll(async () => (await state(page)).masterMuted).toBe(false);
  await page.keyboard.press('m');
  await expect.poll(async () => (await state(page)).masterMuted).toBe(true);
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
