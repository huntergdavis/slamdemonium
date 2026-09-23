import { Matrix4, Quaternion, Vector3 } from 'three';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { afterAll, expect, it } from 'vitest';
import { parseInputScript } from '../../src/input/scriptFormat';
import {
  loopFootprint,
  loopLanePose,
  loopSlabDescriptors,
  type LoopSpec,
} from '../../src/world/loopDeLoop';
import {
  PROVING_GROUND_MAP,
  PROVING_GROUND_SPAWN_Z,
  TARGET_LINE_Z,
} from '../../src/world/maps';
import { installRamps, rampFootprint } from '../../src/world/ramps';
import { resolveTrackConfig } from '../../src/world/trackConfig';
import { scriptVehicleHarness } from '../scriptVehicleHarness';
import { measurements, runScript } from './runner';

const HZ = 120;

/** Each integration file runs in its own worker, so this file writes its
 * own measurements; the numbers are the deliverable for the CTO. */
afterAll(() => {
  mkdirSync('scratch', { recursive: true });
  const picked: Record<string, unknown> = {};
  for (const key of [
    'provingGroundClearance',
    'giantRamp',
    'bigLoopMinimumEntrySpeed',
  ])
    if (key in measurements) picked[key] = measurements[key];
  writeFileSync(
    'scratch/proving-ground.json',
    JSON.stringify(picked, null, 2) + '\n',
  );
});
const MIN_CLEARANCE_METRES = 5;
const EXAMPLES = ['standing-start', 'handbrake-turn', 'ring-lap'] as const;
const pg = PROVING_GROUND_MAP;
const config = resolveTrackConfig(pg.track);
const PAD = {
  brake: 0,
  steer: 0,
  handbrake: false,
  source: 'gamepad' as const,
};

/** The lab fixtures replay in-game on whichever map is loaded, from their
 * own recorded spawn at (130, 0). On the proving ground that route runs
 * across the paved infield, so it must clear every structure there. */
it('keeps every example script route clear of every proving ground structure', async () => {
  const footprints = [
    ...pg.ramps.map(rampFootprint),
    ...pg.loops.map(loopFootprint),
  ];
  const clearance: Record<string, number> = {};
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
    expect(min, `${name} passes within ${min.toFixed(1)} m`).toBeGreaterThan(
      MIN_CLEARANCE_METRES,
    );
  }
  measurements.provingGroundClearance = clearance;
});

/** Launches off the giant ramp at the given speed from its real position on
 * a flat plane and reports where the car comes down. */
async function jump(speed: number, boost: boolean, southbound = false) {
  const rig = await scriptVehicleHarness({ flatPlane: true });
  try {
    const { vehicle, loop, setPad, surfacedBodies, world } = rig;
    const s = vehicle.telemetry;
    const [giant] = pg.ramps;
    installRamps(surfacedBodies, [giant!]);
    // 80 m short of the low edge, already at speed: northbound up the front
    // face from the spawn side, or southbound up the back face of the
    // triangle from the far side, so the run never circles back.
    const sign = southbound ? -1 : 1;
    const lowEdgeZ = southbound ? giant!.z + 2 * giant!.length : giant!.z;
    vehicle.respawn(
      { x: 0, y: 0.86, z: lowEdgeZ - sign * 80 },
      southbound ? { x: 0, y: 0, z: 0, w: 1 } : { x: 0, y: 1, z: 0, w: 0 },
    );
    world.setLinearVelocity(vehicle.body, { x: 0, y: 0, z: sign * speed });
    setPad({ ...PAD, throttle: 1, boost });
    let takeoffSpeed = 0;
    let apex = 0;
    let airTime = 0;
    for (let step = 0; step < 12 * HZ; step++) {
      loop.stepMany(1);
      if (s.airborne) {
        if (takeoffSpeed === 0) takeoffSpeed = s.speed;
        apex = Math.max(apex, s.position.y);
        airTime = Math.max(airTime, s.airTime);
      }
      if (s.landingCount > 0 || s.position.y < -1) break;
    }
    return {
      takeoffSpeed,
      apex,
      airTime,
      landingZ: s.position.z,
      landingX: s.position.x,
      landingRadius: Math.hypot(s.position.x, s.position.z),
      landed: s.landingCount > 0,
      recoveries: s.recoveryCount,
    };
  } finally {
    rig.dispose();
  }
}

it('lands the giant ramp jump on the map from both faces at top speed and at boost top speed', async () => {
  const cruise = await jump(60, false);
  const boosted = await jump(85, true);
  const southCruise = await jump(60, false, true);
  const southBoosted = await jump(85, true, true);
  measurements.giantRamp = { cruise, boosted, southCruise, southBoosted };
  for (const run of [cruise, boosted, southCruise, southBoosted]) {
    expect(run.landed).toBe(true);
    expect(run.recoveries).toBe(0);
    expect(run.airTime).toBeGreaterThan(2);
    // Down on the pavement well inside the 470 m barrier, never past the
    // ground collider and the kill plane.
    expect(run.landingRadius).toBeLessThan(config.barrierInnerRadius - 20);
  }
  expect(cruise.apex).toBeGreaterThan(12);
  expect(boosted.landingZ).toBeGreaterThan(cruise.landingZ);
  // Southbound lands on the main runway short of the spawn, never on it.
  for (const run of [southCruise, southBoosted]) {
    expect(run.landingZ).toBeLessThan(TARGET_LINE_Z);
    expect(run.landingZ).toBeGreaterThan(PROVING_GROUND_SPAWN_Z + 40);
    expect(Math.abs(run.landingX)).toBeLessThan(8);
  }
});

/** Same slab generator as the authored east loop without the sideways slide,
 * spawned on the first slab at the entry speed; true if it comes round. */
async function completesBigLoop(speed: number): Promise<boolean> {
  const rig = await scriptVehicleHarness({ flatPlane: true });
  try {
    const { vehicle, loop, setPad, surfacedBodies, world } = rig;
    const s = vehicle.telemetry;
    const big = pg.loops[1]!;
    const spec: LoopSpec = { ...big, x: 130, z: -40, heading: 0, shift: 0 };
    for (const slab of loopSlabDescriptors(spec))
      surfacedBodies.createStaticBody(slab);
    setPad({ ...PAD, throttle: 1, boost: false });
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
    for (let step = 0; step < 6 * HZ; step++) {
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

it('completes the 18 m east loop at top speed and records the lowest entry speed that does', async () => {
  const speeds = [34, 38, 42, 46, 50, 55, 60];
  const results: Record<number, boolean> = {};
  for (const speed of speeds) results[speed] = await completesBigLoop(speed);
  measurements.bigLoopMinimumEntrySpeed = results;
  expect(results[60]).toBe(true);
  const lowest = speeds.find((speed) => results[speed]);
  expect(lowest).toBeDefined();
  expect(lowest!).toBeLessThanOrEqual(60);
}, 600000);
