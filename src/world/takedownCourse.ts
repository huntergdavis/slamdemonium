import type { BreakablePlacement } from './breakableProps';
import type { MapDefinition } from './maps';
import {
  lanesAlong,
  poseAt,
  sampleRoad,
  shoulderPlacements,
  type RoadSegment,
} from './roadGenerator';
import { shuntWallAt } from './shuntWalls';
import type { TrafficCarRecord } from './traffic';

const DEG = Math.PI / 180;
const LONG = 2600;
const SHORT = 1300;
const CORNER = 420;
export const TAKEDOWN_ROAD_WIDTH = 28;
export const TAKEDOWN_PLAN: readonly RoadSegment[] = Object.freeze([
  { kind: 'straight', length: LONG - 2 * CORNER },
  { kind: 'arc', radius: CORNER, angle: 90 * DEG },
  { kind: 'straight', length: SHORT - 2 * CORNER },
  { kind: 'arc', radius: CORNER, angle: 90 * DEG },
  { kind: 'straight', length: LONG - 2 * CORNER },
  { kind: 'arc', radius: CORNER, angle: 90 * DEG },
  { kind: 'straight', length: SHORT - 2 * CORNER },
  { kind: 'arc', radius: CORNER, angle: 90 * DEG },
]);

/** A broad 7.1 km loop with 420 m sweepers. Four red rivals are encounter
 * records in the existing physics/visual traffic lifecycle; the rest of the
 * road has about one ordinary car every 140 m across both directions. */
export function createTakedownMap(): MapDefinition {
  const path = sampleRoad(TAKEDOWN_PLAN, {
    x: -SHORT / 2,
    z: -(LONG / 2 - CORNER),
    heading: Math.PI,
  });
  if (!path.closed)
    throw new RangeError(`Takedown road does not close: ${path.closureError}`);
  const at = (station: number) => poseAt(path, station);
  const spawn = at(0);
  const traffic: TrafficCarRecord[] = [
    {
      station: 45,
      laneSide: -1,
      direction: 1,
      speed: 35,
      rival: true,
      modelKind: 'sedan',
    },
    {
      station: path.length - 25,
      laneSide: 1,
      direction: 1,
      speed: 38,
      rival: true,
      modelKind: 'hatch',
    },
    {
      station: 90,
      laneSide: -1,
      direction: 1,
      speed: 41,
      rival: true,
      modelKind: 'pickup',
    },
    {
      station: path.length - 100,
      laneSide: 1,
      direction: 1,
      speed: 39,
      rival: true,
      modelKind: 'sedan',
    },
  ];
  for (let station = 620; station < path.length - 90; station += 280) {
    traffic.push({
      station,
      laneSide: 1,
      direction: 1,
      speed: 25 + (Math.round(station) % 6),
    });
    traffic.push({
      station: station + 140,
      laneSide: -1,
      direction: -1,
      speed: 22 + (Math.round(station / 7) % 6),
    });
  }
  const walls = (
    [
      [340, -1, 72],
      [450, 1, 76],
      [1180, 1, 90],
      [1510, -1, 70],
      [2850, -1, 80],
      [3640, 1, 86],
      [4950, 1, 70],
      [5700, -1, 78],
    ] as const
  ).map(([station, side, length]) =>
    shuntWallAt(path, station, side, length, TAKEDOWN_ROAD_WIDTH),
  );
  const placements: BreakablePlacement[] = shoulderPlacements(path, {
    density: 0.1,
    nearest: TAKEDOWN_ROAD_WIDTH / 2 + 4,
    farthest: TAKEDOWN_ROAD_WIDTH / 2 + 23,
    seed: 261,
  }).filter((prop) =>
    walls.every(
      (wall) =>
        Math.hypot(
          prop.position.x - wall.center.x,
          prop.position.z - wall.center.z,
        ) >
        wall.halfExtents.z + 8,
    ),
  );
  return {
    name: 'takedown',
    label: 'Takedown road (7 km)',
    track: {
      ringInnerRadius: 1390,
      centerLineRadius: 1450,
      pavedRadius: 1510,
      barrierInnerRadius: 1570,
      barrierSegments: 1200,
      groundExtent: 1800,
      skidpadRadii: [],
      fogDensity: 0.0008,
    },
    spawn: { x: spawn.x, z: spawn.z, heading: spawn.heading },
    ramps: [],
    loops: [],
    halfPipes: [],
    jumpRamps: [],
    runways: lanesAlong(path, TAKEDOWN_ROAD_WIDTH, 20).map((lane) => ({
      ...lane,
      laneStripes: [-7, 7],
    })),
    boostPads: [],
    path,
    route: path.samples
      .filter((_sample, index) => index % 12 === 0)
      .map((sample) => ({ x: sample.x, z: sample.z })),
    traffic,
    placements,
    shuntWalls: walls,
  };
}
