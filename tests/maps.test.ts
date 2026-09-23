import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { SURFACE_IDS } from '../src/content/surfaces';
import { BREAKABLE_PROP_PLACEMENTS } from '../src/world/breakablePlacements';
import {
  FORGIVING_LOOP_RADIUS,
  LOOP_LAYOUT,
  MIN_FAIR_LOOP_RADIUS,
  loopSlabDescriptors,
} from '../src/world/loopDeLoop';
import {
  DEFAULT_MAP_NAME,
  LAB_MAP,
  MAPS,
  PROVING_GROUND_MAP,
  PROVING_GROUND_SPAWN_Z,
  TARGET_LINE_Z,
  resolveMapName,
} from '../src/world/maps';
import {
  RAMP_LAYOUT,
  rampBodyDescriptor,
  rampFootprintRadius,
  rampForward,
} from '../src/world/ramps';
import {
  RUNWAY_CROSSBAR_WIDTH,
  runwayForward,
  runwayInstances,
  runwayLaneClearance,
} from '../src/world/runways';
import type { SurfacedStaticBodyDesc } from '../src/world/surfacedBodies';
import { resolveTrackConfig } from '../src/world/trackConfig';
import { createTrackLayout } from '../src/world/trackLayout';
import {
  createBarrierDescriptors,
  createGroundDescriptor,
} from '../src/world/trackPhysics';

const MIN_LANE_CLEARANCE = 5;
const pg = PROVING_GROUND_MAP;
const config = resolveTrackConfig(pg.track);

/** Every structure as ground-plane discs: one per ramp, one per loop slab
 * (a loop's single footprint circle is far too generous once it has
 * shoulders and a wide exit lane). */
function footprints(map: typeof pg) {
  return [
    ...map.ramps.map((spec, index) => {
      const d = rampBodyDescriptor(spec);
      return {
        kind: 'ramp' as const,
        index,
        x: d.center.x,
        z: d.center.z,
        radius: rampFootprintRadius(spec),
      };
    }),
    ...map.loops.flatMap((spec, index) =>
      loopSlabDescriptors(spec).flatMap((slab) =>
        slabCorners(slab).map((corner) => ({
          kind: 'loop' as const,
          index,
          x: corner.x,
          z: corner.z,
          radius: 0,
        })),
      ),
    ),
  ];
}

/** Ground projections of a slab's four top corners: a loop slab is wide
 * across the lane and short along it, so a disc around it would be far
 * too generous along the lane. */
function slabCorners(slab: SurfacedStaticBodyDesc): { x: number; z: number }[] {
  const q = slab.rotation!;
  const rotation = new Quaternion(q.x, q.y, q.z, q.w);
  const right = new Vector3(1, 0, 0).applyQuaternion(rotation);
  const tangent = new Vector3(0, 0, 1).applyQuaternion(rotation);
  const corners: { x: number; z: number }[] = [];
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const c = new Vector3(slab.center.x, slab.center.y, slab.center.z)
        .addScaledVector(right, sx * slab.halfExtents.x)
        .addScaledVector(tangent, sz * slab.halfExtents.z);
      corners.push({ x: c.x, z: c.z });
    }
  return corners;
}

describe('map selection', () => {
  it('takes the URL switch first, then the build default, then the proving ground', () => {
    expect(resolveMapName('?map=lab')).toBe('lab');
    expect(resolveMapName('?foo=1&map=proving-ground', 'lab')).toBe(
      'proving-ground',
    );
    expect(resolveMapName('', 'lab')).toBe('lab');
    expect(resolveMapName('?map=moon', 'lab')).toBe('lab');
    expect(resolveMapName('', 'moon')).toBe(DEFAULT_MAP_NAME);
    expect(resolveMapName('')).toBe('proving-ground');
    expect(Object.keys(MAPS).sort()).toEqual(['lab', 'proving-ground']);
  });

  it('keeps the lab exactly as the fixtures know it', () => {
    expect(LAB_MAP.track).toEqual({});
    expect(LAB_MAP.spawn).toBeUndefined();
    expect(LAB_MAP.ramps).toBe(RAMP_LAYOUT);
    expect(LAB_MAP.loops).toBe(LOOP_LAYOUT);
    expect(LAB_MAP.runways).toHaveLength(0);
    expect(resolveTrackConfig(LAB_MAP.track).barrierSegments).toBe(128);
  });
});

describe('proving ground track', () => {
  it('is a nested ring three times the lab radius with the collider scaled to match', () => {
    expect(config.centerLineRadius).toBe(400);
    expect(config.ringInnerRadius).toBeLessThan(config.centerLineRadius);
    expect(config.pavedRadius).toBeLessThan(config.barrierInnerRadius);
    expect(config.barrierInnerRadius + config.barrierThickness).toBeLessThan(
      config.groundExtent,
    );
    const barriers = createBarrierDescriptors(config);
    expect(barriers).toHaveLength(384);
    // Box length stays close to the lab's 7.5 m so the wall reads the same.
    expect(barriers[0]!.halfExtents.z * 2).toBeGreaterThan(7);
    expect(barriers[0]!.halfExtents.z * 2).toBeLessThan(8);
    const ground = createGroundDescriptor(config);
    expect(ground.halfExtents.x).toBeGreaterThan(
      config.barrierInnerRadius + config.barrierThickness,
    );
    expect(config.skidpadRadii).toHaveLength(0);
    expect(config.fogDensity).toBeLessThan(0.001);
    // Paint and posts triple roughly, not explode.
    const layout = createTrackLayout(config);
    expect(layout.curbs.length + layout.posts.length).toBeLessThan(3500);
  });

  it('spawns at the south end of the main runway facing north with a full straight ahead', () => {
    const spawn = pg.spawn!;
    expect(spawn.x).toBe(0);
    expect(spawn.z).toBe(PROVING_GROUND_SPAWN_Z);
    expect(Math.hypot(spawn.x, spawn.z)).toBeLessThan(config.pavedRadius);
    const main = pg.runways[0]!;
    const f = runwayForward(main);
    expect(f.z).toBeCloseTo(1, 9); // North is +Z.
    expect(runwayLaneClearance(main, spawn.x, spawn.z)).toBe(0);
    // Top speed takes about 250 m; the target line must be well past that.
    expect(TARGET_LINE_Z - spawn.z).toBeGreaterThanOrEqual(350);
    // Facing along the runway.
    expect(-Math.sin(spawn.heading)).toBeCloseTo(f.x, 9);
    expect(-Math.cos(spawn.heading)).toBeCloseTo(f.z, 9);
  });
});

describe('proving ground structures', () => {
  it('puts the giant ramp on the main lane and the two loops on the branch lanes, all on the target line', () => {
    const [giant] = pg.ramps;
    expect(giant!.z).toBe(TARGET_LINE_Z);
    expect(giant!.x).toBe(0);
    expect(giant!.rise).toBeGreaterThanOrEqual(9);
    expect(giant!.length).toBeGreaterThanOrEqual(40);
    const [west, east] = pg.loops;
    // West is the hard loop at the measured minimum fair radius; east is the
    // forgiving one. Both carry the tinted surface the loopGrip slider
    // scales (neutral by default), only the east has shoulders, and the
    // lab's 10 m loop stays on the lab ring as the control.
    expect(west).toMatchObject({
      radius: MIN_FAIR_LOOP_RADIUS,
      width: 14,
      z: TARGET_LINE_Z,
      surface: SURFACE_IDS.stickyAsphalt,
    });
    expect(west!.x).toBeLessThan(0); // West.
    expect(west!.shoulder).toBeUndefined();
    expect(east!.x).toBeGreaterThan(0); // East.
    expect(east!.z).toBe(TARGET_LINE_Z);
    expect(east!.radius).toBe(FORGIVING_LOOP_RADIUS);
    expect(east!.surface).toBe(SURFACE_IDS.stickyAsphalt);
    expect(east!.shoulder).toBeDefined();
    expect(east!.width).toBeGreaterThan(west!.width);
    expect(LAB_MAP.loops[0]!.radius).toBe(10); // The control, untouched.
    for (const loop of pg.loops) {
      expect(loop.heading).toBe(giant!.heading);
      expect(Math.abs(loop.shift)).toBeGreaterThan(loop.width);
    }
    // Every slab of both loops stays clear of the giant ramp's lane.
    const main = pg.runways[0]!;
    for (const loop of pg.loops)
      for (const slab of loopSlabDescriptors(loop))
        expect(
          runwayLaneClearance(main, slab.center.x, slab.center.z) -
            Math.hypot(slab.halfExtents.x, slab.halfExtents.z),
        ).toBeGreaterThan(MIN_LANE_CLEARANCE);
  });

  it('keeps every runway lane clear of everything except its own end target', () => {
    // Lane index -> the one structure allowed inside it.
    const targets: Record<number, { kind: 'ramp' | 'loop'; index: number }> = {
      0: { kind: 'ramp', index: 0 },
      2: { kind: 'loop', index: 0 },
      3: { kind: 'loop', index: 1 },
    };
    const all = footprints(pg);
    pg.runways.forEach((lane, laneIndex) => {
      const target = targets[laneIndex];
      for (const f of all) {
        if (target && f.kind === target.kind && f.index === target.index)
          continue;
        const clearance = runwayLaneClearance(lane, f.x, f.z) - f.radius;
        expect(
          clearance,
          `${f.kind} ${f.index} is ${clearance.toFixed(1)} m from lane ${laneIndex}`,
        ).toBeGreaterThan(MIN_LANE_CLEARANCE);
      }
      // The lab's props and gates still sit on this infield until Codex
      // re-places them; none may stand in a lane.
      for (const prop of BREAKABLE_PROP_PLACEMENTS)
        expect(
          runwayLaneClearance(lane, prop.position.x, prop.position.z),
        ).toBeGreaterThan(MIN_LANE_CLEARANCE);
    });
    // Each target really is at the far end of its lane, not the spawn end.
    for (const [laneIndex, target] of Object.entries(targets)) {
      const lane = pg.runways[Number(laneIndex)]!;
      const f = all.find(
        (c) => c.kind === target.kind && c.index === target.index,
      )!;
      const forward = runwayForward(lane);
      expect(
        (f.x - lane.x) * forward.x + (f.z - lane.z) * forward.z,
      ).toBeGreaterThan(0);
    }
  });

  it('authors the ring ramps on the pavement, inside the barrier and aimed well inward', () => {
    for (const spec of pg.ramps.slice(1)) {
      const d = rampBodyDescriptor(spec);
      const radius = Math.hypot(d.center.x, d.center.z);
      expect(radius).toBeGreaterThan(config.ringInnerRadius);
      expect(radius).toBeLessThan(config.centerLineRadius - 20);
      const forward = rampForward(spec, { x: 0, y: 0, z: 0 });
      const outward = { x: d.center.x / radius, z: d.center.z / radius };
      // Aimed 45 degrees inward at the low edge; measured at the slab centre
      // the outward radial has turned a little, so ask for at least 40.
      expect(forward.x * outward.x + forward.z * outward.z).toBeLessThan(-0.64);
    }
    const all = footprints(pg);
    for (const f of all)
      expect(Math.hypot(f.x, f.z) + f.radius).toBeLessThan(
        config.barrierInnerRadius - 10,
      );
    // Distinct structures keep daylight between them: closest approach
    // between the disc sets of every pair of structures.
    const groups = new Map<string, typeof all>();
    for (const f of all) {
      const key = `${f.kind} ${f.index}`;
      groups.set(key, [...(groups.get(key) ?? []), f]);
    }
    const names = [...groups.keys()];
    for (let i = 0; i < names.length; i++)
      for (let j = i + 1; j < names.length; j++) {
        let closest = Infinity;
        for (const a of groups.get(names[i]!)!)
          for (const b of groups.get(names[j]!)!)
            closest = Math.min(
              closest,
              Math.hypot(a.x - b.x, a.z - b.z) - a.radius - b.radius,
            );
        expect(closest, `${names[i]} vs ${names[j]}`).toBeGreaterThan(
          MIN_LANE_CLEARANCE,
        );
      }
  });
});

describe('the loop rule', () => {
  it('authors no loop below the measured minimum fair radius, except the lab control', () => {
    expect(MIN_FAIR_LOOP_RADIUS).toBe(14);
    expect(FORGIVING_LOOP_RADIUS).toBeGreaterThan(MIN_FAIR_LOOP_RADIUS);
    for (const [name, map] of Object.entries(MAPS)) {
      if (name === 'lab') continue; // The 10 m control predates the rule.
      for (const loop of map.loops)
        expect(
          loop.radius,
          `${name} loop at (${loop.x}, ${loop.z})`,
        ).toBeGreaterThanOrEqual(MIN_FAIR_LOOP_RADIUS);
    }
    expect(LAB_MAP.loops).toBe(LOOP_LAYOUT);
  });
});

describe('runway paint', () => {
  const main = pg.runways[0]!;
  const instances = runwayInstances([main], config);
  it('paints two edges, centre dashes and a crossbar every 50 m, all inside the lane', () => {
    const edges = instances.filter((i) => i.size.z === main.length);
    expect(edges).toHaveLength(2);
    const bars = instances.filter((i) => i.size.z === RUNWAY_CROSSBAR_WIDTH);
    expect(bars).toHaveLength(main.length / main.markerMeters - 1);
    const dashes = instances.filter((i) => i.size.z === config.dashLength);
    expect(dashes).toHaveLength(
      Math.floor(main.length / (config.dashLength + config.dashGap)),
    );
    for (const i of instances) {
      expect(i.rotY).toBe(main.heading);
      expect(i.center.y).toBe(config.paintHeight);
      expect(runwayLaneClearance(main, i.center.x, i.center.z)).toBe(0);
    }
    // Ticks read the approach: the first crossbar is 50 m from the south end.
    const south = bars.reduce((min, b) => Math.min(min, b.center.z), Infinity);
    expect(south).toBeCloseTo(-main.length / 2 + main.markerMeters, 9);
  });

  it('measures lane clearance as distance to the lane rectangle', () => {
    expect(runwayLaneClearance(main, 0, 0)).toBe(0);
    expect(runwayLaneClearance(main, 7.9, -349)).toBe(0);
    expect(runwayLaneClearance(main, 12, 0)).toBeCloseTo(4, 9);
    expect(runwayLaneClearance(main, 0, 360)).toBeCloseTo(10, 9);
    expect(runwayLaneClearance(main, 11, 354)).toBeCloseTo(5, 9);
    const cross = pg.runways[1]!;
    expect(runwayLaneClearance(cross, 300, 0)).toBe(0);
    expect(runwayLaneClearance(cross, 0, 20)).toBeCloseTo(12, 9);
  });
});
