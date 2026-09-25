import { expect, it } from 'vitest';
import { createBoostPadTracker } from '../../src/world/boostPads';
import { scriptVehicleHarness } from '../scriptVehicleHarness';

/** An accelerator triangle on the real vehicle: crossing it adds the kick
 * along the heading and grants boost, once; sitting on it or crossing it
 * slowly earns nothing more; a respawn re-arms it. */
const HZ = 120;
it('gives one kick and one boost grant per crossing, and re-arms on respawn', async () => {
  const rig = await scriptVehicleHarness({ flatPlane: true });
  try {
    const { vehicle, loop, setPad, store, world } = rig;
    const s = vehicle.telemetry;
    const pad = { x: 130, z: -60, heading: 0, length: 12, width: 6 }; // Ahead of the ring spawn, -Z.
    const tracker = createBoostPadTracker([pad]);
    const kick = store.get('padKick');
    const grant = store.get('padBoost');
    expect(kick).toBe(8);
    expect(grant).toBe(0.05);
    vehicle.respawn({ x: 130, y: 0.86, z: 0 }, { x: 0, y: 0, z: 0, w: 1 });
    world.setLinearVelocity(vehicle.body, { x: 0, y: 0, z: -20 });
    setPad({
      throttle: 0,
      brake: 0,
      steer: 0,
      handbrake: false,
      boost: false,
      source: 'gamepad',
    });
    let fires = 0;
    let speedBefore = 0;
    let speedAfter = 0;
    let boostBefore = 0;
    for (let step = 0; step < 6 * HZ; step++) {
      loop.stepMany(1);
      const entered = tracker.update(s.position.x, s.position.z);
      if (entered > 0) {
        fires += entered;
        speedBefore = s.speed;
        boostBefore = s.boostMeter;
        vehicle.applyPad(kick * entered, grant * entered);
        loop.stepMany(1);
        speedAfter = s.speed;
      }
    }
    expect(fires).toBe(1);
    expect(speedAfter - speedBefore).toBeGreaterThan(kick * 0.8);
    expect(speedAfter - speedBefore).toBeLessThan(kick * 1.2);
    expect(boostBefore).toBe(0);
    expect(s.boostMeter).toBeCloseTo(grant, 6);
    // Sitting still on the pad earns nothing more.
    world.setLinearVelocity(vehicle.body, { x: 0, y: 0, z: 0 });
    vehicle.respawn({ x: 130, y: 0.86, z: -66 }, { x: 0, y: 0, z: 0, w: 1 });
    tracker.update(130, -66); // Already inside after the teleport: no edge.
    for (let step = 0; step < HZ; step++) {
      loop.stepMany(1);
      expect(tracker.update(s.position.x, s.position.z)).toBe(0);
    }
    // A respawn re-arms the pad.
    tracker.reset();
    expect(tracker.update(130, -66)).toBe(1);
    // The grant caps at a full bar.
    vehicle.applyPad(0, 1);
    expect(s.boostMeter).toBe(1);
  } finally {
    rig.dispose();
  }
}, 120000);
