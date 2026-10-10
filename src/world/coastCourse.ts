import type { RunGateSpec, RunRouteSpec } from '../core/timedRun';
import type { MapDefinition } from './maps';
import {
  lanesAlong,
  poseAt,
  sampleRoad,
  type RoadPath,
  type RoadSegment,
} from './roadGenerator';
import { shuntWallAt } from './shuntWalls';
import type { TrafficCarRecord } from './traffic';

const DEG = Math.PI / 180;
const ROAD_WIDTH = 16;
const SHARED_START = 500;
const SHARED_FINISH = 700;
const SHORE_RADIUS = 250;
const SHORE_ANGLE = 60 * DEG;
const HEAD_RADIUS = 180;
// Both branches are 250 m from the common centreline through the middle.
const HEAD_ANGLE = Math.acos(1 - 250 / (2 * HEAD_RADIUS));
const SHORE_MIDDLE = 1200;
const HEAD_MIDDLE =
  SHORE_MIDDLE +
  4 * SHORE_RADIUS * Math.sin(SHORE_ANGLE) -
  4 * HEAD_RADIUS * Math.sin(HEAD_ANGLE);
const START = { x: 0, z: -1650, heading: Math.PI };

function plan(
  side: 1 | -1,
  radius: number,
  angle: number,
  middle: number,
): RoadSegment[] {
  return [
    { kind: 'straight', length: SHARED_START },
    { kind: 'arc', radius, angle: side * angle },
    { kind: 'arc', radius, angle: -side * angle },
    { kind: 'straight', length: middle },
    { kind: 'arc', radius, angle: -side * angle },
    { kind: 'arc', radius, angle: side * angle },
    { kind: 'straight', length: SHARED_FINISH },
  ];
}

export const COAST_SHORE_PATH = sampleRoad(
  plan(1, SHORE_RADIUS, SHORE_ANGLE, SHORE_MIDDLE),
  START,
  4,
);
export const COAST_HEAD_PATH = sampleRoad(
  plan(-1, HEAD_RADIUS, HEAD_ANGLE, HEAD_MIDDLE),
  START,
  4,
);

function gate(
  path: RoadPath,
  station: number,
  kind: RunGateSpec['kind'],
): RunGateSpec {
  const p = poseAt(path, station);
  return { kind, x: p.x, z: p.z, heading: p.heading, width: 20, length: 10 };
}

function route(path: RoadPath, name: string): RunRouteSpec {
  return {
    name,
    gates: [
      gate(path, 0, 'start'),
      gate(path, 1350, 'checkpoint'),
      gate(path, 2150, 'checkpoint'),
      gate(path, path.length - 40, 'goal'),
    ],
  };
}

function traffic(path: RoadPath): TrafficCarRecord[] {
  const records: TrafficCarRecord[] = [];
  for (let station = 200; station < path.length - 200; station += 76) {
    // Keep the first fork and narrow bends clear while a 25 m/s player
    // traverses them. Initial spawn gaps alone do not work: moving cars
    // otherwise reach the bend before the player.
    if (station > 1050) {
      records.push({
        station,
        laneSide: 1,
        direction: 1,
        speed: 21 + (Math.floor(station / 76) % 8),
      });
    }
    // A 30 m/s oncoming car must start beyond ~2.3 km to meet a 25 m/s
    // player only after station 1.05 km: 25*S/(25+30) >= 1050.
    if (station + 38 > 2310) {
      records.push({
        station: station + 38,
        laneSide: -1,
        direction: -1,
        speed: 24 + (Math.floor(station / 152) % 7),
      });
    }
  }
  return records;
}

const shoreBranchStart = SHARED_START + 2 * SHORE_RADIUS * SHORE_ANGLE;
const headBranchStart = SHARED_START + 2 * HEAD_RADIUS * HEAD_ANGLE;
const shoreWalls = Array.from({ length: 30 }, (_, i) =>
  shuntWallAt(
    COAST_SHORE_PATH,
    shoreBranchStart + 20 + i * 40,
    1,
    40,
    ROAD_WIDTH,
  ),
);
const headWalls = Array.from({ length: 35 }, (_, i) =>
  shuntWallAt(
    COAST_HEAD_PATH,
    headBranchStart + 20 + i * 40,
    -1,
    40,
    ROAD_WIDTH,
  ),
);

/** The common first/last road is drawn once; the branch is a second deck. */
export const COAST_ROAD_DECKS = [
  ...lanesAlong(COAST_SHORE_PATH, ROAD_WIDTH, 20),
  ...lanesAlong(COAST_HEAD_PATH, ROAD_WIDTH, 20).filter((_, i, all) => {
    const s = ((i + 0.5) * COAST_HEAD_PATH.length) / all.length;
    return s >= SHARED_START && s <= COAST_HEAD_PATH.length - SHARED_FINISH;
  }),
];

function makeMap(
  name: 'coast-shoreline' | 'coast-headland',
  label: string,
  path: RoadPath,
): MapDefinition {
  const spawn = poseAt(path, 0);
  return {
    name,
    label,
    track: {
      pavedRadius: 2150,
      ringInnerRadius: 2000,
      centerLineRadius: 2075,
      barrierInnerRadius: 2200,
      groundExtent: 3200,
      barrierSegments: 900,
      tickDegrees: 5,
      skidpadRadii: [],
      fogDensity: 0.0007,
      paintHeight: 0.016,
    },
    spawn,
    ramps: [],
    loops: [],
    halfPipes: [],
    jumpRamps: [],
    runways: COAST_ROAD_DECKS,
    boostPads: [],
    runs: [
      route(
        path,
        name === 'coast-shoreline' ? 'Shoreline run' : 'Headland run',
      ),
    ],
    route: path.samples
      .filter((_, i) => i % 12 === 0)
      .map((p) => ({ x: p.x, z: p.z })),
    path,
    traffic: traffic(path),
    placements: [],
    shuntWalls: name === 'coast-shoreline' ? shoreWalls : headWalls,
  };
}

export const COAST_SHORELINE_MAP = makeMap(
  'coast-shoreline',
  'Coast · shoreline',
  COAST_SHORE_PATH,
);
export const COAST_HEADLAND_MAP = makeMap(
  'coast-headland',
  'Coast · headland',
  COAST_HEAD_PATH,
);
