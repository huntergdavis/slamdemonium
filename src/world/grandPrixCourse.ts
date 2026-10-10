import { poseAt } from './roadGenerator';
import type { MapDefinition, MapName } from './maps';
import type { TrafficCarRecord } from './traffic';
import type { CarModelKind } from './carModels';

const GRID: readonly [number, number, CarModelKind][] = [
  [15, -3.7, 'sedan'],
  [15, 3.7, 'hatch'],
  [30, -3.7, 'pickup'],
  [30, 3.7, 'sedan'],
  [45, -3.7, 'hatch'],
];

/** Each heat reuses its venue's road and gates. Its five named race slots are
 * authored ahead of the player; light civilian traffic starts beyond the grid. */
export function createGrandPrixMap(
  venue: MapDefinition,
  name: Extract<MapName, `grand-prix-${string}`>,
): MapDefinition {
  if (!venue.path || !venue.runs?.[0])
    throw new Error('Grand Prix venue needs an authored road and run gates.');
  const path = venue.path;
  const base = path.closed ? path.length - 65 : 0;
  const grid = poseAt(path, base);
  const start = poseAt(path, 80);
  const run = venue.runs[0];
  const racers: TrafficCarRecord[] = GRID.map(
    ([ahead, laneOffset, modelKind]) => ({
      station: base + ahead,
      laneSide: laneOffset < 0 ? -1 : 1,
      laneOffset,
      direction: 1,
      speed: 50,
      rival: true,
      raceEntrant: true,
      modelKind,
    }),
  );
  const civilians = (venue.traffic ?? [])
    .filter((car) => car.direction === 1 && car.station > 350)
    .filter((_, index) => index % 5 === 0)
    .map((car) => ({ ...car, laneOffset: 8 }));
  return {
    ...venue,
    name,
    label: `Grand Prix · ${venue.label}`,
    spawn: { x: grid.x, z: grid.z, heading: grid.heading },
    runs: path.closed
      ? venue.runs
      : [
          {
            ...run,
            gates: [
              {
                ...run.gates[0]!,
                x: start.x,
                z: start.z,
                heading: start.heading,
              },
              ...run.gates.slice(1),
            ],
          },
        ],
    traffic: [...civilians, ...racers],
  };
}
