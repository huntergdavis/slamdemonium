import { expect, it } from 'vitest';
import { ImpactTime } from '../../src/core/impactTime';
import { scriptVehicleHarness } from '../scriptVehicleHarness';

const DT = 1 / 120;
const wreckInput = {
  throttle: 0,
  brake: 0,
  steer: 0,
  handbrake: false,
  boost: false,
} as const;

async function runWreck(roll: number, steer: number, wall = false) {
  const rig = await scriptVehicleHarness({ flatPlane: true });
  try {
    const { vehicle, world } = rig;
    if (wall)
      world.createStaticBox({ x: 130, y: 2, z: -15 }, { x: 20, y: 2, z: 0.5 });
    world.setTransform(
      vehicle.body,
      { x: 130, y: roll ? 1.3 : 1, z: 0 },
      { x: 0, y: 0, z: Math.sin(roll / 2), w: Math.cos(roll / 2) },
      true,
    );
    world.setLinearVelocity(vehicle.body, { x: 0, y: 0, z: -30 });
    const episode = new ImpactTime();
    episode.start();
    let peakY = -Infinity;
    for (let step = 0; step < 120; step++) {
      vehicle.preStep(DT, wreckInput, 'keyboard', true);
      vehicle.applyAftertouch(steer, episode.steerDeltaVelocity(steer, DT), DT);
      world.step(DT);
      vehicle.postStep(DT);
      peakY = Math.max(peakY, vehicle.telemetry.position.y);
    }
    return {
      x: vehicle.telemetry.position.x,
      y: vehicle.telemetry.position.y,
      peakY,
      speed: vehicle.telemetry.speed,
    };
  } finally {
    rig.dispose();
  }
}

it('steers a moving wreck sideways in real Jolt without lifting an upright, side or roof chassis', async () => {
  for (const roll of [0, Math.PI / 2, Math.PI]) {
    const neutral = await runWreck(roll, 0);
    const steered = await runWreck(roll, 1);
    expect(neutral.x - steered.x).toBeGreaterThan(0.3);
    expect(steered.peakY - neutral.peakY).toBeLessThan(0.5);
    expect(steered.speed).toBeGreaterThan(3);
  }
}, 30_000);

it('a steered wreck hitting a wall remains finite and does not launch upward', async () => {
  const neutral = await runWreck(0, 0, true);
  const steered = await runWreck(0, 1, true);
  expect(steered.peakY - neutral.peakY).toBeLessThan(0.5);
  expect(Number.isFinite(steered.x)).toBe(true);
  expect(Number.isFinite(steered.y)).toBe(true);
}, 30_000);
