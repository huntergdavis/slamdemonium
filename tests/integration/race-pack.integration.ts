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
  const start = poseAt(road, 2600);
  const near = { x: start.x, y: 1, z: start.z };
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
  } finally {
    traffic.dispose();
    bodies.dispose();
    world.dispose();
  }
}, 60_000);
