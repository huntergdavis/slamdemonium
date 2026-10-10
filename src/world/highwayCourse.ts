import type { RunGateSpec, RunRouteSpec } from '../core/timedRun';
import { CIRCUIT_PLAN } from './circuit';
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
const START = { x: -850, z: -1450, heading: Math.PI };
// The circuit's first four 200 m / 30 degree arcs advance 400 m along its
// original heading. A straight across that interval makes the fast bypass;
// the displaced circuit line becomes the interchange, with a real rejoin.
const BYPASS_LENGTH = 800 + 4 * 200 * Math.sin(Math.PI / 6);
const expressPlan: RoadSegment[] = [
  CIRCUIT_PLAN[0]!,
  { kind: 'straight', length: BYPASS_LENGTH },
  ...CIRCUIT_PLAN.slice(6),
];

export const HIGHWAY_EXPRESS_PATH = sampleRoad(expressPlan, START, 4);
export const HIGHWAY_INTERCHANGE_PATH = sampleRoad(CIRCUIT_PLAN, START, 4);

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
    width: kind === 'start' ? ROAD_WIDTH + 4 : 26,
    length: kind === 'start' ? 20 : 12,
  };
}

function run(path: RoadPath, name: string): RunRouteSpec {
  return {
    name,
    gates: [
      gate(path, 0, 'start'),
      gate(path, 1200, 'checkpoint'), // Before the lines rejoin.
      gate(path, 3700, 'checkpoint'),
      gate(path, 6800, 'checkpoint'),
      gate(path, path.length - 25, 'goal'),
    ],
  };
}

function traffic(path: RoadPath, interchange: boolean): TrafficCarRecord[] {
  const records: TrafficCarRecord[] = [];
  for (
    let station = 280, index = 0;
    station < path.length - 100;
    station += 38, index++
  ) {
    const heavy =
      index % 19 === 0 ? 'bus' : index % 7 === 0 ? 'boxTruck' : undefined;
    records.push({
      station,
      laneSide: 1,
      direction: 1,
      // Keep heavy vehicles visibly slower without making the 38 m stream
      // close faster than the pooled body's 5 m/s² controller can brake.
      speed: heavy ? 42 + (index % 4) : 46 + (index % 9),
      ...(heavy ? { modelKind: heavy } : {}),
    });
    if (!interchange)
      records.push({
        station: station + 19,
        laneSide: -1,
        direction: 1,
        speed: 43 + (index % 12),
        ...(index % 11 === 0 ? { modelKind: 'van' as const } : {}),
      });
  }
  if (interchange) {
    // These cars start beyond the merge, then travel back into it as a
    // 35 m/s player arrives around 50 s later. The opposing lane contains no
    // same-way cars for them to collide with before that encounter.
    for (let station = 3550; station <= 4150; station += 76)
      records.push({
        station,
        laneSide: -1,
        direction: -1,
        speed: 34,
      });
  }
  return records;
}

/** Both decks are drawn on both selections; the express line has no visual-
 * only shortcut. The production ground collider supports the whole fork. */
export const HIGHWAY_DECKS = [
  ...lanesAlong(HIGHWAY_INTERCHANGE_PATH, ROAD_WIDTH, 24),
  ...lanesAlong(HIGHWAY_EXPRESS_PATH, ROAD_WIDTH, 24).filter(
    (_, index, all) => {
      const station =
        ((index + 0.5) * HIGHWAY_EXPRESS_PATH.length) / all.length;
      return station >= 700 && station <= 1900;
    },
  ),
].map((lane) => ({ ...lane, laneStripes: [-7, 7] }));

function makeMap(
  name: 'highway-express' | 'highway-interchange',
  label: string,
  path: RoadPath,
): MapDefinition {
  const spawn = poseAt(path, path.length - 48);
  return {
    name,
    label,
    track: {
      pavedRadius: 2150,
      ringInnerRadius: 2000,
      centerLineRadius: 2075,
      barrierInnerRadius: 2200,
      barrierSegments: 1800,
      groundExtent: 3200,
      tickDegrees: 5,
      skidpadRadii: [],
      fogDensity: 0.00045,
      paintHeight: 0.016,
    },
    spawn,
    ramps: [],
    loops: [],
    halfPipes: [],
    jumpRamps: [],
    runways: HIGHWAY_DECKS,
    boostPads: [],
    runs: [
      run(path, name === 'highway-express' ? 'Express lap' : 'Interchange lap'),
    ],
    route: path.samples
      .filter((_, index) => index % 12 === 0)
      .map(({ x, z }) => ({ x, z })),
    path,
    traffic: traffic(path, name === 'highway-interchange'),
    placements: [],
  };
}

export const HIGHWAY_EXPRESS_MAP = makeMap(
  'highway-express',
  'Highway · express',
  HIGHWAY_EXPRESS_PATH,
);
export const HIGHWAY_INTERCHANGE_MAP = makeMap(
  'highway-interchange',
  'Highway · interchange',
  HIGHWAY_INTERCHANGE_PATH,
);
