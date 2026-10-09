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

/** Three run-offs per side, all on straights. The opening at the start gives
 * cars room to join the road; the others alternate sides so a shunt target
 * remains opposite each opening. Each side retains over 90% solid wall. */
const WALL_RUNOFFS: Readonly<
  Record<-1 | 1, readonly (readonly [number, number])[]>
> = {
  [-1]: [
    [0, 180],
    [1000, 1240],
    [4350, 4590],
  ],
  [1]: [
    [0, 180],
    [1400, 1640],
    [4800, 5040],
  ],
};

/** Use long simple boxes on straights and 40 m chords on the sweepers. At
 * radius 420 m a 40 m chord cuts only 0.48 m inside the curve, leaving the
 * inside face beyond the 14 m paved edge. Adjacent boxes overlap by 0.3 m
 * at each end so there is no collision seam. */
function roadsideWalls(
  path: ReturnType<typeof sampleRoad>,
): ReturnType<typeof shuntWallAt>[] {
  const walls: ReturnType<typeof shuntWallAt>[] = [];
  for (const side of [-1, 1] as const) {
    let segmentStart = 0;
    for (const segment of TAKEDOWN_PLAN) {
      const segmentEnd =
        segmentStart +
        (segment.kind === 'straight'
          ? segment.length
          : segment.radius * Math.abs(segment.angle));
      const cuts = [segmentStart, segmentEnd];
      for (const [from, to] of WALL_RUNOFFS[side]) {
        if (from > segmentStart && from < segmentEnd) cuts.push(from);
        if (to > segmentStart && to < segmentEnd) cuts.push(to);
      }
      cuts.sort((a, b) => a - b);
      for (let i = 0; i < cuts.length - 1; i++) {
        const from = cuts[i]!;
        const to = cuts[i + 1]!;
        const midpoint = (from + to) / 2;
        if (
          WALL_RUNOFFS[side].some(
            ([gapStart, gapEnd]) => midpoint >= gapStart && midpoint < gapEnd,
          )
        )
          continue;
        const maxLength = segment.kind === 'arc' ? 40 : 1000;
        const count = Math.ceil((to - from) / maxLength);
        for (let part = 0; part < count; part++) {
          const start = from + ((to - from) * part) / count;
          const end = from + ((to - from) * (part + 1)) / count;
          walls.push(
            shuntWallAt(
              path,
              (start + end) / 2,
              side,
              end - start + 0.6,
              TAKEDOWN_ROAD_WIDTH,
            ),
          );
        }
      }
      segmentStart = segmentEnd;
    }
  }
  return walls;
}

/** Keep shoulder props that stand beyond the wall, but remove ones intersecting
 * the actual rotated box rather than a huge circle around a long wall. */
function overlapsWall(
  position: Readonly<{ x: number; z: number }>,
  wall: ReturnType<typeof shuntWallAt>,
): boolean {
  const dx = position.x - wall.center.x;
  const dz = position.z - wall.center.z;
  const c = Math.cos(wall.heading);
  const s = Math.sin(wall.heading);
  const across = c * dx - s * dz;
  const along = s * dx + c * dz;
  return (
    Math.abs(across) < wall.halfExtents.x + 2 &&
    Math.abs(along) < wall.halfExtents.z + 2
  );
}

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
      station: 65,
      laneSide: -1,
      direction: 1,
      speed: 35,
      rival: true,
      modelKind: 'sedan',
    },
    {
      station: 48,
      laneSide: 1,
      direction: 1,
      speed: 38,
      rival: true,
      modelKind: 'hatch',
    },
    {
      station: path.length - 48,
      laneSide: -1,
      direction: 1,
      speed: 41,
      rival: true,
      modelKind: 'pickup',
    },
    {
      station: path.length - 65,
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
  const walls = roadsideWalls(path);
  const placements: BreakablePlacement[] = shoulderPlacements(path, {
    density: 0.1,
    nearest: TAKEDOWN_ROAD_WIDTH / 2 + 4,
    farthest: TAKEDOWN_ROAD_WIDTH / 2 + 23,
    seed: 261,
  }).filter((prop) =>
    walls.every((wall) => !overlapsWall(prop.position, wall)),
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
