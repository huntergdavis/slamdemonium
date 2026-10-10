import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
import { createPhysicsWorld } from '../../src/physics/joltWorld';
import { createSurfaceRegistry } from '../../src/world/surfaceRegistry';
import { createSurfacedBodies } from '../../src/world/surfacedBodies';
import { createTraffic } from '../../src/world/traffic';
import { MAPS } from '../../src/world/maps';
import { poseAt } from '../../src/world/roadGenerator';
import { installLoops } from '../../src/world/loopDeLoop';
import { installRamps } from '../../src/world/ramps';

const wasmPath = createRequire(import.meta.url).resolve(
  'jolt-physics/jolt-physics.wasm.wasm',
);

it('holds a physical six-car grid, runs a clean first lap through live traffic and retries', async () => {
  const world = await createPhysicsWorld({ wasmPath });
  world.setGravity(20);
  const map = MAPS['circuit-race'];
  const spawn = map.spawn!;
  world.createStaticBox({ x: 0, y: -0.5, z: 0 }, { x: 3200, y: 0.5, z: 3200 });
  const player = world.createStaticBox(
    { x: spawn.x, y: 0.65, z: spawn.z },
    { x: 1.08, y: 0.65, z: 2.4 },
  );
  const bodies = createSurfacedBodies(world, createSurfaceRegistry());
  installLoops(bodies, map.loops);
  installRamps(bodies, map.ramps);
  const traffic = createTraffic(world, bodies, map.path!, map.traffic!, {
    density: 0.85,
    minGap: 12,
    maxGap: 36,
  });
  const playerPose = { x: spawn.x, y: 1, z: spawn.z };
  let gridContacts = 0;
  world.onContact((a, b, _impulse, _point, normal, readVelocities) => {
    if (
      (a === player && traffic.stateForBody(b)?.raceEntrant) ||
      (b === player && traffic.stateForBody(a)?.raceEntrant)
    )
      gridContacts++;
    traffic.onWorldContact(a, b, normal, readVelocities);
  });
  try {
    const ids = traffic.raceStates.map((car) => car.id);
    expect(new Set(ids).size).toBe(5);
    for (let step = 0; step < 120; step++) {
      traffic.preStep(1 / 120, playerPose, 0);
      world.step(1 / 120);
      traffic.postStep();
    }
    expect(traffic.raceStates.every((car) => car.bodyId > 0)).toBe(true);
    expect(traffic.raceStates.every((car) => car.speed < 1)).toBe(true);
    expect(gridContacts).toBe(0);

    world.destroyBody(player);
    traffic.setRaceRunning(true);
    const lapSteps = Math.ceil((map.path!.length / 50 + 12) * 120);
    let leaderPhysicalSamples = 0;
    let leaderDistance = 0;
    const structurePoints = [2000, 3900, 8900].map((station) =>
      poseAt(map.path!, station),
    );
    const physicalAtStructures = [false, false, false];
    let previousLeader = { ...traffic.raceStates[0]!.position };
    let firstWreck: string | undefined;
    for (let step = 0; step < lapSteps; step++) {
      let playerSpeed = 42;
      if (step < 25 * 120) {
        const along = poseAt(
          map.path!,
          map.path!.length - 65 + (step * 42) / 120,
        );
        playerPose.x = along.x;
        playerPose.z = along.z;
      } else {
        const leader = traffic.raceStates[0]!;
        playerPose.x = leader.position.x - leader.forward.x * 80;
        playerPose.z = leader.position.z - leader.forward.z * 80;
        playerSpeed = 50;
      }
      traffic.preStep(1 / 120, playerPose, playerSpeed);
      world.step(1 / 120);
      traffic.postStep();
      const leader = traffic.raceStates[0]!;
      leaderDistance += Math.hypot(
        leader.position.x - previousLeader.x,
        leader.position.z - previousLeader.z,
      );
      previousLeader = { ...leader.position };
      if (step % 120 === 0 && leader.bodyId > 0) leaderPhysicalSamples++;
      for (let i = 0; i < structurePoints.length; i++) {
        const point = structurePoints[i]!;
        if (
          leader.bodyId > 0 &&
          Math.hypot(leader.position.x - point.x, leader.position.z - point.z) <
            60
        )
          physicalAtStructures[i] = true;
      }
      const wreck = traffic.raceStates.find((car) => car.wrecked);
      if (wreck && !firstWreck)
        firstWreck = `racer ${wreck.id} after ${(step / 120).toFixed(1)} s`;
    }
    expect(firstWreck).toBeUndefined();
    expect(leaderDistance).toBeGreaterThan(map.path!.length * 0.95);
    expect(leaderPhysicalSamples).toBeGreaterThan(100);
    expect(physicalAtStructures.slice(0, 2)).toEqual([true, true]);
    expect(traffic.raceStates.some((car) => car.speed > 15)).toBe(true);
    expect(traffic.raceStates.every((car) => !car.wrecked)).toBe(true);
    traffic.resetRaceGrid();
    playerPose.x = spawn.x;
    playerPose.z = spawn.z;
    expect(traffic.raceStates.map((car) => car.id)).toEqual(ids);
    expect(traffic.raceStates.every((car) => car.speed === 0)).toBe(true);
    traffic.preStep(1 / 120, playerPose, 0);
    world.step(1 / 120);
    traffic.postStep();
    expect(traffic.raceStates.every((car) => car.bodyId > 0)).toBe(true);
    expect(gridContacts).toBe(0);
  } finally {
    traffic.dispose();
    bodies.dispose();
    world.dispose();
  }
}, 120_000);

it('keeps an occupied racer and civilian on the marked hard-loop bypass', async () => {
  const world = await createPhysicsWorld({ wasmPath });
  world.setGravity(20);
  world.createStaticBox({ x: 0, y: -0.5, z: 0 }, { x: 3200, y: 0.5, z: 3200 });
  const map = MAPS['circuit-race'];
  const bodies = createSurfacedBodies(world, createSurfaceRegistry());
  installLoops(bodies, [map.loops[1]!]);
  const racerRecord = map.traffic!.find((car) => car.raceEntrant)!;
  const records = [
    { ...racerRecord, station: 8500 },
    ...map.traffic!.filter(
      (car) => !car.raceEntrant && car.station >= 8500 && car.station < 8700,
    ),
  ];
  const traffic = createTraffic(world, bodies, map.path!, records, {
    density: 0.85,
    minGap: 12,
    maxGap: 36,
  });
  const player = { x: 0, y: 1, z: 0 };
  let physicalAtLip = false;
  let minDistance = Infinity;
  const lip = poseAt(map.path!, 8900);
  try {
    traffic.setRaceRunning(true);
    for (let step = 0; step < 14 * 120; step++) {
      const racer = traffic.raceStates[0]!;
      player.x = racer.position.x - racer.forward.x * 80;
      player.z = racer.position.z - racer.forward.z * 80;
      traffic.preStep(1 / 120, player, 50);
      world.step(1 / 120);
      traffic.postStep();
      const distance = Math.hypot(
        racer.position.x - lip.x,
        racer.position.z - lip.z,
      );
      minDistance = Math.min(minDistance, distance);
      if (distance < 60 && racer.bodyId > 0) physicalAtLip = true;
    }
    expect(minDistance).toBeLessThan(60);
    expect(physicalAtLip).toBe(true);
    expect(traffic.raceStates[0]!.wrecked).toBe(false);
  } finally {
    traffic.dispose();
    bodies.dispose();
    world.dispose();
  }
}, 30_000);
