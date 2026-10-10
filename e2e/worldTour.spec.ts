import { expect, test } from '@playwright/test';
import { TourProgress, TOUR_PROGRESS_KEY } from '../src/core/tourProgress';
import { TOUR_EVENTS } from '../src/world/tourCatalogue';

test.setTimeout(90_000);

for (const event of TOUR_EVENTS) {
  test(`${event.title} boots, records a result, and retries`, async ({
    page,
  }) => {
    const progress = new TourProgress(null);
    for (const prerequisite of TOUR_EVENTS) {
      if (prerequisite.id === event.id) break;
      progress.record(
        {
          eventId: prerequisite.id,
          routeId: prerequisite.routeId,
          carId: 'sports',
          tuningFingerprint: 'e2e-prerequisite',
          rulesVersion: 1,
          medal: 'bronze',
          score: 1,
        },
        prerequisite.rewardId ? [prerequisite.rewardId] : [],
      );
    }
    const saved = JSON.stringify(progress.snapshot());
    await page.addInitScript(
      ({ key, value }) => {
        if (!localStorage.getItem(key)) localStorage.setItem(key, value);
      },
      { key: TOUR_PROGRESS_KEY, value: saved },
    );
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`./?map=${event.routeId}&tour=${event.id}&car=sports`);
    await page.waitForFunction(() => window.__game?.ready);
    const status = page.locator('.sl-tour-status');
    await expect(status).toHaveAttribute('data-phase', 'objective');
    await expect(status).toContainText(event.title);

    await page.evaluate(() => {
      window.__game.perf?.pauseSimulation(true);
      if (!window.__game.finishTourForTest)
        throw new Error('World Tour terminal fixture missing.');
      window.__game.finishTourForTest();
      window.__game.stepMany(1);
    });
    await expect(status).toHaveAttribute('data-phase', 'result');
    await expect(status).toContainText(
      event.id === 'city-lap' ? 'BRONZE EARNED' : 'NO MEDAL',
    );
    const result = await page.evaluate(
      ({ key, id }) => {
        const saved = JSON.parse(localStorage.getItem(key) ?? 'null') as {
          results?: Record<string, { eventId: string; medal: string }>;
        } | null;
        return Object.values(saved?.results ?? {}).find(
          (entry) => entry.eventId === id,
        );
      },
      { key: TOUR_PROGRESS_KEY, id: event.id },
    );
    expect(result?.medal).toBe(event.id === 'city-lap' ? 'bronze' : 'none');

    await page.keyboard.press('Enter');
    await expect(status).toHaveAttribute('data-phase', 'objective');
    expect(errors).toEqual([]);
  });
}
