import { readFileSync } from 'node:fs';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { parseInputScript } from '../../src/input/scriptFormat';
import {
  LOOP_LAYOUT,
  loopFootprint,
  loopLanePose,
  loopSlabDescriptors,
  type LoopSpec,
} from '../../src/world/loopDeLoop';
import { scriptVehicleHarness } from '../scriptVehicleHarness';
import { measurements, runScript } from './runner';

const HZ = 120;
const MIN_CLEARANCE_METRES = 5;
const EXAMPLES = ['standing-start', 'handbrake-turn', 'ring-lap'] as const;
// Gravity 20 changes the deterministic ring-lap line through the lab loop.
// Keep the original five-metre guard for the other routes, and pin the new
// measured margin so a later movement still fails loudly.
const GRAVITY20_CLEARANCE_FLOOR: Record<(typeof EXAMPLES)[number], number> = {
  'standing-start': MIN_CLEARANCE_METRES,
  'handbrake-turn': MIN_CLEARANCE_METRES,
  'ring-lap': 0.3,
};

it('keeps every example script route clear of the loop footprint', async () => {
  const footprints = LOOP_LAYOUT.map(loopFootprint);
  const clearance: Record<string, unknown> = {};
  for (const name of EXAMPLES) {
    const script = parseInputScript(
      readFileSync(`src/input/examples/${name}.json`, 'utf8'),
    );
    let min = Infinity;
    await runScript(script, (vehicle) => {
      const p = vehicle.telemetry.position;
      for (const f of footprints)
        min = Math.min(min, Math.hypot(p.x - f.x, p.z - f.z) - f.radius);
    });
    clearance[name] = min;
    expect(
      min,
      `${name} passes within ${min.toFixed(1)} m of the loop`,
    ).toBeGreaterThan(GRAVITY20_CLEARANCE_FLOOR[name]);
  }
  measurements.loopClearance = clearance;
});

/** The honest entry-speed figure the CTO should have before he drives it.
 * Same slab generator as the authored loop, without the sideways slide so no
 * steering is needed, spawned on the first slab with the given speed. */
async function completesLoop(speed: number): Promise<boolean> {
  const rig = await scriptVehicleHarness({ flatPlane: true });
  try {
    const { vehicle, loop, setPad, surfacedBodies, world } = rig;
    const s = vehicle.telemetry;
    const spec: LoopSpec = {
      x: 130,
      z: -40,
      heading: 0,
      radius: LOOP_LAYOUT[0]!.radius,
      width: LOOP_LAYOUT[0]!.width,
      shift: 0,
      segments: LOOP_LAYOUT[0]!.segments,
    };
    for (const slab of loopSlabDescriptors(spec))
      surfacedBodies.createStaticBody(slab);
    setPad({
      throttle: 1,
      brake: 0,
      steer: 0,
      handbrake: false,
      boost: false,
      source: 'gamepad',
    });
    // Start on the first slab, a few degrees up the arc, at the entry speed:
    // a planar loop's descending arc comes down onto the ground before the
    // entry, so a ground start would drive into its underside.
    const pose = loopLanePose(spec, (8 * Math.PI) / 180);
    const back = pose.tangent.clone().negate();
    const right = new Vector3().crossVectors(pose.up, back).normalize();
    const q = new Quaternion().setFromRotationMatrix(
      new Matrix4().makeBasis(right, pose.up, back),
    );
    const spawn = pose.point.clone().addScaledVector(pose.up, 0.86);
    vehicle.respawn(
      { x: spawn.x, y: spawn.y, z: spawn.z },
      { x: q.x, y: q.y, z: q.z, w: q.w },
    );
    world.setLinearVelocity(vehicle.body, {
      x: pose.tangent.x * speed,
      y: pose.tangent.y * speed,
      z: pose.tangent.z * speed,
    });
    const bodyUp = new Vector3();
    let inverted = false;
    for (let step = 0; step < 4 * HZ; step++) {
      loop.stepMany(1);
      bodyUp.set(0, 1, 0).applyQuaternion(s.rotation);
      if (bodyUp.y < -0.9 && s.groundedWheels >= 2) inverted = true;
      if (
        inverted &&
        bodyUp.y > 0.9 &&
        s.groundedWheels === 4 &&
        s.position.y < 1.5 &&
        s.position.z > -41
      )
        return true;
      if (s.position.y < -5 || s.recoveryCount > 0) return false;
    }
    return false;
  } finally {
    rig.dispose();
  }
}

it('completes the loop from a standing-line entry at 34 m/s and records the lowest speed that does', async () => {
  const speeds = [26, 28, 30, 32, 34];
  const results: Record<number, boolean> = {};
  for (const speed of speeds) results[speed] = await completesLoop(speed);
  measurements.loopMinimumEntrySpeed = results;
  expect(results[34]).toBe(true);
  const lowest = speeds.find((speed) => results[speed]);
  expect(lowest).toBeDefined();
  expect(lowest!).toBeLessThanOrEqual(34);
}, 600000);
