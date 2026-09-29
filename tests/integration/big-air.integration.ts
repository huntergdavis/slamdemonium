import { expect, it } from 'vitest';
import { PROVING_GROUND_MAP } from '../../src/world/maps';
import { installRamps } from '../../src/world/ramps';
import { scriptVehicleHarness } from '../scriptVehicleHarness';

const HZ = 120;
const PAD = {
  brake: 0,
  steer: 0,
  handbrake: false,
  source: 'gamepad' as const,
  boost: false,
};

/** Drives the giant ramp (or a ring ramp) at speed and returns the flight
 * and what it paid into the boost meter. */
async function jump(rampIndex: number, speed: number) {
  const rig = await scriptVehicleHarness({ flatPlane: true });
  try {
    const { vehicle, loop, setPad, surfacedBodies, world } = rig;
    const s = vehicle.telemetry;
    const ramp = PROVING_GROUND_MAP.ramps[rampIndex]!;
    installRamps(surfacedBodies, [ramp]);
    const f = { x: -Math.sin(ramp.heading), z: -Math.cos(ramp.heading) };
    vehicle.respawn(
      { x: ramp.x - f.x * 80, y: 0.86, z: ramp.z - f.z * 80 },
      {
        x: 0,
        y: Math.sin(ramp.heading / 2),
        z: 0,
        w: Math.cos(ramp.heading / 2),
      },
    );
    world.setLinearVelocity(vehicle.body, {
      x: f.x * speed,
      y: 0,
      z: f.z * speed,
    });
    setPad({ ...PAD, throttle: 1 });
    let airTime = 0;
    let launchVy = 0;
    for (let step = 0; step < 10 * HZ; step++) {
      loop.stepMany(1);
      if (s.airLaunch.active) launchVy = s.airLaunch.velocity.y;
      if (s.airborne) airTime = Math.max(airTime, s.airTime);
      if (s.landingCount > 0) break;
    }
    return {
      airTime,
      launchVy,
      meter: s.boostMeter,
      landed: s.landingCount > 0,
    };
  } finally {
    rig.dispose();
  }
}

/** Rolls off the edge of a 3 m platform at a walking pace: a fall, not a jump. */
async function ledge() {
  const rig = await scriptVehicleHarness({ flatPlane: true });
  try {
    const { vehicle, loop, setPad, world } = rig;
    const s = vehicle.telemetry;
    world.createStaticBox({ x: 0, y: 1.5, z: 0 }, { x: 20, y: 1.5, z: 20 });
    vehicle.respawn({ x: 0, y: 3.86, z: 0 }, { x: 0, y: 1, z: 0, w: 0 });
    world.setLinearVelocity(vehicle.body, { x: 0, y: 0, z: 8 });
    setPad({ ...PAD, throttle: 0.3 });
    let airTime = 0;
    let launchVy = 0;
    let launched = false;
    for (let step = 0; step < 8 * HZ; step++) {
      loop.stepMany(1);
      if (s.airLaunch.active) {
        launched = true;
        launchVy = s.airLaunch.velocity.y;
      }
      if (s.airborne) airTime = Math.max(airTime, s.airTime);
      if (s.landingCount > 0) break;
    }
    return { airTime, launchVy, launched, meter: s.boostMeter };
  } finally {
    rig.dispose();
  }
}

it('big air: the giant ramp pays about a third of a bar at cruise and about half boosted, a small ramp a few percent', async () => {
  const cruise = await jump(0, 60);
  expect(cruise.landed).toBe(true);
  expect(cruise.launchVy).toBeGreaterThan(5);
  expect(cruise.airTime).toBeGreaterThan(1.4);
  // Quadratic in airtime: rate * t^2 / 2 at 0.25, within the step lag.
  expect(cruise.meter).toBeGreaterThan(0.25);
  expect(cruise.meter).toBeLessThan(0.42);
  const boosted = await jump(0, 85);
  expect(boosted.meter).toBeGreaterThan(cruise.meter);
  expect(boosted.meter).toBeGreaterThan(0.45);
  const small = await jump(1, 40);
  expect(small.meter).toBeGreaterThan(0.03);
  expect(small.meter).toBeLessThan(0.12);
  expect(cruise.meter / small.meter).toBeGreaterThan(3);
}, 300_000);

it('big air: rolling off a ledge is a fall, not a jump, and pays nothing', async () => {
  const fall = await ledge();
  expect(fall.launched).toBe(true);
  expect(fall.launchVy).toBeLessThanOrEqual(0);
  expect(fall.airTime).toBeGreaterThan(0.3); // A real drop (3 m is 0.39 s at gravity 20).
  expect(fall.meter).toBe(0);
}, 300_000);
