import { expect, it } from 'vitest';
import { CrashMode } from '../../src/core/crashMode';
import {
  createImpactSeverity,
  estimateImpactSeverity,
} from '../../src/core/impactSeverity';
import { createCrashJunctionMap } from '../../src/world/crashJunction';
import { createTraffic } from '../../src/world/traffic';
import {
  neutralScriptInput,
  scriptVehicleHarness,
} from '../scriptVehicleHarness';

const DT = 1 / 120;

it.each(['south', 'west'] as const)(
  'grows a player-started %s junction pileup from intact traffic',
  async (approach) => {
    const map = createCrashJunctionMap(approach);
    const rig = await scriptVehicleHarness({ flatPlane: true });
    const { world, vehicle, loop, setPad, surfacedBodies } = rig;
    const traffic = createTraffic(
      world,
      surfacedBodies,
      map.path!,
      map.traffic!,
      { density: 1, minGap: 12, maxGap: 12 },
    );
    const score = new CrashMode();
    const impact = createImpactSeverity();
    const normalIntoPlayer = { x: 0, y: 0, z: 0 };
    const relativeVelocity = { x: 0, y: 0, z: 0 };
    let firstContact: { speed: number; closing: number; carId: number } | null =
      null;
    let ambientWrecks = 0;
    const wreckIds = new Set<number>();
    world.onContact((a, b, impulse, _point, normal, readVelocities) => {
      if (a !== vehicle.body && b !== vehicle.body) {
        const carA = traffic.stateForBody(a);
        const carB = traffic.stateForBody(b);
        if (carA && carB) score.noteCarContact(carA.id, carB.id);
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
      const otherVelocity = traffic.velocityForBody(otherBody)!;
      relativeVelocity.x = vehicle.telemetry.velocity.x - otherVelocity.x;
      relativeVelocity.y = vehicle.telemetry.velocity.y - otherVelocity.y;
      relativeVelocity.z = vehicle.telemetry.velocity.z - otherVelocity.z;
      estimateImpactSeverity(
        impulse,
        relativeVelocity,
        normalIntoPlayer,
        vehicle.currentMass,
        impact,
      );
      if (!firstContact && impact.approachSpeed > 2)
        firstContact = {
          speed: vehicle.telemetry.speed,
          closing: impact.approachSpeed,
          carId: car.id,
        };
      if (impact.severity >= 0.05) score.notePlayerContact(car.id);
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
        score.step(DT);
        traffic.preStep(
          DT,
          vehicle.telemetry.position,
          vehicle.telemetry.speed,
        );
        loop.stepMany(1);
        traffic.postStep();
        for (const car of traffic.newlyWrecked) {
          if (!firstContact) ambientWrecks++;
          else {
            wreckIds.add(car.id);
            score.noteWreck({ id: car.id, modelKind: car.modelKind });
          }
        }
      }
      console.log(
        `CRASH_CHAIN_${approach} ${JSON.stringify({ firstContact, ambientWrecks, wreckIds: [...wreckIds], damage: score.state.damage, creditedWrecks: score.state.wrecks, awards: score.awards })}`,
      );
      expect(firstContact, 'player reaches crossing').not.toBeNull();
      expect(ambientWrecks, 'crossing stays intact before player').toBe(0);
      expect(
        wreckIds.size,
        'physical chain reaches three cars',
      ).toBeGreaterThanOrEqual(3);
      expect(
        score.state.wrecks,
        'chain is player credited',
      ).toBeGreaterThanOrEqual(3);
      expect(vehicle.telemetry.recoveryCount).toBe(0);
    } finally {
      traffic.dispose();
      rig.dispose();
    }
  },
  60_000,
);
