import { expect, test } from '@playwright/test';
import { installController } from './controllerPad';
import {
  installAudioProbe,
  readAudioState as state,
  readAudioRms as rms,
  type AudioSnapshot,
} from './audioProbe';

// Tracing is OFF because Playwright 1.63 HAR title/timing collection calls the
// userGesture:true evaluator at DOMContentLoaded/load, activating an untouched
// page. Keep this test untraced and assert native hasBeenActive=false below.
// Native evidence replaces tracing here; other audio journeys retain traces.
test.use({
  trace: 'off',
  launchOptions: {
    args: [
      '--enable-unsafe-swiftshader',
      '--autoplay-policy=user-gesture-required',
    ],
  },
});
test.beforeEach(async ({ page }) => {
  await installController(page);
  await installAudioProbe(page);
});

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
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
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
      () => (window.__game.getTelemetry().audio as AudioSnapshot).output.status,
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
  expect(await read(() => navigator.userActivation.hasBeenActive)).toBe(false);
  expect(audioRequests).toEqual([]); // Async eager loading still steals boot bandwidth.
  await page.getByRole('button', { name: /Enable sound/ }).click();
  await expect
    .poll(async () => (await state(page)).output.status)
    .toBe('ready');
  await expect(page.locator('.sl-audio-unlock')).toBeHidden();
  await expect.poll(() => rms(page)).toBeGreaterThan(0.0001);
  expect(decodedFiles.size).toBe(6); // No engine sample: the engine is a worklet voice.
  expect((await state(page)).output.peakVoices).toBeLessThanOrEqual(15);
  await cdp.detach();
});
