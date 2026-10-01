import { createRequire } from 'node:module';
import { afterEach, expect, it } from 'vitest';
import { createTrafficEvents } from '../../src/core/trafficEvents';
import type { IPhysicsWorld } from '../../src/physics/adapter';
import { createPhysicsWorld } from '../../src/physics/joltWorld';
import { sampleRoad } from '../../src/world/roadGenerator';
import { createSurfacedBodies } from '../../src/world/surfacedBodies';
import { createSurfaceRegistry } from '../../src/world/surfaceRegistry';
import { createTraffic } from '../../src/world/traffic';

/** The boost detectors against Codex's real traffic cars: the car's forward,
 * velocity and wrecked flag as the traffic module publishes them, a box as
 * the player, on a straight road. */
const wasmPath = createRequire(import.meta.url).resolve(
  'jolt-physics/jolt-physics.wasm.wasm',
);
const HZ = 120;
const TUNING = {
  nearMissGap: 1.5,
  nearMissClosing: 12,
  nearMissBoost: 0.1,
  wrongSideReach: 60,
  wrongSideRate: 0.08,
  slamBoost: 0.35,
};
const worlds: IPhysicsWorld[] = [];
afterEach(() => {
  for (const world of worlds) world.dispose();
  worlds.length = 0;
});

async function rig() {
  const world = await createPhysicsWorld({ wasmPath });
  worlds.push(world);
  world.setGravity(20);
  world.createStaticBox({ x: 0, y: -0.5, z: 0 }, { x: 300, y: 0.5, z: 600 });
  // A road north from z = -500: heading pi faces +z in this world.
  const path = sampleRoad([{ kind: 'straight', length: 1000 }], {
    x: 0,
    z: -500,
    heading: Math.PI,
  });
  const bodies = createSurfacedBodies(world, createSurfaceRegistry());
  const traffic = createTraffic(world, bodies, path, [
    { station: 300, laneSide: 1, speed: 19 },
  ]);
  const events = createTrafficEvents();
  return { world, traffic, events };
}

/** Steps the world with a kinematic-ish player box moved by velocity. */
function makePlayer(world: IPhysicsWorld, x: number, z: number) {
  const body = world.createDynamicBox({
    center: { x, y: 0.6, z },
    halfExtents: { x: 1, y: 0.5, z: 2.1 },
    mass: 1300,
    comOffset: { x: 0, y: 0, z: 0 },
    inertiaScale: { x: 1, y: 1, z: 1 },
    friction: 0,
    restitution: 0,
    ccd: true,
    maxAngularVelocity: 12,
    angularDamping: 0,
  });
  return body;
}

it('pays wrong-side driving against an oncoming real car, a near miss beside it, and a slam into it', async () => {
  const { world, traffic, events } = await rig();
  const car = traffic.states;
  // 1. Oncoming: the player drives south at 30 m/s down the car's lane line,
  //    3 m beside it, from 200 m north of the car.
  const pos = { x: 0, y: 0, z: 0 };
  const quat = { x: 0, y: 0, z: 0, w: 1 };
  const vel = { x: 0, y: 0, z: 0 };
  const read = (body: number) => {
    world.getTransform(body, pos, quat);
    world.getLinearVelocity(body, vel);
  };
  const laneX = () => car[0]!.position.x;
  const player = makePlayer(world, 0, 0);
  const view = {
    position: { x: 0, z: 0 },
    forward: { x: 0, z: -1 },
    velocity: { x: 0, z: 0 },
    speed: 0,
  };
  const step = (vx: number, vz: number) => {
    world.setLinearVelocity(player, { x: vx, y: 0, z: vz });
    read(player);
    traffic.preStep(1 / HZ, pos);
    world.step(1 / HZ);
    traffic.postStep();
    read(player);
    view.position.x = pos.x;
    view.position.z = pos.z;
    view.velocity.x = vel.x;
    view.velocity.z = vel.z;
    view.speed = Math.hypot(vel.x, vel.z);
    view.forward.x = 0;
    view.forward.z = vz >= 0 ? 1 : -1;
    return events.update(1 / HZ, view, traffic.states, TUNING);
  };
  // Wake the car: a player within 180 m, then place the player 200 m north.
  world.setTransform(player, { x: 3.5, y: 0.6, z: -100 }, quat, true);
  for (let i = 0; i < 30; i++) step(0, 0);
  expect(car).toHaveLength(1);
  expect(car[0]!.forward.z).toBeGreaterThan(0.9); // Northbound.
  world.setTransform(
    player,
    { x: laneX() + 3, y: 0.6, z: car[0]!.position.z + 200 },
    quat,
    true,
  );
  let paid = 0;
  for (let i = 0; i < 6 * HZ; i++) paid += step(0, -30);
  expect(events.state.wrongSideSeconds).toBeGreaterThan(0.8);
  expect(events.state.nearMisses).toBe(1); // The head-on pass is also a near miss.
  expect(paid).toBeCloseTo(
    TUNING.wrongSideRate * events.state.wrongSideSeconds + TUNING.nearMissBoost,
    6,
  );
  // 2. Slam: from behind, into the car, at closing speed; the contact hook
  //    reports the hit, the traffic module wrecks the car in the same step.
  let severity = 0;
  world.onContact((a, b, _impulse, _point, normal) => {
    const other = a === player ? b : a;
    if (other !== car[0]?.bodyId) return;
    severity = Math.min(1, Math.max(0, (Math.abs(normal.z) * 30 - 0.8) / 18));
    traffic.onPlayerContact(other, {
      approachSpeed: 30,
      energy: 0,
      severity,
      estimated: true,
    });
    events.noteContact(other, severity);
  });
  world.setTransform(
    player,
    { x: laneX(), y: 0.6, z: car[0]!.position.z - 40 },
    quat,
    true,
  );
  const before = events.state.slams;
  for (let i = 0; i < 3 * HZ; i++) {
    paid = step(0, 45);
    if (events.state.slams > before) break;
  }
  expect(events.state.slams).toBe(before + 1);
  expect(car[0]!.wrecked).toBe(true);
  expect(paid).toBeCloseTo(TUNING.slamBoost * severity, 6);
  expect(events.state.lastEvent).toBe('slam');
});
