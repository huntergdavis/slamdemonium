import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
import { createImpactSeverity } from '../../src/core/impactSeverity';
import { createPhysicsWorld } from '../../src/physics/joltWorld';
import { MAPS } from '../../src/world/maps';
import { poseAt } from '../../src/world/roadGenerator';
import { createSurfaceRegistry } from '../../src/world/surfaceRegistry';
import { createSurfacedBodies } from '../../src/world/surfacedBodies';
import { createTraffic } from '../../src/world/traffic';

const wasmPath = createRequire(import.meta.url).resolve(
  'jolt-physics/jolt-physics.wasm.wasm',
);

it('holds a race wreck in view, then rejoins offscreen behind its validated gate with the same identity', async () => {
  const world = await createPhysicsWorld({ wasmPath });
  const bodies = createSurfacedBodies(world, createSurfaceRegistry());
  const map = MAPS['circuit-race'];
  const road = map.path!;
  const playerNear = poseAt(road, 2580);
  const near = { x: playerNear.x, y: 1, z: playerNear.z };
  const traffic = createTraffic(world, bodies, road, [
    {
      station: 2600,
      laneSide: 1,
      laneOffset: 5,
      speed: 50,
      rival: true,
      raceEntrant: true,
    },
  ]);
  try {
    traffic.setRaceValidatedStation(1, 2500);
    traffic.preStep(1 / 120, near);
    world.step(1 / 120);
    traffic.postStep();
    const car = traffic.raceStates[0]!;
    expect(car.bodyId).toBeGreaterThan(0);
    const impact = createImpactSeverity();
    impact.severity = 1;
    traffic.onPlayerContact(car.bodyId, impact);
    expect(car.wrecked).toBe(true);
    for (let second = 0; second < 6; second++) traffic.preStep(1, near);
    expect(car.wrecked).toBe(true);

    const far = poseAt(road, 5000);
    traffic.preStep(1 / 120, { x: far.x, y: 1, z: far.z });
    expect(car.wrecked).toBe(false);
    expect(car.id).toBe(1);
    expect(traffic.debugRivals().cars[0]!.station).toBeCloseTo(2460, 0);
    expect(
      car.crush.front + car.crush.rear + car.crush.left + car.crush.right,
    ).toBe(0);

    // Before checkpoint one, the safe rejoin is the start, never the end of
    // the closed route where it would silently gain almost a full lap.
    const playerAtReturn = poseAt(road, 2440);
    traffic.preStep(1 / 120, {
      x: playerAtReturn.x,
      y: 1,
      z: playerAtReturn.z,
    });
    world.step(1 / 120);
    traffic.postStep();
    expect(car.bodyId).toBeGreaterThan(0);
    traffic.setRaceValidatedStation(car.id, 0);
    traffic.onPlayerContact(car.bodyId, impact);
    expect(car.wrecked).toBe(true);
    for (let second = 0; second < 6; second++)
      traffic.preStep(1, { x: playerAtReturn.x, y: 1, z: playerAtReturn.z });
    traffic.preStep(1 / 120, { x: far.x, y: 1, z: far.z });
    expect(car.wrecked).toBe(false);
    expect(traffic.debugRivals().cars[0]!.station).toBe(0);
  } finally {
    traffic.dispose();
    bodies.dispose();
    world.dispose();
  }
}, 60_000);

it('holds a wrecked racer rather than respawning through a civilian at its return point', async () => {
  const world = await createPhysicsWorld({ wasmPath });
  const bodies = createSurfacedBodies(world, createSurfaceRegistry());
  const road = MAPS['circuit-race'].path!;
  const start = poseAt(road, 2580);
  const traffic = createTraffic(world, bodies, road, [
    {
      station: 2600,
      laneSide: 1,
      laneOffset: 5,
      speed: 50,
      rival: true,
      raceEntrant: true,
    },
    { station: 2460, laneSide: 1, laneOffset: 5, speed: 0 },
  ]);
  try {
    traffic.setRaceValidatedStation(1, 2500);
    traffic.preStep(1 / 120, { x: start.x, y: 1, z: start.z });
    world.step(1 / 120);
    traffic.postStep();
    const racer = traffic.raceStates[0]!;
    const impact = createImpactSeverity();
    impact.severity = 1;
    traffic.onPlayerContact(racer.bodyId, impact);
    const far = poseAt(road, 5000);
    for (let second = 0; second < 7; second++)
      traffic.preStep(1, { x: far.x, y: 1, z: far.z });
    expect(racer.wrecked).toBe(true);
    expect(racer.id).toBe(1);
  } finally {
    traffic.dispose();
    bodies.dispose();
    world.dispose();
  }
}, 60_000);
