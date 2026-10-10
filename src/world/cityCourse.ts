import type { RunGateKind, RunGateSpec, RunRouteSpec } from '../core/timedRun';
import type { MapDefinition } from './maps';
import {
  lanesAlong,
  poseAt,
  sampleRoad,
  type RoadPath,
  type RoadSegment,
} from './roadGenerator';
import type { RunwaySpec } from './runways';
import type { TrafficCarRecord } from './traffic';
import type { CityBuildingSpec } from './cityBuildings';
import { shuntWallAt } from './shuntWalls';

const LONG = 1150;
const SHORT = 550;
const CORNER = 140;
const ARC = Math.PI / 2;
const LONG_STRAIGHT = LONG - 2 * CORNER;
const SHORT_STRAIGHT = SHORT - 2 * CORNER;
const ARC_LENGTH = CORNER * ARC;

export const CITY_ROAD_WIDTH = 24;
export const CITY_CROSS_STREET_WIDTH = 20;
export const CITY_INTERSECTIONS = Object.freeze([
  { x: -SHORT / 2, z: 0, reservedForCrash: false },
  { x: SHORT / 2, z: 0, reservedForCrash: true },
]);

const PLAN: readonly RoadSegment[] = [
  { kind: 'straight', length: LONG_STRAIGHT },
  { kind: 'arc', radius: CORNER, angle: ARC },
  { kind: 'straight', length: SHORT_STRAIGHT },
  { kind: 'arc', radius: CORNER, angle: ARC },
  { kind: 'straight', length: LONG_STRAIGHT },
  { kind: 'arc', radius: CORNER, angle: ARC },
  { kind: 'straight', length: SHORT_STRAIGHT },
  { kind: 'arc', radius: CORNER, angle: ARC },
];

/** Low corner blocks define the two cross-road openings at driving speed;
 * taller blocks further away give each straight a different skyline. */
export const CITY_BUILDINGS: readonly CityBuildingSpec[] = [
  ...[-430, -345, -170, -90, 0, 90, 170, 345, 430].flatMap((x, column) =>
    [-340, -250, -160, -80, 80, 160, 250, 340].map((z, row) => {
      const height = 12 + ((column * 13 + row * 7) % 8) * 5;
      return {
        center: { x, y: height / 2, z },
        size: {
          x: 26 + ((column + row) % 3) * 6,
          y: height,
          z: 30 + ((column * 2 + row) % 3) * 7,
        },
        color: [0x58646a, 0x6d777a, 0x45545d, 0x77817e][
          (column * 3 + row) % 4
        ]!,
      };
    }),
  ),
  ...CITY_INTERSECTIONS.flatMap((junction, index) =>
    ([-1, 1] as const).flatMap((xSide) =>
      ([-1, 1] as const).map((zSide) => {
        const height = index === 1 ? 34 : 22;
        return {
          center: {
            x: junction.x + xSide * 26,
            y: height / 2,
            z: zSide * 38,
          },
          size: { x: 18, y: height, z: 24 },
          color: index === 1 ? 0x81908d : 0x59666c,
        };
      }),
    ),
  ),
];

/** Crossing cars leave the visible city before wrapping to the other end. */
export const CITY_CROSS_PATH = sampleRoad(
  [{ kind: 'straight', length: 1500 }],
  { x: -750, z: 0, heading: -Math.PI / 2 },
);

function cityTraffic(road: RoadPath): TrafficCarRecord[] {
  const records: TrafficCarRecord[] = [];
  for (const direction of [1, -1] as const)
    for (const outer of [false, true]) {
      const laneSide = (direction === 1 ? -1 : 1) as -1 | 1;
      let station = 105 + (outer ? 11 : 0) + (direction < 0 ? 17 : 0);
      let car = 0;
      while (station < road.length - 100) {
        records.push({
          station,
          laneSide,
          laneOffset: outer ? laneSide * 4.5 : 0,
          direction,
          speed: 25 + ((car * 7 + (outer ? 3 : 0) + direction + 4) % 10),
        });
        station += 32 + ((car * 11 + (outer ? 5 : 0)) % 24);
        car++;
      }
    }
  for (const direction of [1, -1] as const) {
    const laneSide = (direction === 1 ? -1 : 1) as -1 | 1;
    for (
      let station = 110 + (direction < 0 ? 37 : 0), car = 0;
      station < CITY_CROSS_PATH.length - 100;
      station += 64 + ((car++ * 9) % 25)
    )
      records.push({
        path: CITY_CROSS_PATH,
        station,
        laneSide,
        direction,
        speed: 20 + ((car * 5 + (direction < 0 ? 3 : 0)) % 8),
      });
  }
  return records;
}

/** The same world geometry and start point, traversed toward the other end. */
function reversed(path: RoadPath): RoadPath {
  return {
    ...path,
    samples: Array.from(path.samples)
      .reverse()
      .map((sample) => ({
        x: sample.x,
        z: sample.z,
        heading: sample.heading + Math.PI,
        s: path.length - sample.s,
      })),
  };
}

function gate(path: RoadPath, station: number, kind: RunGateKind): RunGateSpec {
  const pose = poseAt(path, station);
  return {
    kind,
    x: pose.x,
    z: pose.z,
    heading: pose.heading,
    width: CITY_ROAD_WIDTH,
    length: 6,
  };
}

/** Paint the cross street through both junctions so its perpendicular lanes
 * read as a road, not a dark patch. No curb divides either route. */
function crossStreetPaint(): RunwaySpec[] {
  return [
    {
      x: 0,
      z: 0,
      heading: Math.PI / 2,
      length: CITY_CROSS_PATH.length,
      width: CITY_CROSS_STREET_WIDTH,
      laneStripes: [-4, 4],
      markerMeters: 0,
    },
  ];
}

/** Painted warning bars on each approach, still part of the one runway draw. */
function intersectionApproachPaint(): RunwaySpec[] {
  return CITY_INTERSECTIONS.flatMap((junction) =>
    [-1, 1].map((side) => ({
      x: junction.x,
      z: side * 48,
      heading: 0,
      length: 100,
      width: CITY_ROAD_WIDTH,
      markerMeters: 20,
    })),
  );
}

export function createCityMap(reverse = false): MapDefinition {
  const forward = sampleRoad(PLAN, {
    x: -SHORT / 2,
    z: -(LONG / 2 - CORNER),
    heading: Math.PI,
  });
  if (!forward.closed)
    throw new RangeError(`City road does not close: ${forward.closureError}`);
  const path = reverse ? reversed(forward) : forward;
  const crashStation = LONG_STRAIGHT * 1.5 + 2 * ARC_LENGTH + SHORT_STRAIGHT;
  const crashWalls = ([-110, -70, 70, 110] as const).flatMap((delta) =>
    ([-1, 1] as const).map((side) =>
      shuntWallAt(forward, crashStation + delta, side, 28, CITY_ROAD_WIDTH),
    ),
  );
  const arterialDeck = lanesAlong(forward, CITY_ROAD_WIDTH, 20);
  const arterialPaint = arterialDeck
    .filter(
      (lane) =>
        !CITY_INTERSECTIONS.some(
          (junction) =>
            Math.abs(lane.x - junction.x) < 20 &&
            Math.abs(lane.z - junction.z) < 22,
        ),
    )
    .map((lane) => ({ ...lane, laneStripes: [-4, 4] }));
  // Midpoints of the two junctions and the two short sides. The cross street
  // cannot skip either short side because its checkpoints remain in order.
  const forwardCheckpoints = [
    LONG_STRAIGHT / 2,
    LONG_STRAIGHT + ARC_LENGTH + SHORT_STRAIGHT / 2,
    LONG_STRAIGHT + 2 * ARC_LENGTH + SHORT_STRAIGHT + LONG_STRAIGHT / 2,
    2 * LONG_STRAIGHT + 3 * ARC_LENGTH + SHORT_STRAIGHT + SHORT_STRAIGHT / 2,
  ];
  const checkpoints = reverse
    ? forwardCheckpoints.map((station) => path.length - station).reverse()
    : forwardCheckpoints;
  const runs: RunRouteSpec[] = [
    {
      name: reverse ? 'City loop · reverse' : 'City loop',
      gates: [
        gate(path, 0, 'start'),
        ...checkpoints.map((station) => gate(path, station, 'checkpoint')),
        gate(path, path.length - 20, 'goal'),
      ],
    },
  ];
  const spawn = poseAt(path, path.length - 35);
  return {
    name: reverse ? 'city-reverse' : 'city',
    label: reverse ? 'City · reverse (3.2 km)' : 'City loop (3.2 km)',
    track: {
      ringInnerRadius: 780,
      centerLineRadius: 840,
      pavedRadius: 900,
      barrierInnerRadius: 1000,
      barrierSegments: 256,
      groundExtent: 1200,
      skidpadRadii: [],
      fogDensity: 0.00085,
    },
    spawn: { x: spawn.x, z: spawn.z, heading: spawn.heading },
    ramps: [],
    loops: [],
    halfPipes: [],
    jumpRamps: [],
    runways: [
      ...arterialPaint,
      ...crossStreetPaint(),
      ...intersectionApproachPaint(),
    ],
    // One dark instanced road deck over the existing single asphalt ground
    // collider. The crossing is 1.5 mm higher so its overlapping quads do
    // not flicker; neither height affects the physical surface.
    roadDecks: [
      // The extra length covers the outside edge where neighbouring tangent
      // quads fan apart on the 140 m corners. It has no physics footprint.
      ...arterialDeck.map((lane) => ({
        ...lane,
        length: lane.length + 2,
        height: 0.0015,
      })),
      {
        x: 0,
        z: 0,
        heading: Math.PI / 2,
        length: CITY_CROSS_PATH.length,
        width: CITY_CROSS_STREET_WIDTH,
        markerMeters: 0,
        height: 0.003,
      },
    ],
    boostPads: [],
    path,
    route: path.samples
      .filter((_sample, index) => index % 6 === 0)
      .map((sample) => ({ x: sample.x, z: sample.z })),
    runs,
    traffic: cityTraffic(path),
    cityBuildings: CITY_BUILDINGS,
    shuntWalls: crashWalls,
  };
}
