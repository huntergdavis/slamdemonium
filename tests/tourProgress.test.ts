import { describe, expect, it } from 'vitest';
import {
  TOUR_PROGRESS_KEY,
  TourProgress,
  tourResultKey,
  type TourResult,
} from '../src/core/tourProgress';
import {
  TOUR_EVENTS,
  tourEventAvailable,
  tourRewardFor,
} from '../src/world/tourCatalogue';
import { resolveTourEvent, tourUrl } from '../src/world/mapChoice';

class MemoryStorage {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}

function result(overrides: Partial<TourResult> = {}): TourResult {
  return {
    eventId: 'city-lap',
    routeId: 'city',
    carId: 'sports',
    tuningFingerprint: 'stock-v1',
    rulesVersion: 1,
    medal: 'bronze',
    score: 105,
    ...overrides,
  };
}

describe('World Tour progress', () => {
  it('awards once, survives reload, and never loses a medal or reward on a worse replay', () => {
    const storage = new MemoryStorage();
    const progress = new TourProgress(storage);
    expect(progress.record(result(), ['event:road-rage'])).toBe(true);
    expect(progress.record(result({ medal: 'none', score: 0 }))).toBe(false);
    for (let retry = 0; retry < 10; retry++)
      expect(progress.record(result(), ['event:road-rage'])).toBe(false);
    const reloaded = new TourProgress(storage);
    expect(reloaded.bestMedal('city-lap')).toBe('bronze');
    expect(reloaded.hasReward('event:road-rage')).toBe(true);
    expect(reloaded.snapshot().rewards).toEqual(['event:road-rage']);
    expect(reloaded.record(result({ medal: 'silver', score: 120 }))).toBe(true);
    expect(new TourProgress(storage).bestMedal('city-lap')).toBe('silver');
  });

  it('separates car, tuning and rules results but preserves a stable earned reward', () => {
    const progress = new TourProgress(null);
    const sports = result();
    const compact = result({ carId: 'compact', score: 90 });
    const retuned = result({ tuningFingerprint: 'stock-v2', score: 95 });
    const newRules = result({ rulesVersion: 2, score: 100 });
    expect(
      new Set([sports, compact, retuned, newRules].map(tourResultKey)).size,
    ).toBe(4);
    expect(progress.record(sports, ['event:road-rage'])).toBe(true);
    expect(progress.record(compact)).toBe(true);
    expect(progress.record(retuned)).toBe(true);
    expect(progress.record(newRules)).toBe(true);
    expect(Object.keys(progress.snapshot().results)).toHaveLength(4);
    expect(progress.hasReward('event:road-rage')).toBe(true);
  });

  it('rejects malformed or incompatible storage without boot failure', () => {
    const storage = new MemoryStorage();
    storage.setItem(TOUR_PROGRESS_KEY, '{broken');
    expect(new TourProgress(storage).snapshot().results).toEqual({});
    storage.setItem(
      TOUR_PROGRESS_KEY,
      JSON.stringify({
        version: 2,
        results: {},
        rewards: ['event:grand-prix'],
      }),
    );
    expect(new TourProgress(storage).hasReward('event:grand-prix')).toBe(false);
    storage.setItem(
      TOUR_PROGRESS_KEY,
      JSON.stringify({
        version: 1,
        results: { forged: result() },
        rewards: ['event:grand-prix'],
      }),
    );
    expect(new TourProgress(storage).hasReward('event:grand-prix')).toBe(false);
  });

  it('keeps session progress when storage is blocked', () => {
    const blocked = {
      getItem(): string | null {
        throw new Error('blocked');
      },
      setItem(): void {
        throw new Error('blocked');
      },
    };
    const progress = new TourProgress(blocked);
    expect(progress.record(result(), ['event:road-rage'])).toBe(true);
    expect(progress.hasReward('event:road-rage')).toBe(true);
  });

  it('locks deep links until the named prerequisite, car, and route are available', () => {
    const progress = new TourProgress(null);
    const routes = new Set(['city', 'road-rage']);
    const city = TOUR_EVENTS[0]!;
    const roadRage = TOUR_EVENTS[1]!;
    expect(tourEventAvailable(city, progress, routes, 'sports')).toBe(true);
    expect(tourEventAvailable(roadRage, progress, routes, 'sports')).toBe(
      false,
    );
    progress.record(result(), tourRewardFor(city, 'bronze'));
    expect(tourEventAvailable(roadRage, progress, routes, 'sports')).toBe(true);
    expect(tourEventAvailable(roadRage, progress, routes, 'bus')).toBe(false);
    expect(
      tourEventAvailable(TOUR_EVENTS[2]!, progress, routes, 'sports'),
    ).toBe(false);
    const pasted = tourUrl('/slamdemonium/', roadRage, 'sports');
    expect(
      resolveTourEvent(pasted.split('?')[1]!, progress, routes, 'sports')?.id,
    ).toBe('road-rage');
    expect(
      resolveTourEvent(
        '?map=city&tour=crash-south&car=sports',
        progress,
        routes,
        'sports',
      ),
    ).toBeUndefined();
  });

  it('has one initial card and all seven format contracts', () => {
    expect(TOUR_EVENTS.map((event) => event.format)).toEqual([
      'burning-lap',
      'road-rage',
      'crash',
      'race',
      'face-off',
      'eliminator',
      'grand-prix',
    ]);
    expect(TOUR_EVENTS.filter((event) => !event.prerequisite)).toHaveLength(1);
    expect(tourRewardFor(TOUR_EVENTS[6]!, 'gold')).toEqual([
      'car:grand-prix-special',
    ]);
  });
});
