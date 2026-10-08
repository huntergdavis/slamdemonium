import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
import { InstancedMesh, Scene } from 'three';
import { createPhysicsWorld } from '../../src/physics/joltWorld';
import { sampleRoad } from '../../src/world/roadGenerator';
import { createSurfaceRegistry } from '../../src/world/surfaceRegistry';
import { createSurfacedBodies } from '../../src/world/surfacedBodies';
import { createTraffic, createTrafficVisual } from '../../src/world/traffic';
import { createTakedownMap } from '../../src/world/takedownCourse';
import { createImpactSeverity } from '../../src/core/impactSeverity';
import { poseAt } from '../../src/world/roadGenerator';

const wasmPath = createRequire(import.meta.url).resolve(
  'jolt-physics/jolt-physics.wasm.wasm',
);

it('keeps rivals rendered between 120 and 240 Hz physics updates', async () => {
  const world = await createPhysicsWorld({ wasmPath });
  const bodies = createSurfacedBodies(world, createSurfaceRegistry());
  const map = createTakedownMap();
  const scene = new Scene();
  const traffic = createTraffic(
    world,
    bodies,
    map.path!,
    map.traffic!.filter((car) => car.rival),
  );
  const visual = createTrafficVisual(scene, traffic);
  const player = { x: map.spawn!.x, y: 1, z: map.spawn!.z };
  try {
    for (const hz of [120, 240]) {
      for (let step = 0; step < 30; step++) {
        traffic.preStep(1 / hz, player, 35);
        world.step(1 / hz);
        traffic.postStep();
        expect(traffic.visualStates.filter((car) => car.rival)).toHaveLength(4);
        // Render frames without a physics step must reuse the current visual
        // state rather than emptying or culling the catalogue instances.
        for (let frame = 0; frame < 3; frame++) {
          visual.update();
          const live = scene.children
            .filter(
              (child): child is InstancedMesh => child instanceof InstancedMesh,
            )
            .some((mesh) => mesh.count > 0);
          expect(live).toBe(true);
        }
      }
    }
  } finally {
    visual.dispose();
    traffic.dispose();
    bodies.dispose();
    world.dispose();
  }
}, 60_000);

async function drive(rival: boolean) {
  const world = await createPhysicsWorld({ wasmPath });
  world.setGravity(20);
  world.createStaticBox({ x: 0, y: -0.5, z: 250 }, { x: 200, y: 0.5, z: 400 });
  const bodies = createSurfacedBodies(world, createSurfaceRegistry());
  const path = sampleRoad([{ kind: 'straight', length: 500 }], {
    x: 0,
    z: 0,
    heading: Math.PI,
  });
  const traffic = createTraffic(world, bodies, path, [
    { station: 100, laneSide: -1, speed: 35, modelKind: 'sedan', rival },
  ]);
  try {
    const player = { x: -10, y: 1, z: 100 };
    let nearest = Infinity;
    for (let i = 0; i < 120; i++) {
      const car = traffic.states[0];
      if (car) player.z = car.position.z;
      traffic.preStep(1 / 120, player, 35);
      world.step(1 / 120);
      traffic.postStep();
      nearest = Math.min(nearest, traffic.states[0]!.position.x);
    }
    return {
      nearest,
      speed: traffic.states[0]!.speed,
      state: traffic.states[0]!.rival,
    };
  } finally {
    traffic.dispose();
    bodies.dispose();
    world.dispose();
  }
}

it('lets a rival contest the line without changing an ordinary car', async () => {
  const rival = await drive(true);
  const ordinary = await drive(false);
  expect(rival.state).toBe(true);
  expect(ordinary.state).toBe(false);
  expect(rival.nearest).toBeLessThan(ordinary.nearest - 0.5);
  expect(rival.speed).toBeGreaterThan(25);
  expect(ordinary.speed).toBeGreaterThan(25);
}, 60_000);

it('returns a distant rival into physical contest range without changing its encounter', async () => {
  const world = await createPhysicsWorld({ wasmPath });
  const bodies = createSurfacedBodies(world, createSurfaceRegistry());
  const map = createTakedownMap();
  const player = { x: map.spawn!.x, y: 1, z: map.spawn!.z };
  const traffic = createTraffic(world, bodies, map.path!, [
    { station: 620, laneSide: -1, speed: 35, rival: true },
  ]);
  try {
    traffic.preStep(1 / 60, player, 60);
    const car = traffic.states[0]!;
    expect(car).toBeDefined();
    expect(car.id).toBe(1);
    expect(
      Math.hypot(car.position.x - player.x, car.position.z - player.z),
    ).toBeGreaterThan(90);
    expect(
      Math.hypot(car.position.x - player.x, car.position.z - player.z),
    ).toBeLessThan(180);
    expect(car.speed).toBeGreaterThan(60);
    expect(car.bodyId).toBeGreaterThan(0);
  } finally {
    traffic.dispose();
    bodies.dispose();
    world.dispose();
  }
}, 60_000);

it('keeps a visible wreck, then rejoins offscreen with a fresh encounter id', async () => {
  const world = await createPhysicsWorld({ wasmPath });
  const bodies = createSurfacedBodies(world, createSurfaceRegistry());
  const map = createTakedownMap();
  const road = map.path!;
  const atCar = poseAt(road, 140);
  const near = { x: atCar.x, y: 1, z: atCar.z };
  const traffic = createTraffic(world, bodies, road, [
    { station: 140, laneSide: -1, speed: 35, rival: true },
  ]);
  try {
    traffic.preStep(1 / 120, near);
    world.step(1 / 120);
    traffic.postStep();
    const car = traffic.states[0]!;
    expect(car.bodyId).toBeGreaterThan(0);
    const impact = createImpactSeverity();
    impact.severity = 1;
    traffic.onPlayerContact(car.bodyId, impact);
    expect(car.wrecked).toBe(true);
    for (let second = 0; second < 9; second++) traffic.preStep(1, near);
    expect(car.wrecked).toBe(true);
    expect(car.id).toBe(1);
    const far = poseAt(road, 1100);
    traffic.preStep(1 / 120, { x: far.x, y: 1, z: far.z });
    expect(car.wrecked).toBe(false);
    expect(car.id).toBe(2);
    expect(
      car.crush.front + car.crush.rear + car.crush.left + car.crush.right,
    ).toBe(0);
  } finally {
    traffic.dispose();
    bodies.dispose();
    world.dispose();
  }
}, 60_000);

it('keeps a rival in shunting range during cruise and boost', async () => {
  const world = await createPhysicsWorld({ wasmPath });
  world.setGravity(20);
  world.createStaticBox({ x: 0, y: -0.5, z: 0 }, { x: 2000, y: 0.5, z: 2000 });
  const bodies = createSurfacedBodies(world, createSurfaceRegistry());
  const map = createTakedownMap();
  const traffic = createTraffic(world, bodies, map.path!, map.traffic!);
  try {
    let distanceAlong = 0;
    for (const speed of [35, 60]) {
      let inRange = 0;
      let counted = 0;
      let attackRange = 0;
      let tooFar = 0;
      let visible = 0;
      let closestSeen = Infinity;
      let lastNearest = Infinity;
      let lastCars = '';
      for (let step = 0; step < 15 * 60; step++) {
        const road = poseAt(map.path!, distanceAlong);
        const player = { x: road.x, y: 1, z: road.z };
        traffic.preStep(1 / 60, player, speed);
        world.step(1 / 60);
        traffic.postStep();
        distanceAlong += speed / 60;
        if (step < 2 * 60) continue;
        const nearest = Math.min(
          ...traffic.states
            .filter((car) => car.rival && !car.wrecked)
            .map((car) =>
              Math.hypot(car.position.x - player.x, car.position.z - player.z),
            ),
        );
        if (Number.isFinite(nearest)) visible++;
        closestSeen = Math.min(closestSeen, nearest);
        lastNearest = nearest;
        if (step === 15 * 60 - 1)
          lastCars = traffic.states
            .filter((car) => car.rival)
            .map(
              (car) =>
                `${car.id}:${Math.hypot(car.position.x - player.x, car.position.z - player.z).toFixed(0)}m/${car.wrecked ? 'wreck' : 'live'}`,
            )
            .join(',');
        if (nearest <= 60) inRange++;
        else tooFar++;
        if (nearest < 20) attackRange++;
        counted++;
      }
      expect(
        inRange / counted,
        `${speed} m/s: ${inRange} in range, ${attackRange} in attack range, ${tooFar} too far, ${visible} visible, closest ${closestSeen.toFixed(1)}, last ${lastNearest.toFixed(1)}; ${lastCars}`,
      ).toBeGreaterThan(0.7);
    }
  } finally {
    traffic.dispose();
    bodies.dispose();
    world.dispose();
  }
}, 60_000);

it('gives the pack its own speed burst and lets rivals hit each other', async () => {
  const world = await createPhysicsWorld({ wasmPath });
  world.setGravity(20);
  world.createStaticBox({ x: 0, y: -0.5, z: 0 }, { x: 2000, y: 0.5, z: 2000 });
  const bodies = createSurfacedBodies(world, createSurfaceRegistry());
  const map = createTakedownMap();
  const traffic = createTraffic(
    world,
    bodies,
    map.path!,
    map.traffic!.filter((car) => car.rival),
  );
  let rivalContacts = 0;
  let peakRivalSpeed = 0;
  let rivalWrecks = 0;
  let peakRivalClosing = 0;
  let peakHorizontalClosing = 0;
  const velocityA = { x: 0, y: 0, z: 0 };
  const velocityB = { x: 0, y: 0, z: 0 };
  world.onContact((a, b, _impulse, _point, normal, readVelocities) => {
    const first = traffic.stateForBody(a);
    const second = traffic.stateForBody(b);
    if (first?.rival && second?.rival) {
      rivalContacts++;
      readVelocities(velocityA, velocityB);
      peakRivalClosing = Math.max(
        peakRivalClosing,
        (velocityA.x - velocityB.x) * normal.x +
          (velocityA.y - velocityB.y) * normal.y +
          (velocityA.z - velocityB.z) * normal.z,
      );
      if (Math.hypot(normal.x, normal.z) >= 0.7)
        peakHorizontalClosing = Math.max(
          peakHorizontalClosing,
          (velocityA.x - velocityB.x) * normal.x +
            (velocityA.y - velocityB.y) * normal.y +
            (velocityA.z - velocityB.z) * normal.z,
        );
    }
    traffic.onWorldContact(a, b, normal, readVelocities);
  });
  try {
    let station = 0;
    for (let step = 0; step < 12 * 120; step++) {
      const road = poseAt(map.path!, station);
      traffic.preStep(1 / 120, { x: road.x, y: 1, z: road.z }, 35);
      world.step(1 / 120);
      traffic.postStep();
      station += 35 / 120;
      for (const car of traffic.states)
        if (car.rival) {
          peakRivalSpeed = Math.max(peakRivalSpeed, car.speed);
          if (car.wrecked) rivalWrecks++;
        }
    }
    expect(peakRivalSpeed).toBeGreaterThan(75);
    expect(rivalContacts).toBeGreaterThan(0);
    expect(
      rivalWrecks,
      `peak closing ${peakRivalClosing.toFixed(2)} m/s, horizontal ${peakHorizontalClosing.toFixed(2)} m/s`,
    ).toBeGreaterThan(0);
  } finally {
    traffic.dispose();
    bodies.dispose();
    world.dispose();
  }
}, 60_000);

it('keeps the solved car pose continuous when a lagging rival demotes', async () => {
  const world = await createPhysicsWorld({ wasmPath });
  world.setGravity(20);
  world.createStaticBox({ x: 0, y: -0.5, z: 0 }, { x: 2000, y: 0.5, z: 2000 });
  const bodies = createSurfacedBodies(world, createSurfaceRegistry());
  const map = createTakedownMap();
  const path = map.path!;
  const ahead = poseAt(path, 200);
  const behind = poseAt(path, 10);
  const player = { x: ahead.x, y: 1, z: ahead.z };
  const traffic = createTraffic(world, bodies, path, [
    { station: 200, laneSide: -1, speed: 35, rival: true },
  ]);
  try {
    traffic.preStep(1 / 120, player, 35);
    world.step(1 / 120);
    traffic.postStep();
    const car = traffic.states[0]!;
    expect(car.bodyId).toBeGreaterThan(0);
    world.activateBody(
      car.bodyId,
      { x: car.position.x, y: car.position.y, z: behind.z },
      car.rotation,
      true,
    );
    world.step(1 / 120);
    traffic.postStep();
    const before = { ...car.position };
    traffic.preStep(1 / 120, player, 35);
    expect(car.bodyId).toBe(-1);
    expect(
      Math.hypot(car.position.x - before.x, car.position.z - before.z),
    ).toBeLessThan(10);
  } finally {
    traffic.dispose();
    bodies.dispose();
    world.dispose();
  }
}, 60_000);
