import { expect, it } from 'vitest';
import { PlayerDamage } from '../../src/core/playerDamage';
import { RoadRage } from '../../src/core/roadRage';
import {
  neutralScriptInput,
  scriptVehicleHarness,
} from '../scriptVehicleHarness';

const DT = 1 / 120;
const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };

it('three real wall wrecks end Road Rage before a third automatic recovery', async () => {
  const harness = await scriptVehicleHarness({ flatPlane: true });
  const { world, vehicle } = harness;
  const wall = world.createStaticBox(
    { x: 0, y: 1, z: -20 },
    { x: 10, y: 2, z: 0.5 },
  );
  const event = new RoadRage();
  const damage = new PlayerDamage();
  let contacts = 0;
  world.onContact((a, b, _impulse, _point, normal) => {
    if (
      (a !== vehicle.body && b !== vehicle.body) ||
      (a !== wall && b !== wall)
    )
      return;
    const sign = a === vehicle.body ? -1 : 1;
    const wasWrecked = damage.wrecked;
    damage.noteContact(
      { x: normal.x * sign, y: normal.y * sign, z: normal.z * sign },
      vehicle.telemetry.velocity,
      vehicle.telemetry.rotation,
    );
    if (!wasWrecked && damage.wrecked) event.notePlayerWreck();
    contacts++;
  });
  try {
    event.step(3);
    for (let wreck = 1; wreck <= 3; wreck++) {
      for (let hit = 0; hit < 2; hit++) {
        vehicle.respawn({ x: 0, y: 1, z: -9 }, IDENTITY, 1);
        world.setLinearVelocity(vehicle.body, { x: 0, y: 0, z: -55 });
        const before = contacts;
        for (let step = 0; step < 180 && contacts === before; step++) {
          vehicle.preStep(DT, neutralScriptInput, 'gamepad');
          world.step(DT);
          vehicle.postStep(DT);
          damage.step(DT);
        }
        expect(contacts).toBeGreaterThan(before);
        if (hit === 0) damage.step(0.2); // a separate impact episode
      }
      expect(damage.wrecked).toBe(true);
      expect(event.state.wrecks).toBe(wreck);
      if (wreck < 3) {
        expect(event.state.phase).toBe('running');
        expect(damage.step(1.5)).toBe(true);
        damage.reset(); // the first two nearest-road recoveries are pristine
      }
    }
    expect(event.state.phase).toBe('finished');
    expect(event.state.finishReason).toBe('wrecks');
    expect(event.state.medal).toBe('none');
    expect(damage.wrecked).toBe(true); // no third automatic respawn
    event.reset();
    damage.reset();
    expect(event.state.wrecks).toBe(0);
    expect(damage.wrecked).toBe(false);
  } finally {
    harness.dispose();
  }
}, 120_000);
