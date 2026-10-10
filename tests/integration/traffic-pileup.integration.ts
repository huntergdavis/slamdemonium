import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
import { createPhysicsWorld } from '../../src/physics/joltWorld';
import { sampleRoad } from '../../src/world/roadGenerator';
import { createSurfacedBodies } from '../../src/world/surfacedBodies';
import { createSurfaceRegistry } from '../../src/world/surfaceRegistry';
import { createTraffic, type TrafficCarRecord } from '../../src/world/traffic';

const wasmPath = createRequire(import.meta.url).resolve(
  'jolt-physics/jolt-physics.wasm.wasm',
);
const DT = 1 / 120;
const PLAYER = { x: 30, y: 0.8, z: -170 };
const HARD_HIT = {
  approachSpeed: 25,
  energy: 343750,
  severity: 1,
  estimated: true,
};

async function fixture(records: readonly TrafficCarRecord[]) {
  const world = await createPhysicsWorld({ wasmPath });
  world.setGravity(20);
  world.createStaticBox({ x: 0, y: -0.5, z: -200 }, { x: 100, y: 0.5, z: 350 });
  const bodies = createSurfacedBodies(world, createSurfaceRegistry());
  const path = sampleRoad([{ kind: 'straight', length: 400 }]);
  const traffic = createTraffic(world, bodies, path, records);
  const player = { ...PLAYER };
  const carContacts = new Set<string>();
  world.onContact((a, b, _impulse, _point, normal, velocities) => {
    const carA = traffic.states.find((car) => car.bodyId === a);
    const carB = traffic.states.find((car) => car.bodyId === b);
    if (carA && carB)
      carContacts.add(
        `${Math.min(carA.id, carB.id)}:${Math.max(carA.id, carB.id)}`,
      );
    traffic.onWorldContact(a, b, normal, velocities);
  });
  const step = () => {
    traffic.preStep(DT, player);
    world.step(DT);
    traffic.postStep();
  };
  return {
    world,
    traffic,
    player,
    carContacts,
    step,
    dispose() {
      traffic.dispose();
      bodies.dispose();
      world.dispose();
    },
  };
}

it('queues or collides through ten seeded five-wreck pileups without a ghost pass', async () => {
  for (let seed = 0; seed < 10; seed++) {
    const frontStation = 154 + (seed % 5) * 2;
    const records: TrafficCarRecord[] = [
      ...Array.from({ length: 5 }, (_, i) => ({
        station: 180 + 12 * i,
        laneSide: -1 as const,
        speed: 0,
        modelKind: 'sedan' as const,
      })),
      ...Array.from({ length: 8 }, (_, i) => ({
        station: frontStation - 20 * i,
        laneSide: -1 as const,
        speed: i === 0 ? 36 + (seed % 3) * 3 : 20 + ((seed + i) % 4),
        modelKind: 'sedan' as const,
      })),
    ];
    const run = await fixture(records);
    try {
      run.traffic.preStep(DT, PLAYER);
      const initial = [...run.traffic.states];
      for (const wreck of initial.slice(0, 5)) {
        expect(wreck.bodyId).toBeGreaterThan(0);
        run.traffic.onPlayerContact(wreck.bodyId, HARD_HIT);
        run.world.setLinearVelocity(wreck.bodyId, { x: 0, y: 0, z: 0 });
      }
      run.traffic.setRules({ density: 1, minGap: 12, maxGap: 12 });
      const queuedIds = new Set<number>();
      let ghostPasses = 0;
      for (let frame = 0; frame < 8 * 120; frame++) {
        run.step();
        const states = run.traffic.states;
        const wrecks = states.filter((state) => state.wrecked);
        for (const car of initial.slice(5)) {
          if (!states.includes(car)) continue;
          if (car.wrecked) continue;
          if (
            car.speed < 2 &&
            wrecks.some(
              (wreck) =>
                Math.abs(car.position.x - wreck.position.x) < 3 &&
                car.position.z > wreck.position.z &&
                car.position.z - wreck.position.z < 100,
            )
          )
            queuedIds.add(car.id);
          if (car.bodyId === -1) {
            const overlap = wrecks.find(
              (wreck) =>
                Math.abs(car.position.x - wreck.position.x) < 3 &&
                Math.abs(car.position.z - wreck.position.z) < 4.5,
            );
            if (overlap) ghostPasses++;
          }
          for (const wreck of wrecks) {
            if (
              wreck.id >= car.id ||
              Math.abs(car.position.x - wreck.position.x) >= 3 ||
              car.position.z >= wreck.position.z - 4.5
            )
              continue;
            if (!run.carContacts.has(`${wreck.id}:${car.id}`)) ghostPasses++;
          }
        }
      }
      expect(ghostPasses, `seed ${seed}`).toBe(0);
      const impacts = initial.slice(5).filter((car) => car.wrecked).length;
      expect(
        queuedIds.size,
        `seed ${seed} must queue more than it wrecks`,
      ).toBeGreaterThan(impacts);
      expect(impacts, `seed ${seed} must have a plough-in`).toBeGreaterThan(0);
    } finally {
      run.dispose();
    }
  }
}, 300_000);

it('queues behind a thirteen-wreck pile even when the physical pool is full', async () => {
  const farWrecks: TrafficCarRecord[] = [
    ...Array.from({ length: 6 }, (_, i) => ({
      station: 224 + 10 * i,
      laneSide: -1 as const,
      speed: 0,
      modelKind: 'sedan' as const,
    })),
    ...Array.from({ length: 6 }, (_, i) => ({
      station: 224 + 10 * i,
      laneSide: 1 as const,
      speed: 0,
      modelKind: 'sedan' as const,
    })),
  ];
  const run = await fixture([
    { station: 180, laneSide: -1, speed: 0, modelKind: 'sedan' },
    ...farWrecks,
    { station: 40, laneSide: -1, speed: 45, modelKind: 'sedan' },
  ]);
  try {
    run.player.z = -180;
    run.traffic.preStep(DT, run.player);
    const cars = [...run.traffic.states];
    const target = cars[0]!;
    const follower = cars.at(-1)!;
    for (const wreck of cars.slice(0, 12)) {
      expect(wreck.bodyId).toBeGreaterThan(0);
      run.traffic.onPlayerContact(wreck.bodyId, HARD_HIT);
      run.world.setLinearVelocity(wreck.bodyId, { x: 0, y: 0, z: 0 });
    }
    run.player.z = -385;
    run.step();
    expect(target.bodyId).toBe(-1);
    const thirteenth = cars[12]!;
    expect(thirteenth.bodyId).toBeGreaterThan(0);
    run.traffic.onPlayerContact(thirteenth.bodyId, HARD_HIT);
    run.world.setLinearVelocity(thirteenth.bodyId, { x: 0, y: 0, z: 0 });
    run.player.z = -100;
    run.step();
    expect(cars.slice(0, 13).filter((car) => car.wrecked)).toHaveLength(13);
    expect(cars.filter((car) => car.bodyId > 0)).toHaveLength(12);
    expect(target.bodyId).toBe(-1);
    let ghostPasses = 0;
    let queued = false;
    for (let frame = 0; frame < 12 * 120; frame++) {
      run.step();
      expect(cars.filter((car) => car.bodyId > 0).length).toBeLessThanOrEqual(
        12,
      );
      const sameLane = Math.abs(follower.position.x - target.position.x) < 3.5;
      if (!sameLane || follower.wrecked) continue;
      if (follower.speed < 2 && follower.position.z > target.position.z)
        queued = true;
      if (
        (follower.bodyId === -1 || target.bodyId === -1) &&
        Math.abs(follower.position.z - target.position.z) < 7
      )
        ghostPasses++;
      if (
        follower.position.z < target.position.z - 7 &&
        !run.carContacts.has(`${target.id}:${follower.id}`)
      )
        ghostPasses++;
    }
    expect(ghostPasses).toBe(0);
    expect(
      queued,
      JSON.stringify({
        followerZ: follower.position.z,
        followerSpeed: follower.speed,
        followerWrecked: follower.wrecked,
        followerBodyId: follower.bodyId,
        targetZ: target.position.z,
        targetBodyId: target.bodyId,
        contacted: run.carContacts.has(`${target.id}:${follower.id}`),
      }),
    ).toBe(true);
  } finally {
    run.dispose();
  }
}, 300_000);

it('holds a follower before a wreck more than 120 m ahead', async () => {
  const run = await fixture([
    { station: 190, laneSide: -1, speed: 0, modelKind: 'sedan' },
    { station: 110, laneSide: -1, speed: 40, modelKind: 'sedan' },
  ]);
  try {
    run.player.z = -190;
    run.traffic.preStep(DT, run.player);
    const [wreck, follower] = run.traffic.states;
    run.traffic.onPlayerContact(wreck!.bodyId, HARD_HIT);
    run.world.setLinearVelocity(wreck!.bodyId, { x: 0, y: 0, z: 0 });
    run.player.z = 40;
    run.step();
    expect(Math.abs(run.player.z - wreck!.position.z)).toBeGreaterThan(220);
    expect(wreck!.bodyId).toBe(-1);
    let ghostPasses = 0;
    for (let frame = 0; frame < 8 * 120; frame++) {
      run.step();
      if (follower!.wrecked) continue;
      if (
        (follower!.bodyId === -1 || wreck!.bodyId === -1) &&
        Math.abs(follower!.position.x - wreck!.position.x) < 3.5 &&
        Math.abs(follower!.position.z - wreck!.position.z) < 7
      )
        ghostPasses++;
      if (
        follower!.position.z < wreck!.position.z - 7 &&
        !run.carContacts.has(`${wreck!.id}:${follower!.id}`)
      )
        ghostPasses++;
    }
    expect(ghostPasses).toBe(0);
    expect(follower!.speed).toBeLessThan(3);
    run.player.z = -120;
    for (let frame = 0; frame < 120; frame++) run.step();
    expect(wreck!.bodyId).toBeGreaterThan(0);
    expect(follower!.position.z).toBeGreaterThan(wreck!.position.z + 7);
  } finally {
    run.dispose();
  }
}, 300_000);

it('releases a queue when the wreck moves clear of the lane', async () => {
  const run = await fixture([
    { station: 180, laneSide: -1, speed: 0, modelKind: 'sedan' },
    { station: 100, laneSide: -1, speed: 22, modelKind: 'sedan' },
  ]);
  try {
    run.traffic.preStep(DT, PLAYER);
    const [wreck, follower] = run.traffic.states;
    run.traffic.onPlayerContact(wreck!.bodyId, HARD_HIT);
    run.world.setLinearVelocity(wreck!.bodyId, { x: 0, y: 0, z: 0 });
    run.traffic.setRules({ density: 1, minGap: 12, maxGap: 12 });
    for (let frame = 0; frame < 5 * 120; frame++) run.step();
    expect(follower!.wrecked).toBe(false);
    expect(follower!.speed).toBeLessThan(3);
    const stoppedZ = follower!.position.z;
    run.world.setTransform(
      wreck!.bodyId,
      { x: 30, y: wreck!.position.y, z: wreck!.position.z },
      wreck!.rotation,
      true,
    );
    run.traffic.postStep();
    for (let frame = 0; frame < 3 * 120; frame++) run.step();
    expect(follower!.speed).toBeGreaterThan(5);
    expect(follower!.position.z).toBeLessThan(stoppedZ - 5);
  } finally {
    run.dispose();
  }
}, 300_000);
