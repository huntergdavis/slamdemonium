import { expect, it } from 'vitest';
import {
  createImpactSeverity,
  estimateImpactSeverity,
} from '../../src/core/impactSeverity';
import { GARAGE_CLASSES } from '../../src/vehicle/garageClasses';
import { createCrashJunctionMap } from '../../src/world/crashJunction';
import { createTraffic } from '../../src/world/traffic';
import {
  scriptVehicleHarness,
  neutralScriptInput,
} from '../scriptVehicleHarness';

const DT = 1 / 120;

it.each(['south', 'west'] as const)(
  'drives Sports and pickup into the same twelve-car %s crossing',
  async (approach) => {
    const map = createCrashJunctionMap(approach);
    const results: Record<string, unknown> = {};
    for (const id of ['sports', 'pickup'] as const) {
      const rig = await scriptVehicleHarness({
        flatPlane: true,
        garageClass: GARAGE_CLASSES[id],
      });
      const { world, vehicle, loop, setPad, surfacedBodies } = rig;
      const traffic = createTraffic(
        world,
        surfacedBodies,
        map.path!,
        map.traffic!,
        { density: 1, minGap: 12, maxGap: 12 },
      );
      const impact = createImpactSeverity();
      const normalIntoPlayer = { x: 0, y: 0, z: 0 };
      const relativeVelocity = { x: 0, y: 0, z: 0 };
      let firstContact: {
        carId: number;
        speed: number;
        closing: number;
      } | null = null;
      let wrecks = 0;
      world.onContact((a, b, impulse, _point, normal, readVelocities) => {
        if (a !== vehicle.body && b !== vehicle.body) {
          traffic.onWorldContact(a, b, normal, readVelocities);
          return;
        }
        const otherBody = a === vehicle.body ? b : a;
        const car = traffic.stateForBody(otherBody);
        if (!car) return;
        const sign = a === vehicle.body ? -1 : 1;
        normalIntoPlayer.x = sign * normal.x;
        normalIntoPlayer.y = sign * normal.y;
        normalIntoPlayer.z = sign * normal.z;
        const trafficVelocity = traffic.velocityForBody(otherBody)!;
        relativeVelocity.x = vehicle.telemetry.velocity.x - trafficVelocity.x;
        relativeVelocity.y = vehicle.telemetry.velocity.y - trafficVelocity.y;
        relativeVelocity.z = vehicle.telemetry.velocity.z - trafficVelocity.z;
        estimateImpactSeverity(
          impulse,
          relativeVelocity,
          normalIntoPlayer,
          vehicle.currentMass,
          impact,
        );
        if (!firstContact && impact.approachSpeed > 2)
          firstContact = {
            carId: car.id,
            speed: vehicle.telemetry.speed,
            closing: impact.approachSpeed,
          };
        traffic.onPlayerContact(
          otherBody,
          impact,
          normalIntoPlayer,
          relativeVelocity,
        );
      });
      try {
        const heading = map.spawn!.heading;
        vehicle.respawn(
          { x: map.spawn!.x, y: 1, z: map.spawn!.z },
          { x: 0, y: Math.sin(heading / 2), z: 0, w: Math.cos(heading / 2) },
        );
        setPad(neutralScriptInput);
        for (let step = 0; step < 12 / DT; step++) {
          if (step === 4 / DT) {
            world.setLinearVelocity(vehicle.body, {
              x: -35 * Math.sin(heading),
              y: 0,
              z: -35 * Math.cos(heading),
            });
            setPad({ ...neutralScriptInput, throttle: 1 });
          }
          traffic.preStep(
            DT,
            vehicle.telemetry.position,
            vehicle.telemetry.speed,
          );
          loop.stepMany(1);
          traffic.postStep();
          wrecks += traffic.newlyWrecked.length;
        }
        results[id] = {
          firstContact,
          wrecks,
          recoveryCount: vehicle.telemetry.recoveryCount,
          groundedWheels: vehicle.telemetry.groundedWheels,
        };
        expect(
          firstContact,
          `${id} reaches live crossing traffic`,
        ).not.toBeNull();
        expect(wrecks, `${id} grows a physical crash`).toBeGreaterThan(0);
        expect(vehicle.telemetry.recoveryCount).toBe(0);
      } finally {
        traffic.dispose();
        rig.dispose();
      }
    }
    console.log(`PICKUP_CRASH_${approach} ${JSON.stringify(results)}`);
  },
  60_000,
);
