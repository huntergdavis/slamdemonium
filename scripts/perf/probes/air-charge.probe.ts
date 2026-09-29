/* Big air (2026-09-28): what flights actually look like, so the boost
 * charge for airtime can be set against numbers. The giant ramp at three
 * speeds and a small ring ramp, on the real vehicle: airtime, launch
 * vertical speed from the #158 seam, apex above the launch point, and what
 * each pays under today's flat rate and under the candidate shapes. */
import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { PROVING_GROUND_MAP } from '../../../src/world/maps';
import { installRamps } from '../../../src/world/ramps';
import { scriptVehicleHarness } from '../../../tests/scriptVehicleHarness';

const HZ = 120;
const PAD = {
  brake: 0,
  steer: 0,
  handbrake: false,
  source: 'gamepad' as const,
  boost: false,
};

async function flight(rampIndex: number, speed: number) {
  const rig = await scriptVehicleHarness({ flatPlane: true });
  try {
    const { vehicle, loop, setPad, surfacedBodies, world } = rig;
    const s = vehicle.telemetry;
    const ramp = PROVING_GROUND_MAP.ramps[rampIndex]!;
    installRamps(surfacedBodies, [ramp]);
    // Approach along the ramp's heading from 80 m short of its low edge.
    const f = { x: -Math.sin(ramp.heading), z: -Math.cos(ramp.heading) };
    const start = { x: ramp.x - f.x * 80, y: 0.86, z: ramp.z - f.z * 80 };
    vehicle.respawn(start, {
      x: 0,
      y: Math.sin(ramp.heading / 2),
      z: 0,
      w: Math.cos(ramp.heading / 2),
    });
    world.setLinearVelocity(vehicle.body, {
      x: f.x * speed,
      y: 0,
      z: f.z * speed,
    });
    setPad({ ...PAD, throttle: 1 });
    let airTime = 0,
      launchVy = 0,
      launchY = 0,
      apex = -Infinity,
      launched = false;
    for (let step = 0; step < 10 * HZ; step++) {
      loop.stepMany(1);
      if (s.airLaunch.active) {
        launched = true;
        launchVy = s.airLaunch.velocity.y;
        launchY = s.airLaunch.position.y;
      }
      if (s.airborne) {
        airTime = Math.max(airTime, s.airTime);
        apex = Math.max(apex, s.position.y);
      }
      if (s.landingCount > 0) break;
    }
    return {
      ramp: rampIndex,
      speed,
      launched,
      launchVy: +launchVy.toFixed(2),
      apexAboveLaunch: +(apex - launchY).toFixed(2),
      airTime: +airTime.toFixed(3),
      landed: s.landingCount > 0,
    };
  } finally {
    rig.dispose();
  }
}

it('big air: flights on the real vehicle', async () => {
  const runs = [];
  for (const [ramp, speed] of [
    [0, 40],
    [0, 60],
    [0, 85],
    [1, 30],
    [1, 50],
    [3, 40],
  ] as const)
    runs.push(await flight(ramp, speed));
  const payouts = runs.map((r) => ({
    ...r,
    today_flat_0_02: +(0.02 * r.airTime).toFixed(3),
    flat_0_15: +(0.15 * r.airTime).toFixed(3),
    quadratic_0_25: +((0.25 * r.airTime * r.airTime) / 2).toFixed(3),
    quadratic_0_25_gated_vy2:
      r.launchVy >= 2 ? +((0.25 * r.airTime * r.airTime) / 2).toFixed(3) : 0,
  }));
  console.log(JSON.stringify(payouts, null, 1));
  writeFileSync(
    'scratch/air-charge-probe.json',
    JSON.stringify(payouts, null, 1),
  );
}, 600_000);
