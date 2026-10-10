import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
import { createPhysicsWorld } from '../../src/physics/joltWorld';
import {
  CITY_CROSS_PATH,
  CITY_INTERSECTIONS,
  createCityMap,
} from '../../src/world/cityCourse';
import { createSurfacedBodies } from '../../src/world/surfacedBodies';
import { createSurfaceRegistry } from '../../src/world/surfaceRegistry';
import { createTraffic, MAX_DRIVING } from '../../src/world/traffic';
import { poseAt } from '../../src/world/roadGenerator';

const wasmPath = createRequire(import.meta.url).resolve(
  'jolt-physics/jolt-physics.wasm.wasm',
);
const DT = 1 / 120;

it('keeps both city traffic streams moving through a junction within one twelve-body pool', async () => {
  const map = createCityMap();
  const world = await createPhysicsWorld({ wasmPath });
  world.setGravity(20);
  world.createStaticBox({ x: 0, y: -0.5, z: 0 }, { x: 1200, y: 0.5, z: 1200 });
  const bodies = createSurfacedBodies(world, createSurfaceRegistry());
  const traffic = createTraffic(world, bodies, map.path!, map.traffic!, {
    density: 1,
    minGap: 24,
    maxGap: 45,
  });
  const west = CITY_INTERSECTIONS[0]!;
  const player = { x: west.x, y: 1, z: west.z - 12 };
  let arterialPhysical = false;
  let crossingPhysical = false;
  let crossingMoved = false;
  let peakPhysical = 0;
  let peakCrossing = 0;
  let visualGhostOverlaps = 0;
  try {
    const spawn = map.spawn!;
    expect(
      map.traffic!.every((record) => {
        const road = record.path ?? map.path!;
        const sample = road.samples.reduce((nearest, candidate) =>
          Math.abs(candidate.s - record.station) <
          Math.abs(nearest.s - record.station)
            ? candidate
            : nearest,
        );
        return Math.hypot(sample.x - spawn.x, sample.z - spawn.z) > 35;
      }),
    ).toBe(true);
    for (let step = 0; step < 4 * 120; step++) {
      traffic.preStep(DT, player, 30);
      const states = traffic.states;
      const physical = states.filter((car) => car.bodyId > 0);
      expect(physical.length).toBeLessThanOrEqual(MAX_DRIVING);
      peakPhysical = Math.max(peakPhysical, physical.length);
      const crossing = physical.filter(
        (car) => map.traffic![car.id - 1]?.path === CITY_CROSS_PATH,
      );
      arterialPhysical ||= physical.some(
        (car) => map.traffic![car.id - 1]?.path !== CITY_CROSS_PATH,
      );
      crossingPhysical ||= crossing.length > 0;
      peakCrossing = Math.max(peakCrossing, crossing.length);
      crossingMoved ||= crossing.some((car) => car.speed > 12);
      for (const cross of states) {
        if (map.traffic![cross.id - 1]?.path !== CITY_CROSS_PATH) continue;
        for (const car of states) {
          if (map.traffic![car.id - 1]?.path === CITY_CROSS_PATH) continue;
          if (cross.bodyId > 0 && car.bodyId > 0) continue;
          if (
            Math.abs(cross.position.x - car.position.x) < 2.5 &&
            Math.abs(cross.position.z - car.position.z) < 2.5
          )
            visualGhostOverlaps++;
        }
      }
      world.step(DT);
      traffic.postStep();
    }
    expect(arterialPhysical).toBe(true);
    expect(crossingPhysical).toBe(true);
    expect(crossingMoved).toBe(true);
    expect(peakPhysical).toBe(MAX_DRIVING);
    expect(peakCrossing).toBeGreaterThanOrEqual(2);
    expect(visualGhostOverlaps).toBe(0);
    expect(traffic.activeCount).toBeGreaterThan(100);
  } finally {
    traffic.dispose();
    bodies.dispose();
    world.dispose();
  }
}, 45_000);

it('authors at least 24 m between cars in each city stream and lane', () => {
  const map = createCityMap();
  const groups = new Map<string, number[]>();
  for (const car of map.traffic!) {
    const key = `${car.path === CITY_CROSS_PATH ? 'cross' : 'loop'}:${car.direction}:${car.laneSide}:${car.laneOffset ?? 0}`;
    const group = groups.get(key);
    if (group) group.push(car.station);
    else groups.set(key, [car.station]);
  }
  expect(groups.size).toBe(6);
  for (const stations of groups.values()) {
    stations.sort((a, b) => a - b);
    for (let i = 1; i < stations.length; i++)
      expect(stations[i]! - stations[i - 1]!).toBeGreaterThanOrEqual(24);
  }
});

it.each(['parked', 'moving'] as const)(
  'keeps city traffic intact for 60 s with a %s observer and promotion active',
  async (mode) => {
    const map = createCityMap();
    const world = await createPhysicsWorld({ wasmPath });
    world.setGravity(20);
    world.createStaticBox(
      { x: 0, y: -0.5, z: 0 },
      { x: 1200, y: 0.5, z: 1200 },
    );
    const bodies = createSurfacedBodies(world, createSurfaceRegistry());
    const traffic = createTraffic(world, bodies, map.path!, map.traffic!, {
      density: 1,
      minGap: 24,
      maxGap: 45,
    });
    const west = CITY_INTERSECTIONS[0]!;
    const observer = { x: west.x, y: 1, z: west.z - 12 };
    try {
      for (let step = 0; step < 60 * 120; step++) {
        if (mode === 'moving') {
          const pose = poseAt(
            map.path!,
            (map.path!.length - 35 + step * DT * 30) % map.path!.length,
          );
          observer.x = pose.x;
          observer.z = pose.z;
        }
        traffic.preStep(DT, observer, mode === 'moving' ? 30 : 0);
        world.step(DT);
        traffic.postStep();
        if (step % 120 === 0)
          expect(traffic.states.filter((car) => car.wrecked)).toEqual([]);
      }
      expect(traffic.activeCount).toBeGreaterThan(100);
    } finally {
      traffic.dispose();
      bodies.dispose();
      world.dispose();
    }
  },
  120_000,
);
