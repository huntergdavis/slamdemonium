import { expect, it } from 'vitest';
import { PlayerDamage } from '../../src/core/playerDamage';
import { nearestRoadPose, sampleRoad } from '../../src/world/roadGenerator';
import {
  neutralScriptInput,
  scriptVehicleHarness,
} from '../scriptVehicleHarness';

const DT = 1 / 120;
const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };

it('wrecks from real hard wall hits and recovers pristine, still facing the road', async () => {
  const harness = await scriptVehicleHarness({ flatPlane: true });
  const { world, vehicle } = harness;
  const wall = world.createStaticBox(
    { x: 0, y: 1, z: -20 },
    { x: 10, y: 2, z: 0.5 },
  );
  const damage = new PlayerDamage();
  const normal = { x: 0, y: 0, z: 0 };
  let wallContacts = 0;
  world.onContact((a, b, _impulse, _point, contactNormal) => {
    if (a !== vehicle.body && b !== vehicle.body) return;
    if (a !== wall && b !== wall) return;
    const sign = a === vehicle.body ? -1 : 1;
    normal.x = sign * contactNormal.x;
    normal.y = sign * contactNormal.y;
    normal.z = sign * contactNormal.z;
    damage.noteContact(
      normal,
      vehicle.telemetry.velocity,
      vehicle.telemetry.rotation,
    );
    wallContacts++;
  });
  try {
    vehicle.awardTakedown();
    vehicle.awardTakedown();
    for (let hit = 0; hit < 2; hit++) {
      vehicle.respawn({ x: 0, y: 1, z: -9 }, IDENTITY, 3);
      world.setLinearVelocity(vehicle.body, { x: 0, y: 0, z: -55 });
      const contactsBefore = wallContacts;
      for (
        let step = 0;
        step < 180 && wallContacts === contactsBefore;
        step++
      ) {
        vehicle.preStep(DT, neutralScriptInput, 'gamepad');
        world.step(DT);
        vehicle.postStep(DT);
        damage.step(DT);
      }
      expect(wallContacts).toBeGreaterThan(contactsBefore);
      damage.step(0.2); // A distinct second hit, not repeat solver contacts.
    }
    expect(damage.crush.front).toBeGreaterThan(0);
    expect(damage.wrecked).toBe(true);
    expect(damage.step(1.5)).toBe(true);
    vehicle.loseBoostSection();
    const path = sampleRoad([{ kind: 'straight', length: 100 }], {
      x: 20,
      z: 0,
      heading: 0,
    });
    const road = nearestRoadPose(path, vehicle.telemetry.position);
    const spawn = { x: road.x, y: 1, z: road.z };
    const rotation = {
      x: 0,
      y: Math.sin(road.heading / 2),
      z: 0,
      w: Math.cos(road.heading / 2),
    };
    vehicle.respawn(spawn, rotation, vehicle.telemetry.boostSections);
    damage.reset();
    const linear = { x: 1, y: 1, z: 1 };
    const angular = { x: 1, y: 1, z: 1 };
    world.getLinearVelocity(vehicle.body, linear);
    world.getAngularVelocity(vehicle.body, angular);
    expect(linear).toEqual({ x: 0, y: 0, z: 0 });
    expect(angular).toEqual({ x: 0, y: 0, z: 0 });
    expect(vehicle.telemetry.position.x).toBeCloseTo(20);
    expect(vehicle.telemetry.boostSections).toBe(2);
    expect(damage.damage).toBe(0);
  } finally {
    harness.dispose();
  }
}, 120_000);
