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
      length: 720,
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
        length: 720,
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
    // The first PR deliberately leaves both crossings empty. Physical
    // traffic and landmarks are separately drivable city increments.
  };
}
