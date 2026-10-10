import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
import {
  createImpactSeverity,
  estimateImpactSeverity,
} from '../../src/core/impactSeverity';
import { createPhysicsWorld } from '../../src/physics/joltWorld';
import { sampleRoad } from '../../src/world/roadGenerator';
import { createSurfacedBodies } from '../../src/world/surfacedBodies';
import { createSurfaceRegistry } from '../../src/world/surfaceRegistry';
import { createTraffic } from '../../src/world/traffic';

const wasmPath = createRequire(import.meta.url).resolve(
  'jolt-physics/jolt-physics.wasm.wasm',
);
const DT = 1 / 120;

for (const kind of ['rear', 'side'] as const) {
  for (const requestedClosing of [20, 40, 60]) {
    it(`crumples a ${kind} traffic hit at ${requestedClosing} m/s without springing apart`, async () => {
      const world = await createPhysicsWorld({ wasmPath });
      const bodies = createSurfacedBodies(world, createSurfaceRegistry());
      try {
        world.setGravity(20);
        world.createStaticBox(
          { x: 0, y: -0.5, z: -250 },
          { x: 300, y: 0.5, z: 400 },
        );
        const path = sampleRoad([{ kind: 'straight', length: 500 }], {
          x: 0,
          z: 0,
          heading: 0,
        });
        const traffic = createTraffic(world, bodies, path, [
          { station: 140, laneSide: -1, speed: 20 },
        ]);
        try {
          const playerPosition = { x: 3.5, y: 0.6, z: -40 };
          traffic.preStep(DT, playerPosition);
          world.step(DT);
          traffic.postStep();
          const car = traffic.states[0]!;
          expect(car.bodyId).toBeGreaterThan(0);
          const player = world.createDynamicBox({
            center:
              kind === 'rear'
                ? { x: car.position.x, y: 0.6, z: car.position.z + 10 }
                : { x: car.position.x - 6, y: 0.6, z: car.position.z + 1.5 },
            halfExtents: { x: 0.95, y: 0.55, z: 2.1 },
            mass: 1300,
            comOffset: { x: 0, y: 0, z: 0 },
            inertiaScale: { x: 1, y: 1, z: 1 },
            friction: 0,
            restitution: 0,
            ccd: true,
            maxAngularVelocity: 12,
            angularDamping: 0,
          });
          const playerVelocity =
            kind === 'rear'
              ? { x: 0, y: 0, z: -(20 + requestedClosing) }
              : { x: requestedClosing, y: 0, z: -20 };
          world.setLinearVelocity(player, playerVelocity);
          const normal = { x: 0, y: 0, z: 0 };
          const relative = { x: 0, y: 0, z: 0 };
          const preStepPlayerVelocity = { x: 0, y: 0, z: 0 };
          const postPlayerVelocity = { x: 0, y: 0, z: 0 };
          const postTrafficVelocity = { x: 0, y: 0, z: 0 };
          const trafficAngular = { x: 0, y: 0, z: 0 };
          const playerAngular = { x: 0, y: 0, z: 0 };
          const preCorrectionPlayer = { x: 0, y: 0, z: 0 };
          const preCorrectionTraffic = { x: 0, y: 0, z: 0 };
          const rotation = { x: 0, y: 0, z: 0, w: 1 };
          const impact = createImpactSeverity();
          let closing = 0;
          let firstSeparation = 0;
          let maxSeparation = 0;
          let struck = false;
          let postContactSteps = 0;
          let tangentDelta = 0;
          let momentumDelta = 0;
          let angularSpeedEarly = 0;
          let peakTrafficUpward = 0;
          let peakTrafficHeight = 0;
          let trafficAirborneSteps = 0;
          let minTrafficUpY = 1;
          let peakPlayerRebound = 0;
          let peakPlayerYaw = 0;
          const observeOutcome = () => {
            world.getLinearVelocity(player, postPlayerVelocity);
            world.getAngularVelocity(player, playerAngular);
            world.getTransform(car.bodyId, playerPosition, rotation);
            peakTrafficUpward = Math.max(peakTrafficUpward, car.velocity.y);
            peakTrafficHeight = Math.max(
              peakTrafficHeight,
              car.position.y - 0.55,
            );
            if (car.position.y > 0.8) trafficAirborneSteps++;
            minTrafficUpY = Math.min(
              minTrafficUpY,
              1 - 2 * (rotation.x ** 2 + rotation.z ** 2),
            );
            peakPlayerRebound = Math.max(
              peakPlayerRebound,
              postPlayerVelocity.x * normal.x +
                postPlayerVelocity.y * normal.y +
                postPlayerVelocity.z * normal.z,
            );
            peakPlayerYaw = Math.max(peakPlayerYaw, Math.abs(playerAngular.y));
          };
          world.onContact((a, b, impulse, _point, contactNormal) => {
            const other = a === player ? b : b === player ? a : -1;
            if (other !== car.bodyId || struck) return;
            const sign = a === player ? -1 : 1;
            normal.x = contactNormal.x * sign;
            normal.y = contactNormal.y * sign;
            normal.z = contactNormal.z * sign;
            const trafficVelocity = traffic.velocityForBody(other)!;
            relative.x = preStepPlayerVelocity.x - trafficVelocity.x;
            relative.y = preStepPlayerVelocity.y - trafficVelocity.y;
            relative.z = preStepPlayerVelocity.z - trafficVelocity.z;
            estimateImpactSeverity(impulse, relative, normal, 1300, impact);
            closing = -(
              relative.x * normal.x +
              relative.y * normal.y +
              relative.z * normal.z
            );
            traffic.onPlayerContact(other, impact, normal, relative);
            struck = true;
          });
          for (let step = 0; step < 360 && postContactSteps < 13; step++) {
            world.getTransform(player, playerPosition, rotation);
            world.getLinearVelocity(player, preStepPlayerVelocity);
            traffic.preStep(DT, playerPosition);
            world.step(DT);
            if (struck && postContactSteps === 0) {
              world.getLinearVelocity(player, preCorrectionPlayer);
              world.getLinearVelocity(car.bodyId, preCorrectionTraffic);
            }
            traffic.postStep(player, 1300);
            if (!struck) continue;
            world.getLinearVelocity(player, postPlayerVelocity);
            world.getLinearVelocity(car.bodyId, postTrafficVelocity);
            const separation =
              (postPlayerVelocity.x - postTrafficVelocity.x) * normal.x +
              (postPlayerVelocity.y - postTrafficVelocity.y) * normal.y +
              (postPlayerVelocity.z - postTrafficVelocity.z) * normal.z;
            if (postContactSteps === 0) {
              firstSeparation = separation;
              const beforeMomentum =
                (1300 * preCorrectionPlayer.x + 1100 * preCorrectionTraffic.x) *
                  normal.x +
                (1300 * preCorrectionPlayer.y + 1100 * preCorrectionTraffic.y) *
                  normal.y +
                (1300 * preCorrectionPlayer.z + 1100 * preCorrectionTraffic.z) *
                  normal.z;
              const afterMomentum =
                (1300 * postPlayerVelocity.x + 1100 * postTrafficVelocity.x) *
                  normal.x +
                (1300 * postPlayerVelocity.y + 1100 * postTrafficVelocity.y) *
                  normal.y +
                (1300 * postPlayerVelocity.z + 1100 * postTrafficVelocity.z) *
                  normal.z;
              momentumDelta = afterMomentum - beforeMomentum;
              tangentDelta =
                (postPlayerVelocity.x - preCorrectionPlayer.x) * -normal.z +
                (postPlayerVelocity.z - preCorrectionPlayer.z) * normal.x;
            }
            maxSeparation = Math.max(maxSeparation, separation);
            observeOutcome();
            postContactSteps++;
          }
          world.getAngularVelocity(car.bodyId, trafficAngular);
          angularSpeedEarly = Math.hypot(
            trafficAngular.x,
            trafficAngular.y,
            trafficAngular.z,
          );
          for (let step = 0; step < 2 * 120; step++) {
            world.getTransform(player, playerPosition, rotation);
            traffic.preStep(DT, playerPosition);
            world.step(DT);
            traffic.postStep(player, 1300);
            observeOutcome();
          }
          world.getAngularVelocity(car.bodyId, trafficAngular);
          const angularSpeedAfter2s = Math.hypot(
            trafficAngular.x,
            trafficAngular.y,
            trafficAngular.z,
          );
          world.getTransform(car.bodyId, playerPosition, rotation);
          const upY = 1 - 2 * (rotation.x ** 2 + rotation.z ** 2);
          const report = {
            kind,
            requestedClosing,
            wreckSide: car.wreckSide,
            closing: +closing.toFixed(2),
            firstSeparation: +firstSeparation.toFixed(2),
            maxSeparation12: +maxSeparation.toFixed(2),
            reboundRatio: +(Math.max(0, firstSeparation) / closing).toFixed(3),
            tangentDelta: +tangentDelta.toFixed(3),
            angularEarly: +angularSpeedEarly.toFixed(2),
            angularAfter2s: +angularSpeedAfter2s.toFixed(2),
            trafficUpward: +peakTrafficUpward.toFixed(2),
            trafficHeight: +peakTrafficHeight.toFixed(2),
            trafficAirtime: +(trafficAirborneSteps * DT).toFixed(2),
            trafficMinUpY: +minTrafficUpY.toFixed(2),
            playerRebound: +peakPlayerRebound.toFixed(2),
            playerYaw: +peakPlayerYaw.toFixed(2),
            upY: +upY.toFixed(2),
          };
          console.log(`TRAFFIC_CRUMPLE ${JSON.stringify(report)}`);
          expect(struck).toBe(true);
          expect(car.wrecked).toBe(true);
          if (kind === 'rear') expect(car.wreckSide).toBe('rear');
          else expect(['left', 'right']).toContain(car.wreckSide);
          expect(closing).toBeGreaterThan(requestedClosing * 0.75);
          expect(firstSeparation).toBeLessThanOrEqual(
            Math.min(2, Math.max(0.5, closing * 0.05)) + 0.1,
          );
          // The crumple only changes velocity along the contact normal.
          expect(Math.abs(tangentDelta)).toBeLessThan(0.01);
          expect(Math.abs(momentumDelta)).toBeLessThan(0.1);
        } finally {
          traffic.dispose();
        }
      } finally {
        bodies.dispose();
        world.dispose();
      }
    });
  }
}
