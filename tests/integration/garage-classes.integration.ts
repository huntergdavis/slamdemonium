import { expect, it } from 'vitest';
import {
  GARAGE_CLASSES,
  GARAGE_CLASS_IDS,
  RACE_GARAGE_CLASS_IDS,
} from '../../src/vehicle/garageClasses';
import { installRamps, type RampSpec } from '../../src/world/ramps';
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

it('measures each garage car launch and full-lock turn on real Jolt', async () => {
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
      expect(
        to30,
        `${id} reaches 30 m/s (8 s speed ${vehicle.telemetry.speed.toFixed(1)})`,
      ).toBeGreaterThan(0);
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
  expect(measurements.pickup!.to30).toBeGreaterThan(measurements.sports!.to30);
  expect(measurements.pickup!.turn14).toBeGreaterThan(
    measurements.sports!.turn14,
  );
  expect(measurements.suv!.turn14).toBeGreaterThan(measurements.pickup!.turn14);
  expect(measurements.bus!.turn14).toBeGreaterThan(measurements.suv!.turn14);
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
      const wall = world.createStaticBox(
        { x: 136, y: 1, z: 0 },
        { x: 0.5, y: 1, z: 8 },
      );
      let wallContacts = 0;
      world.onContact((a, b) => {
        if (
          (a === vehicle.body && b === wall) ||
          (b === vehicle.body && a === wall)
        )
          wallContacts++;
      });
      setPad(neutral);
      const wallStartX =
        133 -
        Math.max(
          0,
          (GARAGE_CLASSES[id].geometry.width -
            GARAGE_CLASSES.sports.geometry.width) /
            2,
        );
      vehicle.respawn(
        {
          x: wallStartX,
          y: GARAGE_CLASSES[id].geometry.height / 2 + 0.35,
          z: 0,
        },
        { x: 0, y: 0, z: 0, w: 1 },
      );
      world.setLinearVelocity(vehicle.body, { x: 16, y: 0, z: 0 });
      let maxX = -Infinity;
      let lowestLateralSpeed = Infinity;
      const wallVelocity = { x: 0, y: 0, z: 0 };
      for (let step = 0; step < 2 * HZ; step++) {
        loop.stepMany(1);
        maxX = Math.max(maxX, vehicle.telemetry.position.x);
        world.getLinearVelocity(vehicle.body, wallVelocity);
        lowestLateralSpeed = Math.min(lowestLateralSpeed, wallVelocity.x);
      }
      expect(maxX, `${id} side-wall penetration`).toBeLessThan(135);
      expect(wallContacts, `${id} chassis-wall contacts`).toBeGreaterThan(0);
      expect(lowestLateralSpeed, `${id} lateral speed after wall`).toBeLessThan(
        4,
      );
      world.onContact((a, b, _impulse, _point, normal) => {
        if (a !== vehicle.body && b !== vehicle.body) return;
        const sign = a === vehicle.body ? -1 : 1;
        vehicle.noteChassisContact({
          x: sign * normal.x,
          y: sign * normal.y,
          z: sign * normal.z,
        });
      });
      vehicle.respawn(
        { x: 130, y: GARAGE_CLASSES[id].geometry.height / 2 + 0.1, z: 0 },
        { x: 0, y: 0, z: 1, w: 0 },
      );
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
      console.log(
        `GARAGE_RECOVERY ${JSON.stringify({ id, maxX, wallContacts, lowestLateralSpeed, rightedAt })}`,
      );
      expect(rightedAt, `${id} roof recovery`).toBeGreaterThan(0);
      expect(rightedAt).toBeLessThan(4);
    } finally {
      rig.dispose();
    }
  },
  30_000,
);

it.each(RACE_GARAGE_CLASS_IDS)(
  '%s clears the same real-Jolt ramp and lands upright',
  async (id) => {
    const rig = await scriptVehicleHarness({
      flatPlane: true,
      garageClass: GARAGE_CLASSES[id],
    });
    try {
      const { loop, setPad, surfacedBodies, vehicle } = rig;
      const ramp: RampSpec = {
        x: 130,
        z: -60,
        heading: 0,
        length: 12,
        width: 8,
        rise: 1.6,
      };
      installRamps(surfacedBodies, [ramp]);
      setPad({ ...neutral, throttle: 1 });
      let peakAirTime = 0;
      for (let step = 0; step < 6 * HZ; step++) {
        loop.stepMany(1);
        peakAirTime = Math.max(peakAirTime, vehicle.telemetry.airTime);
        if (vehicle.telemetry.landingCount > 0) break;
      }
      console.log(
        `GARAGE_RAMP ${JSON.stringify({ id, peakAirTime, landingCount: vehicle.telemetry.landingCount, recoveryCount: vehicle.telemetry.recoveryCount })}`,
      );
      expect(peakAirTime, `${id} leaves the ramp`).toBeGreaterThan(0.2);
      expect(vehicle.telemetry.landingCount, `${id} lands`).toBe(1);
      expect(vehicle.telemetry.recoveryCount, `${id} stays drivable`).toBe(0);
    } finally {
      rig.dispose();
    }
  },
  30_000,
);

it('holds distinct normal and boosted ceilings on a real flat road', async () => {
  const targets: Record<string, readonly [number, number]> = {
    compact: [50, 68],
    muscle: [54, 74],
    coupe: [58, 78],
    sports: [60, 85],
    super: [65, 87],
    pickup: [45, 60],
    suv: [43, 57],
    bus: [38, 52],
  };
  const speeds: Record<string, { normal: number; boosted: number }> = {};
  for (const id of GARAGE_CLASS_IDS) {
    const rig = await scriptVehicleHarness({
      flatPlane: true,
      garageClass: GARAGE_CLASSES[id],
    });
    try {
      const { loop, setPad, vehicle } = rig;
      setPad(neutral);
      loop.stepMany(HZ / 2);
      setPad({ ...neutral, throttle: 1 });
      loop.stepMany(30 * HZ);
      const normal = vehicle.telemetry.speed;
      setPad({ ...neutral, throttle: 1, boost: true });
      for (let step = 0; step < 12 * HZ; step++) {
        vehicle.setDriftMeter(1);
        loop.stepMany(1);
      }
      const boosted = vehicle.telemetry.speed;
      speeds[id] = { normal, boosted };
      expect(Number.isFinite(normal)).toBe(true);
      expect(Number.isFinite(boosted)).toBe(true);
      expect(Math.abs(normal - targets[id]![0])).toBeLessThan(0.25);
      expect(Math.abs(boosted - targets[id]![1])).toBeLessThan(0.5);
    } finally {
      rig.dispose();
    }
  }
  console.log(`GARAGE_CEILINGS ${JSON.stringify(speeds)}`);
}, 60_000);
