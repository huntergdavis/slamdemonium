import { expect, it } from 'vitest';
import {
  GARAGE_CLASSES,
  GARAGE_CLASS_IDS,
} from '../../src/vehicle/garageClasses';
import { scriptVehicleHarness } from '../scriptVehicleHarness';

const HZ = 120;
const neutral = {
  source: 'gamepad' as const,
  throttle: 0,
  brake: 0,
  steer: 0,
  handbrake: false,
  boost: false,
};

it('gives the three garage cars distinct real-Jolt launch and turn behavior', async () => {
  const measurements: Record<
    string,
    { to30: number; turn14: number; turn28: number }
  > = {};
  for (const id of GARAGE_CLASS_IDS) {
    const rig = await scriptVehicleHarness({
      flatPlane: true,
      garageClass: GARAGE_CLASSES[id],
    });
    try {
      const { loop, setPad, vehicle, world } = rig;
      setPad(neutral);
      loop.stepMany(HZ / 2);
      setPad({ ...neutral, throttle: 1 });
      let to30 = -1;
      for (let step = 1; step <= 8 * HZ; step++) {
        loop.stepMany(1);
        if (to30 < 0 && vehicle.telemetry.speed >= 30) to30 = step / HZ;
      }
      expect(to30, `${id} reaches 30 m/s`).toBeGreaterThan(0);
      const turnRadius = (entrySpeed: number) => {
        vehicle.respawn({ x: 130, y: 1, z: 0 }, { x: 0, y: 0, z: 0, w: 1 });
        world.setLinearVelocity(vehicle.body, {
          x: 0,
          y: 0,
          z: -entrySpeed,
        });
        setPad({ ...neutral, throttle: 0.35, steer: 1 });
        let curvature = 0;
        for (let step = 0; step < 4 * HZ; step++) {
          loop.stepMany(1);
          if (step >= 2 * HZ)
            curvature +=
              Math.abs(vehicle.telemetry.yawRate) /
              Math.max(vehicle.telemetry.speed, 1);
        }
        return (2 * HZ) / curvature;
      };
      measurements[id] = {
        to30,
        turn14: turnRadius(14),
        turn28: turnRadius(28),
      };
    } finally {
      rig.dispose();
    }
  }
  console.log(`GARAGE_CLASSES ${JSON.stringify(measurements)}`);
  expect(measurements.compact!.to30).toBeLessThan(measurements.sports!.to30);
  expect(measurements.compact!.turn14).toBeLessThan(
    measurements.sports!.turn14,
  );
  expect(measurements.sports!.turn14).toBeLessThan(measurements.muscle!.turn14);
  expect(measurements.compact!.turn28).toBeLessThan(
    measurements.muscle!.turn28,
  );
});

it.each(GARAGE_CLASS_IDS)(
  '%s survives a side wall hit and rights an exact roof rest',
  async (id) => {
    const rig = await scriptVehicleHarness({
      flatPlane: true,
      garageClass: GARAGE_CLASSES[id],
    });
    try {
      const { loop, setPad, vehicle, world } = rig;
      world.createStaticBox({ x: 136, y: 1, z: 0 }, { x: 0.5, y: 1, z: 8 });
      setPad(neutral);
      vehicle.respawn({ x: 130, y: 1, z: 0 }, { x: 0, y: 0, z: 0, w: 1 });
      world.setLinearVelocity(vehicle.body, { x: 16, y: 0, z: 0 });
      let maxX = -Infinity;
      for (let step = 0; step < 2 * HZ; step++) {
        loop.stepMany(1);
        maxX = Math.max(maxX, vehicle.telemetry.position.x);
      }
      expect(maxX, `${id} side-wall penetration`).toBeLessThan(135);
      world.onContact((a, b, _impulse, _point, normal) => {
        if (a !== vehicle.body && b !== vehicle.body) return;
        const sign = a === vehicle.body ? -1 : 1;
        vehicle.noteChassisContact({
          x: sign * normal.x,
          y: sign * normal.y,
          z: sign * normal.z,
        });
      });
      vehicle.respawn({ x: 130, y: 0.6, z: 0 }, { x: 0, y: 0, z: 1, w: 0 });
      let rightedAt = -1;
      for (let step = 0; step < 4 * HZ; step++) {
        loop.stepMany(1);
        const q = vehicle.telemetry.rotation;
        const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
        if (upY > 0.9 && vehicle.telemetry.groundedWheels >= 3) {
          rightedAt = step / HZ;
          break;
        }
      }
      console.log(`GARAGE_RECOVERY ${JSON.stringify({ id, maxX, rightedAt })}`);
      expect(rightedAt, `${id} roof recovery`).toBeGreaterThan(0);
      expect(rightedAt).toBeLessThan(4);
    } finally {
      rig.dispose();
    }
  },
  30_000,
);
