import { SURFACE_IDS } from '../../src/content/surfaces';
import type { RunGateSpec, RunRouteSpec } from '../../src/core/timedRun';
import type { BoostPadSpec } from '../../src/world/boostPads';
import type { BreakablePlacement } from '../../src/world/breakableProps';
import type { HalfPipeSpec } from '../../src/world/halfPipe';
import {
  FORGIVING_LOOP_RADIUS,
  MIN_FAIR_LOOP_RADIUS,
  type LoopSpec,
} from '../../src/world/loopDeLoop';
import type { MapDefinition } from '../../src/world/maps';
import type { RampSpec } from '../../src/world/ramps';
import {
  clusterPlacements,
  lanesAlong,
  poseAt,
  sampleRoad,
  shoulderPlacements,
  type RoadPath,
  type RoadSegment,
} from './roadGenerator';

/** The 10 km circuit (NS2), authored as a plan and stations. A rounded
 * rectangle, 3.7 by 1.7 km with 400 m corners (flat out at 60 m/s), plus
 * one lane-change chicane pair on the first long straight: 10.1 km, about
 * three minutes flat out. Everything on it is placed by station along the centreline so
 * moving a set piece is one number. The timed run is one lap: the start
 * box at station 0, three checkpoints, the goal 20 m short of the start. */
const DEG = Math.PI / 180;
const NORTH = Math.PI;
export const CIRCUIT_LANE_WIDTH = 16;
const LONG = 3700;
const SHORT = 1700;
/** 400 m: flat out at 60 m/s (0.9 g), the CTO's choice; the lap is won on speed and boost, not braking. */
const CORNER = 400;
const CHICANE_RADIUS = 200;
const CHICANE_ANGLE = 30 * DEG;

export const CIRCUIT_PLAN: readonly RoadSegment[] = Object.freeze([
  { kind: 'straight', length: 700 },
  { kind: 'arc', radius: CHICANE_RADIUS, angle: CHICANE_ANGLE },
  { kind: 'arc', radius: CHICANE_RADIUS, angle: -CHICANE_ANGLE },
  { kind: 'straight', length: 800 },
  { kind: 'arc', radius: CHICANE_RADIUS, angle: -CHICANE_ANGLE },
  { kind: 'arc', radius: CHICANE_RADIUS, angle: CHICANE_ANGLE },
  {
    kind: 'straight',
    length:
      LONG -
      2 * CORNER -
      700 -
      800 -
      4 * CHICANE_RADIUS * Math.sin(CHICANE_ANGLE),
  },
  { kind: 'arc', radius: CORNER, angle: 90 * DEG },
  { kind: 'straight', length: SHORT - 2 * CORNER },
  { kind: 'arc', radius: CORNER, angle: 90 * DEG },
  { kind: 'straight', length: LONG - 2 * CORNER },
  { kind: 'arc', radius: CORNER, angle: 90 * DEG },
  { kind: 'straight', length: SHORT - 2 * CORNER },
  { kind: 'arc', radius: CORNER, angle: 90 * DEG },
] as const);

/** The west side heading north, just past the bottom-left corner, so the
 * rectangle (long axis north-south) centres on the origin and the lap turns
 * left into it. */
const START = { x: -(SHORT / 2), z: -(LONG / 2 - CORNER), heading: NORTH };

/** Stations of the set pieces, metres from the start line. */
export const CIRCUIT_STATIONS = Object.freeze({
  pads: [300, 400, 500, 5300, 5400, 5500],
  giantRamp: 2000,
  forgivingLoop: 3900, // First short side: 2,900 to 3,800 after corner one's exit at 3,528.
  halfPipe: 6600,
  hardLoop: 8900, // Second short side, from 8,484.
  clusters: [800, 1800, 2250, 6000, 7000, 9600],
  checkpoints: [2500, 5000, 7500],
});

/** Not in the map list until the CTO chooses it; the name is its own. */
export interface CircuitMap extends Omit<MapDefinition, 'name'> {
  readonly name: 'circuit';
  readonly path: RoadPath;
  readonly placements: readonly BreakablePlacement[];
}

function gate(
  path: RoadPath,
  station: number,
  kind: RunGateSpec['kind'],
  width = 24,
): RunGateSpec {
  const p = poseAt(path, station);
  return { kind, x: p.x, z: p.z, heading: p.heading, width, length: 8 };
}

export function createCircuitMap(): CircuitMap {
  const path = sampleRoad(CIRCUIT_PLAN, START, 4);
  if (!path.closed)
    throw new RangeError(
      `Circuit does not close: ${path.closureError.toFixed(2)} m`,
    );
  const at = (station: number) => poseAt(path, station);
  const pads: BoostPadSpec[] = CIRCUIT_STATIONS.pads.map((s) => {
    const p = at(s);
    return { x: p.x, z: p.z, heading: p.heading, length: 12, width: 6 };
  });
  const ramp = at(CIRCUIT_STATIONS.giantRamp);
  const ramps: RampSpec[] = [
    // The proving ground's giant ramp, symmetric so a lap in either
    // direction and a retry from behind both work: 40 m faces, 16 m wide, 9 m lip.
    {
      x: ramp.x,
      z: ramp.z,
      heading: ramp.heading,
      length: 40,
      width: 16,
      rise: 9,
      symmetric: true,
    },
  ];
  const forgiving = at(CIRCUIT_STATIONS.forgivingLoop);
  const hard = at(CIRCUIT_STATIONS.hardLoop);
  const loops: LoopSpec[] = [
    {
      x: forgiving.x,
      z: forgiving.z,
      heading: forgiving.heading,
      radius: FORGIVING_LOOP_RADIUS,
      width: 20,
      shift: 27,
      segments: 64,
      surface: SURFACE_IDS.stickyAsphalt,
      shoulder: { width: 3, bank: 12 * DEG },
    },
    {
      x: hard.x,
      z: hard.z,
      heading: hard.heading,
      radius: MIN_FAIR_LOOP_RADIUS,
      width: 14,
      shift: -15,
      segments: 56,
      surface: SURFACE_IDS.stickyAsphalt,
    },
  ];
  // The aquifer beside the second long straight, 60 m off to the left with
  // its axis along the road, so a lap can dip into it and come back.
  const pipe = at(CIRCUIT_STATIONS.halfPipe);
  const left = { x: -Math.cos(pipe.heading), z: Math.sin(pipe.heading) };
  const halfPipes: HalfPipeSpec[] = [
    {
      x: pipe.x + left.x * 60,
      z: pipe.z + left.z * 60,
      heading: pipe.heading,
      radius: 40,
      deck: 200,
      width: 60,
    },
  ];
  const lanes = lanesAlong(path, CIRCUIT_LANE_WIDTH, 20);
  const placements: BreakablePlacement[] = [
    ...shoulderPlacements(path, {
      density: 1.5,
      nearest: 11,
      farthest: 24,
      seed: 11,
    }),
  ];
  CIRCUIT_STATIONS.clusters.forEach((s, i) =>
    placements.push(...clusterPlacements(path, s, i % 2 ? 1 : -1, 16)),
  );
  const gates: RunGateSpec[] = [
    gate(path, 0, 'start'),
    ...CIRCUIT_STATIONS.checkpoints.map((s) => gate(path, s, 'checkpoint')),
    gate(path, path.length - 20, 'goal', 30),
  ];
  const runs: RunRouteSpec[] = [{ name: 'Circuit lap', gates }];
  const spawn = at(path.length - 40); // 40 m short of the start line, facing it.
  return {
    name: 'circuit',
    label: 'Circuit (10 km)',
    track: {
      pavedRadius: 2150,
      ringInnerRadius: 2000,
      centerLineRadius: 2075,
      barrierInnerRadius: 2200,
      barrierSegments: 1800, // About 7.7 m per box, as on the other maps.
      groundExtent: 3200,
      tickDegrees: 5,
      skidpadRadii: [],
      fogDensity: 0.0008,
    },
    spawn: { x: spawn.x, z: spawn.z, heading: spawn.heading },
    ramps,
    loops,
    halfPipes,
    runways: lanes,
    boostPads: pads,
    runs,
    path,
    placements,
  };
}
