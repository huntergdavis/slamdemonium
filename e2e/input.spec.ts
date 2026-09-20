import { expect, test } from '@playwright/test';
import type { StepInput } from '../src/input/types';

declare global {
  interface Window {
    __inputFixture: {
      sample(): Readonly<StepInput>;
      presented(timestamp: number): void;
      paintProbe(timestamp: number): void;
      dispose(): void;
    };
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__game?.ready);
  await page.evaluate(async () => {
    const keyboardPath = '/src/input/keyboard.ts';
    const gamepadPath = '/src/input/gamepad.ts';
    const mapperPath = '/src/input/mapper.ts';
    const probePath = '/src/input/latencyProbe.ts';
    const { KeyboardInput } = (await import(
      keyboardPath
    )) as typeof import('../src/input/keyboard');
    const { GamepadInput } = (await import(
      gamepadPath
    )) as typeof import('../src/input/gamepad');
    const { InputMapper } = (await import(
      mapperPath
    )) as typeof import('../src/input/mapper');
    const { LatencyProbeView } = (await import(
      probePath
    )) as typeof import('../src/input/latencyProbe');
    const keyboard = new KeyboardInput(window);
    const input = new InputMapper(keyboard, new GamepadInput(() => []));
    const probeView = new LatencyProbeView(input.latency, document.body);
    const canvas = document.querySelector('canvas');
    if (!canvas) throw new Error('Missing driving surface.');
    canvas.tabIndex = 0;
    const panel = document.createElement('div');
    panel.setAttribute('data-options-panel', '');
    panel.style.cssText =
      'position:fixed;right:0;top:0;background:white;z-index:10;';
    panel.innerHTML =
      '<input id="test-number" type="number" aria-label="Test parameter"><button id="test-a">A</button><button id="test-b">B</button><input id="test-range" type="range" aria-label="Test slider">';
    document.body.append(panel);
    window.__inputFixture = {
      sample: () => input.sampleForStep(),
      presented: (timestamp) => input.framePresented(timestamp),
      paintProbe: (timestamp) => probeView.render(timestamp),
      dispose: () => {
        keyboard.dispose();
        probeView.dispose();
        panel.remove();
      },
    };
    canvas.focus();
  });
});

test.afterEach(async ({ page }) => {
  await page.evaluate(() => window.__inputFixture?.dispose());
});

test('game Tab swaps A/B without moving focus; Options Tab navigates normally', async ({
  page,
}) => {
  const canvas = page.getByLabel('Driving view');
  await page.keyboard.press('Tab');
  await expect(canvas).toBeFocused();
  expect(
    await page.evaluate(() => window.__inputFixture.sample().actions.swapAB),
  ).toBe(1);
  await page.locator('#test-a').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('#test-b')).toBeFocused();
  expect(
    await page.evaluate(() => window.__inputFixture.sample().actions.swapAB),
  ).toBe(0);
  await page.locator('#test-b').evaluate((button) => {
    button.addEventListener('click', () => {
      button.setAttribute('data-clicked', 'true');
    });
  });
  await page.keyboard.down('Space');
  expect(
    await page.evaluate(() => window.__inputFixture.sample().handbrake),
  ).toBe(false);
  await page.keyboard.up('Space');
  await expect(page.locator('#test-b')).toHaveAttribute('data-clicked', 'true');
});

test('editing clears throttle and native slider keyboard interaction does not steer', async ({
  page,
}) => {
  await page.keyboard.down('w');
  expect(
    await page.evaluate(() => window.__inputFixture.sample().throttle),
  ).toBe(1);
  await page.getByLabel('Test parameter').focus();
  expect(
    await page.evaluate(() => window.__inputFixture.sample().throttle),
  ).toBe(0);
  await page.keyboard.up('w');
  await page.keyboard.type('42');
  await expect(page.getByLabel('Test parameter')).toHaveValue('42');
  await page.getByLabel('Test slider').focus();
  await page.keyboard.down('ArrowLeft');
  expect(await page.evaluate(() => window.__inputFixture.sample().steer)).toBe(
    0,
  );
  await page.keyboard.up('ArrowLeft');
  await page.getByLabel('Driving view').focus();
  await page.keyboard.down('ArrowLeft');
  expect(await page.evaluate(() => window.__inputFixture.sample().steer)).toBe(
    1,
  );
  await page.keyboard.up('ArrowLeft');
});

test('L records a sampled input-to-frame delta and reveals both flash indicators', async ({
  page,
}) => {
  await page.keyboard.press('l');
  await page.evaluate(async () => {
    window.__inputFixture.sample();
    for (let frame = 0; frame < 2; frame++) {
      await new Promise<void>((resolve) =>
        requestAnimationFrame((timestamp) => {
          window.__inputFixture.presented(timestamp);
          window.__inputFixture.paintProbe(timestamp);
          resolve();
        }),
      );
    }
  });
  const probe = page.getByLabel('Input latency probe');
  await expect(probe).toBeVisible();
  await expect(probe).toContainText('EVENT');
  await expect(probe).toContainText('FRAME');
  await expect(probe).toContainText('1/100 samples');
  await expect(probe).toContainText('rAF proxy:');
});
