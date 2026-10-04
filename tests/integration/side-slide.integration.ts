import { expect, it } from 'vitest';
import { scriptVehicleHarness } from '../scriptVehicleHarness';

/** The big-air payout charges while airborne. Airborne means nothing of the
 * car touches the world, so a car that comes down on its side and slides is
 * not flying: the bar stops the step the chassis touches the ground. */
const HZ = 120;
const PAD = {
  throttle: 1,
  brake: 0,
  steer: 0,
  handbrake: false,
  boost: false,
  source: 'gamepad' as const,
};
it('stops charging boost on a side landing and rights the moving car', async () => {
  const rig = await scriptVehicleHarness({ flatPlane: true });
  try {
    const { vehicle, loop, setPad, world } = rig;
    const s = vehicle.telemetry;
    vehicle.respawn({ x: 0, y: 1.1, z: 0 }, { x: 0, y: 0, z: 0, w: 1 });
    setPad(PAD);
    loop.stepMany(HZ / 2); // Rolling on four wheels, so the next lift is a launch.
    expect(s.groundedWheels).toBe(4);
    world.setLinearVelocity(vehicle.body, { x: 0, y: 10, z: -40 });
    loop.stepMany(12);
    expect(s.airborne).toBe(true);
    // Roll the car onto its side mid-flight: it comes down on the door.
    const half = Math.SQRT1_2;
    world.setTransform(
      vehicle.body,
      { x: s.position.x, y: 3, z: s.position.z },
      { x: 0, y: 0, z: half, w: half },
      false,
    );
    world.setLinearVelocity(vehicle.body, { x: 0, y: 0, z: -40 });
    world.setAngularVelocity(vehicle.body, { x: 0, y: 0, z: 0 });
    let meterAtTouchdown = -1;
    let touchdownStep = -1;
    let uprightStep = -1;
    let uprightSpeed = 0;
    let meterInFlight = 0;
    for (let step = 0; step < 4 * HZ; step++) {
      loop.stepMany(1);
      if (touchdownStep < 0) {
        meterInFlight = s.boostMeter;
        if (s.landingCount > 0) {
          touchdownStep = step;
          meterAtTouchdown = s.boostMeter;
        }
      } else if (step - touchdownStep === 3 * HZ) break;
      if (touchdownStep >= 0 && uprightStep < 0 && s.groundedWheels >= 3) {
        uprightStep = step;
        uprightSpeed = s.speed;
      }
    }
    expect(touchdownStep).toBeGreaterThan(0);
    expect(meterInFlight).toBeGreaterThan(0); // The launch armed the payout.
    // The side landing ends flight and its payout immediately. Recovery now
    // rights the still-moving car rather than leaving it on its door.
    expect(s.speed).toBeGreaterThan(15);
    expect(uprightStep).toBeGreaterThan(touchdownStep);
    expect(uprightStep - touchdownStep).toBeLessThan(3 * HZ);
    expect(uprightSpeed).toBeGreaterThan(3);
    expect(s.groundedWheels).toBe(4);
    expect(s.airborne).toBe(false);
    expect(s.airTime).toBe(0);
    expect(s.boostMeter).toBeCloseTo(meterAtTouchdown, 2);
    expect(s.boostMeter).toBeLessThan(0.1);
  } finally {
    rig.dispose();
  }
}, 120000);
