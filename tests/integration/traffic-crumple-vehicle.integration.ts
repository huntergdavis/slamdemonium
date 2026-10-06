import { expect, it } from 'vitest';
import {
  createImpactSeverity,
  estimateImpactSeverity,
} from '../../src/core/impactSeverity';
import { CAR_MODELS } from '../../src/world/carModels';
import { sampleRoad } from '../../src/world/roadGenerator';
import { createTraffic } from '../../src/world/traffic';
import {
  neutralScriptInput,
  scriptVehicleHarness,
} from '../scriptVehicleHarness';

const DT = 1 / 120;

for (const kind of ['rear', 'side'] as const) {
  for (const requestedClosing of [20, 40, 60]) {
    it(`measures the actual vehicle in a ${kind} traffic hit at ${requestedClosing} m/s`, async () => {
      const harness = await scriptVehicleHarness({ flatPlane: true });
      const { world, surfacedBodies, vehicle } = harness;
      const path = sampleRoad([{ kind: 'straight', length: 500 }], {
        x: 0,
        z: 0,
        heading: 0,
      });
      const traffic = createTraffic(world, surfacedBodies, path, [
        { station: 140, laneSide: -1, speed: 20 },
      ]);
      try {
        const playerPosition = { x: 3.5, y: 1.0, z: -40 };
        traffic.preStep(DT, playerPosition);
        world.step(DT);
        traffic.postStep();
        const car = traffic.states[0]!;
        const trafficRideHeight = CAR_MODELS[car.modelKind].ride;
        expect(car.bodyId).toBeGreaterThan(0);
        vehicle.respawn(
          kind === 'rear'
            ? { x: car.position.x, y: 1.0, z: car.position.z + 10 }
            : { x: car.position.x - 6, y: 1.0, z: car.position.z + 1.5 },
          { x: 0, y: 0, z: 0, w: 1 },
        );
        const incoming =
          kind === 'rear'
            ? { x: 0, y: 0, z: -(20 + requestedClosing) }
            : { x: requestedClosing, y: 0, z: -20 };
        world.setLinearVelocity(vehicle.body, incoming);
        const normal = { x: 0, y: 0, z: 0 };
        const relative = { x: 0, y: 0, z: 0 };
        const playerVelocity = { x: 0, y: 0, z: 0 };
        const playerAngular = { x: 0, y: 0, z: 0 };
        const trafficAngular = { x: 0, y: 0, z: 0 };
        const impact = createImpactSeverity();
        let struck = false;
        let closing = 0;
        let peakTrafficUp = 0;
        let peakTrafficHeight = 0;
        let trafficAirborneSteps = 0;
        let minTrafficUpY = 1;
        let peakPlayerRebound = 0;
        let peakPlayerYaw = 0;
        let peakPlayerUp = 0;
        let playerAirborneSteps = 0;
        let trafficFlipped = false;
        let firstPlayerV = 0;
        let preImpactPlayerSpeed = 0;
        let peakTrafficYaw = 0;
        let hitZ = 0;
        let hitX = 0;
        let trafficSpeedAtHalf = 0;
        let trafficSpeedAtOne = 0;
        let trafficTravelAtOne = 0;
        let lateralGapAtOne = 0;
        let playerSpeedAtHalf = 0;
        let playerSpeedAtOne = 0;
        let hitStep = -1;
        world.onContact((a, b, impulse, _point, contactNormal) => {
          const other = a === vehicle.body ? b : b === vehicle.body ? a : -1;
          if (other !== car.bodyId || struck) return;
          const sign = a === vehicle.body ? -1 : 1;
          normal.x = contactNormal.x * sign;
          normal.y = contactNormal.y * sign;
          normal.z = contactNormal.z * sign;
          const trafficVelocity = traffic.velocityForBody(other)!;
          relative.x = vehicle.telemetry.velocity.x - trafficVelocity.x;
          relative.y = vehicle.telemetry.velocity.y - trafficVelocity.y;
          relative.z = vehicle.telemetry.velocity.z - trafficVelocity.z;
          preImpactPlayerSpeed = vehicle.telemetry.speed;
          estimateImpactSeverity(
            impulse,
            relative,
            normal,
            vehicle.currentMass,
            impact,
          );
          closing = -(
            relative.x * normal.x +
            relative.y * normal.y +
            relative.z * normal.z
          );
          traffic.onPlayerContact(other, impact, normal, relative);
          struck = true;
          hitX = car.position.x;
          hitZ = car.position.z;
        });
        for (let step = 0; step < 4 * 120; step++) {
          vehicle.preStep(DT, neutralScriptInput, 'gamepad');
          traffic.preStep(DT, vehicle.telemetry.position);
          world.step(DT);
          traffic.postStep(vehicle.body, vehicle.currentMass);
          vehicle.postStep(DT);
          if (!struck) continue;
          if (hitStep < 0) hitStep = step;
          const sinceHit = step - hitStep;
          if (sinceHit === 60) {
            trafficSpeedAtHalf = car.speed;
            playerSpeedAtHalf = vehicle.telemetry.speed;
          }
          if (sinceHit === 120) {
            trafficSpeedAtOne = car.speed;
            playerSpeedAtOne = vehicle.telemetry.speed;
            trafficTravelAtOne = Math.hypot(
              car.position.x - hitX,
              car.position.z - hitZ,
            );
            lateralGapAtOne = Math.abs(
              car.position.x - vehicle.telemetry.position.x,
            );
          }
          if (firstPlayerV === 0) firstPlayerV = vehicle.telemetry.velocity.z;
          world.getLinearVelocity(vehicle.body, playerVelocity);
          world.getAngularVelocity(vehicle.body, playerAngular);
          world.getAngularVelocity(car.bodyId, trafficAngular);
          peakTrafficYaw = Math.max(peakTrafficYaw, Math.abs(trafficAngular.y));
          peakTrafficUp = Math.max(peakTrafficUp, car.velocity.y);
          peakTrafficHeight = Math.max(
            peakTrafficHeight,
            car.position.y - trafficRideHeight,
          );
          if (car.position.y > trafficRideHeight + 0.21) trafficAirborneSteps++;
          minTrafficUpY = Math.min(
            minTrafficUpY,
            1 - 2 * (car.rotation.x ** 2 + car.rotation.z ** 2),
          );
          if (minTrafficUpY < 0) trafficFlipped = true;
          peakPlayerRebound = Math.max(
            peakPlayerRebound,
            playerVelocity.x * normal.x +
              playerVelocity.y * normal.y +
              playerVelocity.z * normal.z,
          );
          peakPlayerYaw = Math.max(peakPlayerYaw, Math.abs(playerAngular.y));
          peakPlayerUp = Math.max(peakPlayerUp, playerVelocity.y);
          if (vehicle.telemetry.groundedWheels === 0) playerAirborneSteps++;
        }
        console.log(
          `TRAFFIC_VEHICLE ${JSON.stringify({ kind, requestedClosing, closing: +closing.toFixed(2), playerPre: +preImpactPlayerSpeed.toFixed(2), trafficUp: +peakTrafficUp.toFixed(2), trafficHeight: +peakTrafficHeight.toFixed(2), trafficAir: +(trafficAirborneSteps * DT).toFixed(2), trafficMinUpY: +minTrafficUpY.toFixed(2), trafficFlipped, trafficYaw: +peakTrafficYaw.toFixed(2), playerRebound: +peakPlayerRebound.toFixed(2), playerYaw: +peakPlayerYaw.toFixed(2), playerUp: +peakPlayerUp.toFixed(2), playerAir: +(playerAirborneSteps * DT).toFixed(2), firstPlayerV: +firstPlayerV.toFixed(2), trafficV05: +trafficSpeedAtHalf.toFixed(2), trafficV1: +trafficSpeedAtOne.toFixed(2), trafficD1: +trafficTravelAtOne.toFixed(2), gapX1: +lateralGapAtOne.toFixed(2), playerV05: +playerSpeedAtHalf.toFixed(2), playerV1: +playerSpeedAtOne.toFixed(2) })}`,
        );
        expect(struck).toBe(true);
        expect(trafficFlipped).toBe(false);
        // CTO (2026-10-04): "hit cars should allow to lift off briefly."
        // A hop is part of the crash; a sustained flight or rollover is not.
        expect(trafficAirborneSteps * DT).toBeLessThan(1.0);
        if (kind === 'rear') {
          const travelLimit = { 20: 26, 40: 36, 60: 46 }[requestedClosing]!;
          expect(trafficTravelAtOne).toBeLessThan(travelLimit);
          expect(playerSpeedAtOne).toBeGreaterThan(preImpactPlayerSpeed * 0.4);
          expect(peakPlayerRebound).toBeLessThan(1);
        } else if (requestedClosing >= 40) {
          expect(peakTrafficYaw).toBeLessThan(5.1);
        }
      } finally {
        traffic.dispose();
        harness.dispose();
      }
    });
  }
}
