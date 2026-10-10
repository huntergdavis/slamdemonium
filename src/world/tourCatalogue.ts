import type { TourMedal, TourProgress } from '../core/tourProgress';

export type TourFormat =
  | 'burning-lap'
  | 'road-rage'
  | 'crash'
  | 'race'
  | 'face-off'
  | 'eliminator'
  | 'grand-prix';

export type TourCarId =
  | 'compact'
  | 'muscle'
  | 'coupe'
  | 'sports'
  | 'super'
  | 'pickup'
  | 'suv'
  | 'bus';

export interface TourEvent {
  readonly id: string;
  readonly title: string;
  readonly venue: string;
  readonly routeId: string;
  readonly format: TourFormat;
  readonly objective: string;
  readonly medalTarget: string;
  readonly eligibleCars: readonly TourCarId[];
  readonly prerequisite?: string;
  /** Awarded once for any medal; permanent despite later tuning changes. */
  readonly rewardId?: string;
}

const RACE_CARS: readonly TourCarId[] = [
  'compact',
  'muscle',
  'coupe',
  'sports',
  'super',
];
const CRASH_CARS: readonly TourCarId[] = [...RACE_CARS, 'pickup', 'suv', 'bus'];

/** Seven distinct, playable format contracts. Add the other eleven cards
 * after this sequence has been driven and judged as a tour. */
export const TOUR_EVENTS: readonly TourEvent[] = [
  {
    id: 'city-lap',
    title: 'City Sprint',
    venue: 'City',
    routeId: 'city',
    format: 'burning-lap',
    objective: 'Cross both gates and beat the city clock.',
    medalTarget: 'Finish the timed run',
    eligibleCars: RACE_CARS,
    rewardId: 'event:road-rage',
  },
  {
    id: 'road-rage',
    title: 'Road Rage',
    venue: 'Takedown course',
    routeId: 'road-rage',
    format: 'road-rage',
    objective: 'Take down rivals before the clock expires.',
    medalTarget: '3 takedowns for bronze',
    eligibleCars: RACE_CARS,
    prerequisite: 'event:road-rage',
    rewardId: 'event:crash-south',
  },
  {
    id: 'crash-south',
    title: 'Crash Junction',
    venue: 'South approach',
    routeId: 'crash-south',
    format: 'crash',
    objective: 'Start a chain through the crossing traffic.',
    medalTarget: 'Bronze damage score',
    eligibleCars: CRASH_CARS,
    prerequisite: 'event:crash-south',
    rewardId: 'event:circuit-race',
  },
  {
    id: 'circuit-race',
    title: 'Circuit Race',
    venue: 'Circuit',
    routeId: 'circuit-race',
    format: 'race',
    objective: 'Beat the five-rival field to the finish.',
    medalTarget: 'Podium finish',
    eligibleCars: RACE_CARS,
    prerequisite: 'event:circuit-race',
    rewardId: 'event:face-off',
  },
  {
    id: 'face-off',
    title: 'Face Off',
    venue: 'Circuit',
    routeId: 'face-off',
    format: 'face-off',
    objective: 'Race Vesper one on one.',
    medalTarget: 'Beat Vesper',
    eligibleCars: RACE_CARS,
    prerequisite: 'event:face-off',
    rewardId: 'event:eliminator',
  },
  {
    id: 'eliminator',
    title: 'Highway Eliminator',
    venue: 'Highway',
    routeId: 'highway-eliminator',
    format: 'eliminator',
    objective: 'Stay off the bottom after each lap.',
    medalTarget: 'Survive two cuts',
    eligibleCars: RACE_CARS,
    prerequisite: 'event:eliminator',
    rewardId: 'event:grand-prix',
  },
  {
    id: 'grand-prix',
    title: 'Three-Venue Grand Prix',
    venue: 'City · Coast · Highway',
    routeId: 'grand-prix-city',
    format: 'grand-prix',
    objective: 'Carry points through three separate heats.',
    medalTarget: 'Top three overall',
    eligibleCars: RACE_CARS,
    prerequisite: 'event:grand-prix',
  },
];

export function tourEventById(id: string): TourEvent | undefined {
  return TOUR_EVENTS.find((event) => event.id === id);
}

/** The route must exist on the current build as well as be earned. */
export function tourEventAvailable(
  event: TourEvent,
  progress: TourProgress,
  availableRoutes: ReadonlySet<string>,
  carId: string,
): boolean {
  return (
    availableRoutes.has(event.routeId) &&
    event.eligibleCars.some((id) => id === carId) &&
    (!event.prerequisite || progress.hasReward(event.prerequisite))
  );
}

export function tourRewardFor(
  event: TourEvent,
  medal: TourMedal,
): readonly string[] {
  if (medal === 'none') return [];
  const rewards = event.rewardId ? [event.rewardId] : [];
  if (event.id === 'grand-prix' && medal === 'gold')
    rewards.push('car:grand-prix-special');
  return rewards;
}
