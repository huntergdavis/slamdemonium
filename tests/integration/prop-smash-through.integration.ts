import { createRequire } from 'node:module';
import { afterEach, expect, it } from 'vitest';
import {
  createImpactSeverity,
  estimateImpactSeverity,
} from '../../src/core/impactSeverity';
import type { IPhysicsWorld } from '../../src/physics/adapter';
import { createPhysicsWorld } from '../../src/physics/joltWorld';
import { createPropPools } from '../../src/world/bodyPool';
import { createBreakableProps } from '../../src/world/breakableProps';
import { createSurfaceRegistry } from '../../src/world/surfaceRegistry';
import { createSurfacedBodies } from '../../src/world/surfacedBodies';
import { measurements } from './runner';

const wasmPath = createRequire(import.meta.url).resolve(
  'jolt-physics/jolt-physics.wasm.wasm',
);
const HZ = 120;
const CAR_MASS = 1300;
const worlds: IPhysicsWorld[] = [];
afterEach(() => {
  for (const world of worlds) world.dispose();
  worlds.length = 0;
});

/** A car-sized box driven at a single authored prop through the real pool,
 * facade and breakable lifecycle, wired the way boot wires them: the contact
 * callback only copies scalars and the pre-step velocity, and the break is
 * processed after the step. Returns what happened to the car and the prop. */
async function drive(speed: number, gapMetres: number, seconds: number) {
  const world = await createPhysicsWorld({ wasmPath });
  worlds.push(world);
  world.createStaticBox({ x: 0, y: -0.5, z: 0 }, { x: 200, y: 0.5, z: 200 });
  const car = world.createDynamicBox({
    center: { x: 0, y: 0.6, z: 0 },
    halfExtents: { x: 0.9, y: 0.5, z: 2 },
    mass: CAR_MASS,
    comOffset: { x: 0, y: 0, z: 0 },
    inertiaScale: { x: 1, y: 1, z: 1 },
    friction: 0, // A sliding box, so ground friction cannot hide in the result.
    restitution: 0,
    ccd: false,
    maxAngularVelocity: 12,
    angularDamping: 0,
  });
  const bodies = createSurfacedBodies(world, createSurfaceRegistry());
  const pools = createPropPools(bodies);
  const propZ = -(2.5 + gapMetres); // Car nose is at -2; the prop face at propZ + 0.5.
  const props = createBreakableProps({
    physics: world,
    pools,
    placements: [
      {
        position: { x: 0, y: 0.5, z: propZ },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
      },
    ],
    vehicleBody: car,
  });
  const ids = new Float64Array(pools.breakables.capacity);
  const debris = new Float64Array(pools.debris.capacity);
  props.copyActivePropIds(ids);
  const propId = ids[0]!;
  const preStep = { x: 0, y: 0, z: 0 };
  const velocity = { x: 0, y: 0, z: 0 };
  const position = { x: 0, y: 0, z: 0 };
  const rotation = { x: 0, y: 0, z: 0, w: 1 };
  const normal = { x: 0, y: 0, z: 0 };
  const impact = createImpactSeverity();
  let propContacts = 0;
  // Inside world.step: copy scalars only. A world getter here would take a
  // body lock the solver already holds and hang single-threaded WASM.
  world.onContact((a, b, impulse, point, hitNormal) => {
    if (a !== car && b !== car) return;
    if (a === propId || b === propId) propContacts++;
    const direction = a === car ? -1 : 1;
    normal.x = hitNormal.x * direction;
    normal.y = hitNormal.y * direction;
    normal.z = hitNormal.z * direction;
    estimateImpactSeverity(impulse, preStep, normal, CAR_MASS, impact);
    props.onContact(a, b, point, normal, preStep, impact);
  });
  world.setLinearVelocity(car, { x: 0, y: 0, z: -speed });
  let minSpeed = speed;
  let propPushed = 0;
  let peakDebris = 0;
  for (let step = 0; step < seconds * HZ; step++) {
    world.getLinearVelocity(car, preStep);
    world.step(1 / HZ);
    props.update(1 / HZ);
    world.getLinearVelocity(car, velocity);
    minSpeed = Math.min(minSpeed, -velocity.z);
    peakDebris = Math.max(peakDebris, props.copyActiveFragmentIds(debris));
    if (props.copyActivePropIds(ids) > 0) {
      world.getTransform(propId, position, rotation);
      propPushed = Math.max(propPushed, Math.abs(position.z - propZ));
    }
  }
  const broke = props.copyActivePropIds(ids) === 0;
  props.dispose();
  pools.dispose();
  bodies.dispose();
  return {
    speedLoss: speed - minSpeed,
    propContacts,
    broke,
    propPushed,
    peakDebris,
  };
}

/** The defect the CTO found himself: a breakable that is a static body stops
 * the car dead (30 m/s to 0 on the old code, measured) because the immovable
 * collision response is solved inside the step, before any deferred break.
 * The fake-pool unit tests cannot see that; only the real engine can. */
it('lets a car smash through a prop at 30 m/s losing under a metre per second, fragments included', async () => {
  const hit = await drive(30, 9.5, 2);
  measurements.propSmashThrough = {
    ...(measurements.propSmashThrough as object),
    hit,
  };
  expect(hit.propContacts).toBeGreaterThan(0);
  expect(hit.broke).toBe(true);
  expect(hit.peakDebris).toBe(8);
  expect(hit.speedLoss).toBeLessThan(1);
});

it('lets a slow nudge shove an intact prop instead of checking the car', async () => {
  const nudge = await drive(2.5, 2, 3);
  measurements.propSmashThrough = {
    ...(measurements.propSmashThrough as object),
    nudge,
  };
  expect(nudge.propContacts).toBeGreaterThan(0);
  expect(nudge.broke).toBe(false); // Below the break threshold.
  expect(nudge.propPushed).toBeGreaterThan(1); // The box moved, the car did not stop.
  expect(nudge.speedLoss).toBeLessThan(0.5);
});
