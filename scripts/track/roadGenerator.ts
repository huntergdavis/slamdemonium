import type { Quat, V3 } from '../../src/physics/adapter';
import type { BreakablePlacement } from '../../src/world/breakableProps';
import type { RunwaySpec } from '../../src/world/runways';

/** Authoring 10 km of road as data (NS2). A plan is straights and arcs;
 * sampling it gives a centreline with a heading at every few metres, and
 * everything on the track is placed by station along that centreline:
 * painted lanes, shoulder props, ramps, loops, pads and run gates. The
 * heading follows the ramp convention (0 faces -Z, positive turns left). */
export type RoadSegment =
  | { readonly kind: 'straight'; readonly length: number }
  | {
      readonly kind: 'arc';
      readonly radius: number;
      /** Signed radians: positive turns left. */
      readonly angle: number;
    };

export interface RoadSample {
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  /** Station: metres from the start along the centreline. */
  readonly s: number;
}

export interface RoadPath {
  readonly samples: readonly RoadSample[];
  readonly length: number;
  /** End within a metre of the start, heading back to within a degree of
   * the start heading: a lap returns to the line. */
  readonly closed: boolean;
  readonly closureError: number;
}

export interface RoadPose {
  readonly x: number;
  readonly z: number;
  readonly heading: number;
}

function forward(heading: number): { x: number; z: number } {
  return { x: -Math.sin(heading), z: -Math.cos(heading) };
}
/** Left of the heading in the ground plane. */
function leftOf(heading: number): { x: number; z: number } {
  return { x: -Math.cos(heading), z: Math.sin(heading) };
}
/** Rotates a ground vector by a heading change (positive turns left). */
function rotate(
  vx: number,
  vz: number,
  angle: number,
): { x: number; z: number } {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: vx * c + vz * s, z: -vx * s + vz * c };
}

export function sampleRoad(
  plan: readonly RoadSegment[],
  start: RoadPose = { x: 0, z: 0, heading: 0 },
  step = 4,
): RoadPath {
  if (!(step > 0)) throw new RangeError('Road sample step must be positive.');
  const samples: RoadSample[] = [];
  let x = start.x;
  let z = start.z;
  let heading = start.heading;
  let s = 0;
  samples.push({ x, z, heading, s });
  for (const segment of plan) {
    if (segment.kind === 'straight') {
      if (!(segment.length > 0))
        throw new RangeError('Straight length must be positive.');
      const f = forward(heading);
      const count = Math.max(1, Math.ceil(segment.length / step));
      for (let i = 1; i <= count; i++) {
        const d = (segment.length * i) / count;
        samples.push({ x: x + f.x * d, z: z + f.z * d, heading, s: s + d });
      }
      x += f.x * segment.length;
      z += f.z * segment.length;
      s += segment.length;
    } else {
      if (
        !(segment.radius > 0) ||
        !Number.isFinite(segment.angle) ||
        segment.angle === 0
      )
        throw new RangeError(
          'Arc needs a positive radius and a non-zero angle.',
        );
      const sign = Math.sign(segment.angle);
      const l = leftOf(heading);
      const cx = x + sign * l.x * segment.radius;
      const cz = z + sign * l.z * segment.radius;
      const arcLength = segment.radius * Math.abs(segment.angle);
      const count = Math.max(1, Math.ceil(arcLength / step));
      for (let i = 1; i <= count; i++) {
        const a = (segment.angle * i) / count;
        const r = rotate(x - cx, z - cz, a);
        samples.push({
          x: cx + r.x,
          z: cz + r.z,
          heading: heading + a,
          s: s + (arcLength * i) / count,
        });
      }
      const r = rotate(x - cx, z - cz, segment.angle);
      x = cx + r.x;
      z = cz + r.z;
      heading += segment.angle;
      s += arcLength;
    }
  }
  const dx = x - start.x;
  const dz = z - start.z;
  const closureError = Math.hypot(dx, dz);
  const turn =
    (((heading - start.heading) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const headingBack = Math.min(turn, 2 * Math.PI - turn) < Math.PI / 180;
  return {
    samples,
    length: s,
    closed: closureError < 1 && headingBack,
    closureError,
  };
}

/** The pose at a station, interpolated between samples; stations wrap on a
 * closed path and clamp on an open one. */
export function poseAt(path: RoadPath, station: number): RoadPose {
  const { samples, length } = path;
  let s = station;
  if (path.closed) s = ((s % length) + length) % length;
  else s = Math.max(0, Math.min(length, s));
  let lo = 0;
  let hi = samples.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid]!.s <= s) lo = mid;
    else hi = mid;
  }
  const a = samples[lo]!;
  const b = samples[hi]!;
  const span = b.s - a.s;
  const t = span > 0 ? (s - a.s) / span : 0;
  const dh = b.heading - a.heading;
  return {
    x: a.x + (b.x - a.x) * t,
    z: a.z + (b.z - a.z) * t,
    heading: a.heading + dh * t,
  };
}

/** The road's paint as straight lane chunks, so arcs read as short
 * straights: a 20 m chunk on a 300 m radius sits 0.17 m off the curve. */
export function lanesAlong(
  path: RoadPath,
  width: number,
  chunk = 20,
): RunwaySpec[] {
  const out: RunwaySpec[] = [];
  const count = Math.max(1, Math.round(path.length / chunk));
  const size = path.length / count;
  for (let i = 0; i < count; i++) {
    const mid = poseAt(path, (i + 0.5) * size);
    out.push({
      x: mid.x,
      z: mid.z,
      heading: mid.heading,
      length: size + 0.05, // A hair of overlap hides the joins.
      width,
      markerMeters: 0,
    });
  }
  return out;
}

export interface ShoulderOptions {
  /** Props per metre of road over [from, to). */
  readonly density: number;
  readonly from?: number;
  readonly to?: number;
  /** Distance range from the centreline, either side. */
  readonly nearest: number;
  readonly farthest: number;
  readonly seed: number;
}

const IDENTITY: Quat = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });
const REST: number = 0.5;

/** Props scattered along both shoulders, never on the road. Deterministic
 * for a seed, so the record set is the same on every boot. */
export function shoulderPlacements(
  path: RoadPath,
  options: ShoulderOptions,
): BreakablePlacement[] {
  const from = options.from ?? 0;
  const to = options.to ?? path.length;
  let seed = options.seed >>> 0 || 1;
  const rnd = () =>
    (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const count = Math.floor((to - from) * options.density);
  const out: BreakablePlacement[] = [];
  for (let i = 0; i < count; i++) {
    const station = from + ((i + rnd()) * (to - from)) / count;
    const pose = poseAt(path, station);
    const l = leftOf(pose.heading);
    const side = rnd() < 0.5 ? -1 : 1;
    const offset =
      side * (options.nearest + rnd() * (options.farthest - options.nearest));
    const position: V3 = {
      x: pose.x + l.x * offset,
      y: REST,
      z: pose.z + l.z * offset,
    };
    out.push({ position: Object.freeze(position), rotation: IDENTITY });
  }
  return out;
}

/** A tight group of props at a station, off to one side: the things worth
 * a detour. `columns` across by `rows` along, 2.35 m apart like the
 * proving ground's clusters. */
export function clusterPlacements(
  path: RoadPath,
  station: number,
  side: -1 | 1,
  offset: number,
  columns = 4,
  rows = 3,
): BreakablePlacement[] {
  const pose = poseAt(path, station);
  const f = forward(pose.heading);
  const l = leftOf(pose.heading);
  const out: BreakablePlacement[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < columns; c++) {
      const across = side * offset + (c - (columns - 1) / 2) * 2.35;
      const along = (r - (rows - 1) / 2) * 6;
      out.push({
        position: Object.freeze({
          x: pose.x + l.x * across + f.x * along,
          y: REST,
          z: pose.z + l.z * across + f.z * along,
        }),
        rotation: IDENTITY,
      });
    }
  return out;
}
