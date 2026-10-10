import type { MapDefinition, MapName } from './maps';
import {
  CITY_CROSS_PATH,
  CITY_INTERSECTIONS,
  createCityMap,
} from './cityCourse';
import type { TrafficCarRecord } from './traffic';

export type CrashApproach = 'south' | 'west';
export const CRASH_JUNCTION = CITY_INTERSECTIONS.find(
  (junction) => junction.reservedForCrash,
)!;
export const CRASH_TRAFFIC_SEED = 1701;

/** Four directions, three cars per stream. The gaps stage arrivals across
 * the whole 25–45 m/s player approach instead of one simultaneous wall. */
export function crashJunctionTraffic(
  cityPath: NonNullable<MapDefinition['path']>,
): readonly TrafficCarRecord[] {
  const crossingStation = CRASH_JUNCTION.x - CITY_CROSS_PATH.samples[0]!.x;
  const arterialStation =
    1.5 * (1150 - 2 * 140) + 2 * ((140 * Math.PI) / 2) + (550 - 2 * 140);
  const records: TrafficCarRecord[] = [];
  for (const [path, station] of [
    [CITY_CROSS_PATH, crossingStation],
    [cityPath, arterialStation],
  ] as const)
    for (const direction of [1, -1] as const)
      for (let index = 0; index < 3; index++) {
        const offset = 72 + index * 29 + (direction < 0 ? 11 : 0);
        records.push({
          path,
          station: station - direction * offset,
          laneSide: direction === 1 ? -1 : 1,
          direction,
          speed: 20 + ((index * 7 + (direction < 0 ? 3 : 0)) % 11),
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
    traffic: crashJunctionTraffic(city.path!),
    placements: [],
  };
}
