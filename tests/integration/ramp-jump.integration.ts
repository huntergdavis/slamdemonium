import { expect, it } from 'vitest';
import { SURFACE_IDS } from '../../src/content/surfaces';
import { installRamps, type RampSpec } from '../../src/world/ramps';
import { scriptVehicleHarness } from '../scriptVehicleHarness';

const HZ = 120;

/** The failure this guards against is the one that reads as a physics bug:
 * a ramp without a registered surface gives suspension force and zero tyre
 * force, so the car rides it with no grip, brakes or steering. Through the
 * facade the ramp is asphalt, the car climbs it under power, leaves the
 * ground, and lands as a counted landing with its speed intact. */
it('drives up a ramp with grip, gets airborne, and lands as a counted landing', async () => {
  const rig = await scriptVehicleHarness({ flatPlane: true });
  try {
    const { vehicle, loop, setPad, surfacedBodies } = rig;
    const s = vehicle.telemetry;
    // Straight ahead of the ring spawn (130, 0) driving toward -Z.
    const ramp: RampSpec = {
      x: 130,
      z: -60,
      heading: 0,
      length: 12,
      width: 8,
      rise: 1.6,
    };
    const [rampId] = installRamps(surfacedBodies, [ramp]);
    setPad({
      throttle: 1,
      brake: 0,
      steer: 0,
      handbrake: false,
      boost: false,
      source: 'gamepad',
    });
    let onRampSteps = 0;
    let onRampWithGrip = 0;
    let peakAirTime = 0;
    let speedAtTakeoff = 0;
    for (let step = 0; step < 6 * HZ; step++) {
      loop.stepMany(1);
      for (const wheel of s.wheels)
        if (wheel.grounded && wheel.hit.bodyId === rampId) {
          onRampSteps++;
          if (wheel.surfaceId === SURFACE_IDS.asphalt && wheel.Fz > 0)
            onRampWithGrip++;
        }
      if (s.airborne && s.airTime > peakAirTime) {
        peakAirTime = s.airTime;
        if (speedAtTakeoff === 0) speedAtTakeoff = s.speed;
      }
      if (s.landingCount > 0) break;
    }
    expect(onRampSteps).toBeGreaterThan(10);
    expect(onRampWithGrip).toBe(onRampSteps); // Every ramp contact resolved to asphalt.
    expect(peakAirTime).toBeGreaterThan(0.3);
    expect(s.landingCount).toBe(1);
    expect(s.landingSpeed).toBeGreaterThan(1);
    expect(s.speed).toBeGreaterThan(speedAtTakeoff * 0.6); // Landed and kept rolling.
    expect(s.recoveryCount).toBe(0);
    expect(s.position.x).toBeCloseTo(130, 0); // Straight: the ramp did not steer it.
  } finally {
    rig.dispose();
  }
});
