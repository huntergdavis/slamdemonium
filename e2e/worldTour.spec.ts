import { expect, test } from '@playwright/test';
import { TourProgress, TOUR_PROGRESS_KEY } from '../src/core/tourProgress';
import { TOUR_EVENTS } from '../src/world/tourCatalogue';

test.setTimeout(120_000); // Software WebGL boot is slow on the shared CI host.

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
    await page.setViewportSize({ width: 640, height: 360 });
    await page.goto(`./?map=${event.routeId}&tour=${event.id}&car=sports`);
    await page.waitForFunction(() => window.__game?.ready);
    const terminal = await page.evaluate(
      ({ key, id }) => {
        const status = document.querySelector<HTMLElement>('.sl-tour-status');
        const boot = {
          phase: status?.dataset.phase,
          text: status?.textContent,
        };
        window.__game.perf?.pauseSimulation(true);
        if (!window.__game.finishTourForTest)
          throw new Error('World Tour terminal fixture missing.');
        window.__game.finishTourForTest();
        window.__game.stepMany(1);
        const saved = JSON.parse(localStorage.getItem(key) ?? 'null') as {
          results?: Record<string, { eventId: string; medal: string }>;
        } | null;
        return {
          boot,
          result: {
            phase: status?.dataset.phase,
            text: status?.textContent,
          },
          saved: Object.values(saved?.results ?? {}).find(
            (entry) => entry.eventId === id,
          ),
        };
      },
      { key: TOUR_PROGRESS_KEY, id: event.id },
    );
    expect(terminal.boot.phase).toBe('objective');
    expect(terminal.boot.text).toContain(event.title);
    expect(terminal.result.phase).toBe('result');
    expect(terminal.result.text).toContain(
      event.id === 'city-lap' ? 'BRONZE EARNED' : 'NO MEDAL',
    );
    expect(terminal.saved?.medal).toBe(
      event.id === 'city-lap' ? 'bronze' : 'none',
    );

    await page.keyboard.press('Enter');
    await page.waitForFunction(
      () =>
        window.__game?.ready &&
        document.querySelector<HTMLElement>('.sl-tour-status')?.dataset
          .phase === 'objective',
    );
    const retry = await page.evaluate(
      ({ key, id }) => {
        const saved = JSON.parse(localStorage.getItem(key) ?? 'null') as {
          results?: Record<string, { eventId: string; medal: string }>;
        } | null;
        return {
          status:
            document.querySelector<HTMLElement>('.sl-tour-status')?.textContent,
          saved: Object.values(saved?.results ?? {}).find(
            (entry) => entry.eventId === id,
          ),
          speed: Number(window.__game.getTelemetry().speed),
          roadRage: window.__game.getRoadRage?.(),
          crash: window.__game.getCrashMode?.(),
          race: window.__game.getRace?.(),
          grandPrix: window.__game.getGrandPrix?.(),
        };
      },
      { key: TOUR_PROGRESS_KEY, id: event.id },
    );
    expect(retry.status).toContain(event.title);
    expect(retry.saved?.medal).toBe(terminal.saved?.medal);
    expect(retry.speed).toBeLessThan(1);
    switch (event.format) {
      case 'road-rage':
        expect(retry.roadRage?.phase).toBe('countdown');
        expect(retry.roadRage?.count).toBe(0);
        break;
      case 'crash':
        expect(retry.crash?.phase).toBe('countdown');
        expect(retry.crash?.damage).toBe(0);
        break;
      case 'race':
      case 'face-off':
      case 'eliminator':
        expect(retry.race?.phase).toBe('countdown');
        break;
      case 'grand-prix':
        expect(retry.grandPrix?.phase).toBe('racing');
        expect(retry.grandPrix?.heat).toBe(0);
        expect(retry.grandPrix?.points).toEqual([0, 0, 0, 0, 0, 0]);
        break;
    }
    expect(errors).toEqual([]);
  });
}
