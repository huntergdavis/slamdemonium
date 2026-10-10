import type { RunGateSpec, RunRouteSpec } from '../core/timedRun';
import type { MapDefinition } from './maps';
import {
  lanesAlong,
  poseAt,
  sampleRoad,
  type RoadPath,
  type RoadSegment,
} from './roadGenerator';
import type { TrafficCarRecord } from './traffic';

const ROAD_WIDTH = 28;
const CORNER_RADIUS = 210;
const STRAIGHT = 245;
const START = { x: -590, z: -430, heading: Math.PI };
/** Four long sweepers and four quarter turns: 2.30 km with a true closure. */
export const ELIMINATOR_PLAN: readonly RoadSegment[] = Object.freeze(
  Array.from({ length: 4 }, () => [
    { kind: 'straight' as const, length: STRAIGHT },
    { kind: 'arc' as const, radius: CORNER_RADIUS, angle: Math.PI / 2 },
  ]).flat(),
);
export const ELIMINATOR_PATH = sampleRoad(ELIMINATOR_PLAN, START, 4);
if (
  !ELIMINATOR_PATH.closed ||
  ELIMINATOR_PATH.length < 2000 ||
  ELIMINATOR_PATH.length > 3000
)
  throw new RangeError(
    'The short highway Eliminator loop must close within 2–3 km.',
  );

function gate(
  path: RoadPath,
  station: number,
  kind: RunGateSpec['kind'],
): RunGateSpec {
  const pose = poseAt(path, station);
  return {
    kind,
    x: pose.x,
    z: pose.z,
    heading: pose.heading,
    width: ROAD_WIDTH + 2,
    length: kind === 'start' ? 20 : 12,
  };
}

const route: RunRouteSpec = {
  name: 'Highway Eliminator',
  gates: [
    gate(ELIMINATOR_PATH, 0, 'start'),
    gate(ELIMINATOR_PATH, ELIMINATOR_PATH.length / 4, 'checkpoint'),
    gate(ELIMINATOR_PATH, ELIMINATOR_PATH.length / 2, 'checkpoint'),
    gate(ELIMINATOR_PATH, (ELIMINATOR_PATH.length * 3) / 4, 'checkpoint'),
    gate(ELIMINATOR_PATH, ELIMINATOR_PATH.length - 20, 'goal'),
  ],
};

const rivals: TrafficCarRecord[] = (
  [
    [-30, -6, 'sedan'],
    [-30, 6, 'hatch'],
    [-45, -6, 'pickup'],
    [-45, 6, 'sedan'],
    [-60, -6, 'hatch'],
  ] as const
).map(([fromStart, laneOffset, modelKind]) => ({
  station: ELIMINATOR_PATH.length + fromStart,
  laneSide: laneOffset < 0 ? (-1 as const) : (1 as const),
  laneOffset,
  direction: 1 as const,
  speed: 50,
  rival: true,
  raceEntrant: true,
  modelKind,
}));

const grid = poseAt(ELIMINATOR_PATH, ELIMINATOR_PATH.length - 80);
export const ELIMINATOR_MAP: MapDefinition = {
  name: 'highway-eliminator',
  label: 'Highway Eliminator · five cuts',
  track: {
    pavedRadius: 1500,
    ringInnerRadius: 1300,
    centerLineRadius: 1400,
    barrierInnerRadius: 1900,
    barrierSegments: 1800,
    groundExtent: 2200,
    tickDegrees: 5,
    skidpadRadii: [],
    fogDensity: 0.00035,
    paintHeight: 0.016,
  },
  spawn: { x: grid.x, z: grid.z, heading: grid.heading },
  ramps: [],
  loops: [],
  halfPipes: [],
  jumpRamps: [],
  runways: lanesAlong(ELIMINATOR_PATH, ROAD_WIDTH, 20).map((lane) => ({
    ...lane,
    laneStripes: [-7, 7],
  })),
  boostPads: [],
  runs: [route],
  route: ELIMINATOR_PATH.samples
    .filter((_, index) => index % 8 === 0)
    .map(({ x, z }) => ({ x, z })),
  path: ELIMINATOR_PATH,
  traffic: rivals,
  placements: [],
};
