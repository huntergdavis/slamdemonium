import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { SHOTS, VIEWPORT } from './shotlist';
import type { Shot } from './shotlist';

const OUT_DIR = fileURLToPath(new URL('../docs/screenshots/', import.meta.url));
const EXAMPLES = fileURLToPath(
  new URL('../src/input/examples/', import.meta.url),
);

/** Resolve after `count` animation frames so the picture reflects the latest state. */
async function frames(page: Page, count: number): Promise<void> {
  await page.evaluate(
    (n) =>
      new Promise<void>((resolve) => {
        const tick = (left: number) =>
          left === 0 ? resolve() : requestAnimationFrame(() => tick(left - 1));
        tick(n);
      }),
    count,
  );
}

/**
 * Everything happens inside one synchronous evaluate so no animation frame can run
 * real-time physics between pausing, stepping and dressing the scene.
 */
async function runScenario(page: Page, shot: Shot): Promise<number> {
  const script =
    shot.scenario.kind === 'replay'
      ? await readFile(
          path.join(EXAMPLES, shot.scenario.script + '.json'),
          'utf8',
        )
      : null;
  return page.evaluate(
    ({ shot, script }) => {
      const g = window.__game;
      if (!g.perf)
        throw new Error(
          'window.__game.perf is required to pause the simulation.',
        );
      g.perf.pauseSimulation(true);
      g.releaseInput();
      g.scripts?.cancel();
      g.tuning.applyPreset(shot.preset);
      if (shot.scenario.kind === 'drive') {
        g.respawn();
        g.setInput({
          throttle: shot.scenario.input.throttle,
          brake: shot.scenario.input.brake ?? 0,
          steer: shot.scenario.input.steer,
          handbrake: shot.scenario.input.handbrake ?? false,
          boost: shot.scenario.input.boost ?? false,
        });
        g.stepMany(shot.scenario.steps);
        g.releaseInput();
      } else {
        if (!g.scripts)
          throw new Error(
            'window.__game.scripts is required for a replay shot.',
          );
        g.scripts.load(script, { tuning: 'apply' });
        g.perf.pauseSimulation(true); // load un-pauses; re-pause before any frame can run
        g.stepMany(shot.scenario.steps);
      }
      g.setCameraPreset(shot.camera); // resets the rig so the next frame snaps to the target
      g.setHudMode(shot.hud);
      g.setOptionsOpen(shot.optionsOpen);
      return Number(g.getTelemetry().speed);
    },
    { shot, script },
  );
}

test.describe.configure({ mode: 'serial' });
// Software WebGL renders the full track at a few frames per second; give each shot room.
test.setTimeout(240_000);

for (const shot of SHOTS) {
  test(`${shot.file} (${shot.preset}, ${shot.scenario.kind}, ${shot.camera}, hud ${shot.hud})`, async ({
    page,
  }) => {
    test.skip(
      shot.status === 'pending',
      `pending: needs ${shot.needs ?? 'a dependency that has not landed'}`,
    );
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });

    const viewport = shot.viewport ?? VIEWPORT;
    await page.setViewportSize(viewport);
    await page.goto('./');
    await page.waitForFunction(() => window.__game?.ready);
    const speed = await runScenario(page, shot);
    console.log(`${shot.file}: speed at capture ${speed.toFixed(2)} m/s`);

    const t0 = Date.now();
    await frames(page, 3); // camera snap, options transition, first HUD read
    console.log(`${shot.file}: 3 frames took ${Date.now() - t0} ms`);
    if (shot.hud !== 'off')
      await page.waitForFunction(
        () => /FPS/.test(document.querySelector('.sl-hud')?.textContent ?? ''),
        undefined,
        { timeout: 90_000, polling: 500 },
      );
    console.log(
      `${shot.file}: hud text: ${(await page.locator('.sl-hud').textContent())?.slice(0, 160)}`,
    );
    if (shot.optionsOpen) {
      await expect(page.locator('#sl-options')).toHaveAttribute(
        'data-open',
        'true',
      );
      for (const selector of shot.collapse ?? []) {
        await page.locator(selector).first().click();
        await frames(page, 1);
      }
      if (shot.scrollTo) {
        await page
          .locator(shot.scrollTo)
          .first()
          .evaluate((el) => el.scrollIntoView({ block: 'center' }));
        await frames(page, 2);
      }
    }
    await frames(page, 2);

    await mkdir(OUT_DIR, { recursive: true });
    const file = path.join(OUT_DIR, shot.file);
    await page.screenshot({
      path: file,
      animations: 'disabled',
      caret: 'hide',
      clip: { x: 0, y: 0, ...viewport },
    });
    expect(errors).toEqual([]);
    console.log(`wrote ${path.relative(process.cwd(), file)}`);
  });
}
