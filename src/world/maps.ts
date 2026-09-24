import { SURFACE_IDS } from '../content/surfaces';
import {
  FORGIVING_LOOP_RADIUS,
  LOOP_LAYOUT,
  MIN_FAIR_LOOP_RADIUS,
  type LoopSpec,
} from './loopDeLoop';
import { RAMP_LAYOUT, type RampSpec } from './ramps';
import type { RunwaySpec } from './runways';
import type { TrackConfig } from './trackConfig';

/** A named world: track geometry overrides, where the car starts, and the
 * structures built on it. Every placement is data in absolute metres, so a
 * map is a table, not code. */
export interface MapSpawn {
  readonly x: number;
  readonly z: number;
  /** Yaw, ramp convention: 0 faces -Z, positive turns left. */
  readonly heading: number;
}
export interface MapDefinition {
  readonly name: MapName;
  readonly label: string;
  readonly track: Readonly<Partial<TrackConfig>>;
  /** Undefined means the track's own ring start line. */
  readonly spawn?: MapSpawn;
  readonly ramps: readonly RampSpec[];
  readonly loops: readonly LoopSpec[];
  readonly runways: readonly RunwaySpec[];
}
export type MapName = 'lab' | 'proving-ground';

const DEG = Math.PI / 180;
/** Heading that faces +Z. */
const NORTH = Math.PI;

/** Ring ramps on the proving ground, one per diagonal so the four runway
 * ends stay clear. Same four slabs as the lab, at the same distance inside
 * the racing line, but turned 45 degrees inward instead of 15: the CTO hits
 * these at 60 m/s and more, not 40, and the 24 m ramp at boost top speed
 * flies about 390 m. Aimed 45 degrees in from 365 m it comes down near 290 m
 * on the infield; aimed 15 degrees in it would clear the 470 m barrier. */
function ringRamp(
  positionDegrees: number,
  radius: number,
  slab: Pick<RampSpec, 'length' | 'width' | 'rise'>,
): RampSpec {
  const phi = positionDegrees * DEG;
  return {
    x: radius * Math.cos(phi),
    z: radius * Math.sin(phi),
    // Counter-clockwise tangent is heading pi - phi; inward is a right turn.
    heading: Math.PI - phi - 45 * DEG,
    ...slab,
  };
}

/** The lab: the 150 m ring the tuning and every replay fixture were made
 * on, exactly as before. The harness and the e2e suite run here. */
export const LAB_MAP: MapDefinition = Object.freeze({
  name: 'lab',
  label: 'Lab ring (150 m)',
  track: Object.freeze({}),
  ramps: RAMP_LAYOUT,
  loops: LOOP_LAYOUT,
  runways: Object.freeze([]),
});

/** Where the proving ground's three targets share one line: the car spawns
 * at the south end of the main runway and everything to hit is ahead. */
export const TARGET_LINE_Z = 40;
export const PROVING_GROUND_SPAWN_Z = -340;
export const PROVING_GROUND_RUNWAY_WIDTH = 16;

/** The proving ground: the same parametric ring at three times the radius
 * (400 m centre line, about 9.5 times the area) with a paved infield the
 * runways cross. The whole design is the approach: spawn at the south end
 * of a 700 m runway facing north, 380 m of straight to the target line, top
 * speed reached in about 250 m, and Respawn puts the car back on the same
 * line. On the target line the giant ramp sits on the runway's centre, the
 * lab's 10 m loop flanks it to the west and an 18 m loop to the east, so
 * the two loops are compared from the same spawn at the same speed. The
 * east-west runway is a second empty straight. */
export const PROVING_GROUND_MAP: MapDefinition = Object.freeze({
  name: 'proving-ground',
  label: 'Proving ground (400 m)',
  track: Object.freeze({
    pavedRadius: 460,
    ringInnerRadius: 340,
    centerLineRadius: 400,
    barrierInnerRadius: 470,
    barrierSegments: 384, // About 7.7 m per box, as on the lab ring.
    groundExtent: 1500,
    tickDegrees: 5,
    skidpadRadii: Object.freeze([]), // The runways cross at the centre.
    fogDensity: 0.0008, // The far side of the ring stays legible.
  }),
  spawn: Object.freeze({ x: 0, z: PROVING_GROUND_SPAWN_Z, heading: NORTH }),
  ramps: Object.freeze([
    // The giant ramp: 40 m long, 16 m wide, 9 m lip, launching north along
    // the runway. At 60 m/s about 3.3 s and 190 m of air with a 15 m apex,
    // landing on the infield; at boost top speed (85 m/s) about 350 m,
    // landing on the ring pavement 40 m inside the barrier. The integration
    // test measures both.
    Object.freeze({
      x: 0,
      z: TARGET_LINE_Z,
      heading: NORTH,
      length: 40,
      width: PROVING_GROUND_RUNWAY_WIDTH,
      rise: 9,
    }),
    Object.freeze(ringRamp(45, 375, { length: 12, width: 6, rise: 1.6 })),
    Object.freeze(ringRamp(225, 375, { length: 14, width: 6, rise: 2.4 })),
    Object.freeze(ringRamp(-45, 365, { length: 18, width: 8, rise: 3.5 })),
    Object.freeze(ringRamp(135, 365, { length: 24, width: 8, rise: 6 })),
  ]),
  loops: Object.freeze([
    // West: the hard loop. 14 m is the measured minimum radius at which a
    // loop is fair (MIN_FAIR_LOOP_RADIUS): arrive within 10 degrees and 2 m
    // at any speed from 24 to 60 m/s and a half-lock correction on the wall
    // does not drop you; the lab's 10 m loop, which reads as broken because
    // a perfect line at the wrong speed still falls, stays on the lab ring as
    // the control. Plain lane, no shoulders, on the tinted surface with the
    // slider neutral, so the CTO can try stickiness on this loop himself.
    Object.freeze({
      x: -36,
      z: TARGET_LINE_Z,
      heading: NORTH,
      radius: MIN_FAIR_LOOP_RADIUS,
      width: 14,
      shift: -15,
      segments: 56,
      surface: SURFACE_IDS.stickyAsphalt,
    }),
    // East: the forgiving loop. 18 m radius (36 m tall) so the wheels carry
    // 13 times their static load instead of the small loop's 18 to 26 and
    // the tyres keep margin; a 20 m lane; 3 m shoulders banked 12 degrees
    // so a car drifting toward an edge climbs and rolls back to the middle
    // (steeper banks launch the chassis instead: 30 degrees measured as a
    // 24 m/s hit and a fall); and its own surface so the `loopGrip` slider
    // scales this loop's grip alone (neutral by default: measured, grip did
    // not widen the window in either direction; the radius did).
    // Exit lane one lane outward. Measured before and after in
    // tests/integration/loop-forgiveness.integration.ts.
    Object.freeze({
      x: 36,
      z: TARGET_LINE_Z,
      heading: NORTH,
      radius: FORGIVING_LOOP_RADIUS,
      width: 20,
      // The exit lane and its shoulder must clear the entry lane and its
      // shoulder where the helix comes back down: 20 + 3 + 3 + 1 m of air.
      shift: 27,
      segments: 64,
      surface: SURFACE_IDS.stickyAsphalt,
      shoulder: Object.freeze({ width: 3, bank: 12 * DEG }),
    }),
  ]),
  runways: Object.freeze([
    // Main: north-south through the centre, spawn at its south end.
    Object.freeze({
      x: 0,
      z: 0,
      heading: NORTH,
      length: 700,
      width: PROVING_GROUND_RUNWAY_WIDTH,
      markerMeters: 50,
    }),
    // Cross: east-west, an empty straight.
    Object.freeze({
      x: 0,
      z: 0,
      heading: Math.PI / 2,
      length: 700,
      width: PROVING_GROUND_RUNWAY_WIDTH,
      markerMeters: 50,
    }),
    // Branches to the two loops: ease over from the main lane after 140 m.
    Object.freeze({
      x: -36,
      z: -80,
      heading: NORTH,
      length: 240,
      width: 14,
      markerMeters: 50,
    }),
    Object.freeze({
      x: 36,
      z: -80,
      heading: NORTH,
      length: 240,
      width: 20,
      markerMeters: 50,
    }),
  ]),
});

export const MAPS: Readonly<Record<MapName, MapDefinition>> = Object.freeze({
  lab: LAB_MAP,
  'proving-ground': PROVING_GROUND_MAP,
});
export const DEFAULT_MAP_NAME: MapName = 'proving-ground';

export function isMapName(value: unknown): value is MapName {
  return typeof value === 'string' && Object.hasOwn(MAPS, value);
}

/** `?map=lab` in the page URL wins; then the build's default (the e2e
 * build sets `VITE_DEFAULT_MAP=lab` so the suite keeps testing the world
 * its fixtures were recorded on); then the proving ground. */
export function resolveMapName(
  search: string,
  buildDefault?: unknown,
): MapName {
  const requested = new URLSearchParams(search).get('map');
  if (isMapName(requested)) return requested;
  if (isMapName(buildDefault)) return buildDefault;
  return DEFAULT_MAP_NAME;
}
