import type { MapDefinition, MapName } from './maps';
import {
  CITY_CROSS_PATH,
  CITY_INTERSECTIONS,
  createCityMap,
} from './cityCourse';
import type { TrafficCarRecord } from './traffic';
import type { BreakablePlacement } from './breakableProps';

export type CrashApproach = 'south' | 'west';
export const CRASH_JUNCTION = CITY_INTERSECTIONS.find(
  (junction) => junction.reservedForCrash,
)!;
export const CRASH_TRAFFIC_SEED = 1701;
const PROP_ROTATION = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });
export const CRASH_JUNCTION_PROPS: readonly BreakablePlacement[] = [
  {
    position: { x: CRASH_JUNCTION.x - 15, y: 0.5, z: -18 },
    rotation: PROP_ROTATION,
  },
  {
    position: { x: CRASH_JUNCTION.x + 15, y: 0.5, z: -18 },
    rotation: PROP_ROTATION,
  },
  {
    position: { x: CRASH_JUNCTION.x - 15, y: 0.5, z: 18 },
    rotation: PROP_ROTATION,
  },
  {
    position: { x: CRASH_JUNCTION.x + 15, y: 0.5, z: 18 },
    rotation: PROP_ROTATION,
  },
];

/** Four directions, three cars per stream. First arrivals are staggered
 * beyond the three-second countdown; later cars keep crossing after impact. */
export function crashJunctionTraffic(
  cityPath: NonNullable<MapDefinition['path']>,
  approach: CrashApproach,
): readonly TrafficCarRecord[] {
  const crossingStation = CRASH_JUNCTION.x - CITY_CROSS_PATH.samples[0]!.x;
  const arterialStation =
    1.5 * (1150 - 2 * 140) + 2 * ((140 * Math.PI) / 2) + (550 - 2 * 140);
  const records: TrafficCarRecord[] = [];
  // The first wave crosses the player's launch line. Perpendicular cars wait
  // until after that impact window; otherwise they wreck one another before
  // the player can reach the junction.
  for (const [path, station, firstWave] of [
    [CITY_CROSS_PATH, crossingStation, approach === 'south'],
    [cityPath, arterialStation, approach === 'west'],
  ] as const)
    for (const direction of [1, -1] as const)
      for (let index = 0; index < 3; index++) {
        const offset =
          (firstWave ? 240 : 390) + (direction === 1 ? 0 : 20) + index * 42;
        records.push({
          path,
          station: station - direction * offset,
          laneSide: direction === 1 ? -1 : 1,
          direction,
          speed: 26 - index,
          modelKind: (['sedan', 'van', 'boxTruck'] as const)[index]!,
        });
      }
  return records;
}

/** Both starts are 180 m from the same east junction. The base city's road,
 * colliders, corner buildings and eight shunt walls remain unchanged. */
export function createCrashJunctionMap(approach: CrashApproach): MapDefinition {
  const city = createCityMap();
  return {
    ...city,
    name: `crash-${approach}` satisfies MapName,
    label:
      approach === 'south'
        ? 'Crash Junction · south launch'
        : 'Crash Junction · west launch',
    spawn:
      approach === 'south'
        ? { x: CRASH_JUNCTION.x + 5, z: -180, heading: Math.PI }
        : { x: CRASH_JUNCTION.x - 180, z: -5, heading: -Math.PI / 2 },
    runs: [],
    traffic: crashJunctionTraffic(city.path!, approach),
    placements: CRASH_JUNCTION_PROPS,
  };
}
