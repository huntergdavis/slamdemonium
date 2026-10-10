import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
import { createRaceEvent, type RaceCar } from '../../src/core/raceEvent';
import { createPhysicsWorld } from '../../src/physics/joltWorld';
import { ELIMINATOR_MAP } from '../../src/world/eliminatorCourse';
import { poseAt } from '../../src/world/roadGenerator';
import { createSurfaceRegistry } from '../../src/world/surfaceRegistry';
import { createSurfacedBodies } from '../../src/world/surfacedBodies';
import { createTraffic } from '../../src/world/traffic';

const wasmPath = createRequire(import.meta.url).resolve(
  'jolt-physics/jolt-physics.wasm.wasm',
);

it('runs five validated cuts on the real six-car loop without ghost racers or ambient wrecks', async () => {
  const world = await createPhysicsWorld({ wasmPath });
  world.setGravity(20);
  world.createStaticBox({ x: 0, y: -0.5, z: 0 }, { x: 2200, y: 0.5, z: 2200 });
  const bodies = createSurfacedBodies(world, createSurfaceRegistry());
  const map = ELIMINATOR_MAP;
  const path = map.path!;
  const traffic = createTraffic(world, bodies, path, map.traffic!, {
    density: 1,
    minGap: 12,
    maxGap: 36,
  });
  const race = createRaceEvent(
    map.runs![0]!,
    path,
    traffic.raceStates.map((car) => car.id),
    { mode: 'eliminator', laps: 5 },
  );
  const cars = [0, ...traffic.raceStates.map((car) => car.id)].map(
    (id): RaceCar => ({ id, x: 0, z: 0, vx: 0, vz: 0 }),
  );
  const player = { x: map.spawn!.x, y: 1, z: map.spawn!.z };
  let contactPairs = 0;
  world.onContact((a, b, _impulse, _point, normal, readVelocities) => {
    if (traffic.stateForBody(a) && traffic.stateForBody(b)) contactPairs++;
    traffic.onWorldContact(a, b, normal, readVelocities);
  });
  try {
    const ids = traffic.raceStates.map((car) => car.id);
    for (let step = 0; step < 120; step++) {
      traffic.preStep(1 / 120, player, 0);
      world.step(1 / 120);
      traffic.postStep();
    }
    expect(traffic.raceStates.every((car) => car.bodyId > 0)).toBe(true);
    expect(contactPairs).toBe(0);
    race.update(3, cars);
    traffic.setRaceRunning(true);
    let lastCutId = -1;
    let firstWreck: string | undefined;
    const maxSteps = Math.ceil(((path.length * 5 + 150) / 60) * 120);
    for (let step = 0; step < maxSteps; step++) {
      const station = path.length - 80 + (step * 60) / 120;
      const pose = poseAt(path, station);
      player.x = pose.x;
      player.z = pose.z;
      traffic.preStep(1 / 120, player, 60);
      world.step(1 / 120);
      traffic.postStep();
      const wreck = traffic.raceStates.find((car) => car.wrecked);
      if (wreck && !firstWreck)
        firstWreck = `racer ${wreck.id} at ${(step / 120).toFixed(2)} s`;
      const leader = cars[0]! as {
        x: number;
        z: number;
        vx: number;
        vz: number;
      };
      leader.x = pose.x;
      leader.z = pose.z;
      leader.vx = -Math.sin(pose.heading) * 60;
      leader.vz = -Math.cos(pose.heading) * 60;
      for (let i = 0; i < traffic.raceStates.length; i++) {
        const state = traffic.raceStates[i]!;
        const car = cars[i + 1]! as typeof leader;
        car.x = state.position.x;
        car.z = state.position.z;
        car.vx = state.velocity.x;
        car.vz = state.velocity.z;
      }
      race.update(1 / 120, cars);
      if (race.state.lastCutId > 0 && race.state.lastCutId !== lastCutId) {
        lastCutId = race.state.lastCutId;
        traffic.eliminateRaceEntrant(lastCutId);
        const cut = traffic.raceStates.find((car) => car.id === lastCutId)!;
        expect(cut.bodyId).toBeLessThanOrEqual(0);
        expect(traffic.states.some((car) => car.id === lastCutId)).toBe(false);
      }
      if (race.state.phase === 'finished') break;
    }
    expect(race.state.phase).toBe('finished');
    expect(race.state.won).toBe(true);
    expect(race.state.cutCount).toBe(5);
    expect(race.state.finishOrder[0]).toBe(0);
    expect(race.state.finishOrder).toHaveLength(6);
    expect(new Set(race.state.finishOrder)).toEqual(new Set([0, ...ids]));
    expect(firstWreck).toBeUndefined();
    expect(traffic.raceStates.every((car) => car.bodyId <= 0)).toBe(true);
    traffic.resetRaceGrid();
    race.reset();
    expect(traffic.raceStates.map((car) => car.id)).toEqual(ids);
    expect(
      traffic.raceStates.every((car) => !car.wrecked && car.speed === 0),
    ).toBe(true);
    expect(race.state.remaining).toBe(6);
    player.x = map.spawn!.x;
    player.z = map.spawn!.z;
    for (let step = 0; step < 120; step++) {
      traffic.preStep(1 / 120, player, 0);
      world.step(1 / 120);
      traffic.postStep();
    }
    expect(traffic.raceStates.every((car) => car.bodyId > 0)).toBe(true);
  } finally {
    traffic.dispose();
    bodies.dispose();
    world.dispose();
  }
}, 120_000);
