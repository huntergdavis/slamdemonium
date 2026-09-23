import { Matrix4, Quaternion, Vector3 } from 'three';
import { mkdirSync, writeFileSync } from 'node:fs';
import { afterAll, expect, it } from 'vitest';
import {
  LOOP_LAYOUT,
  loopSlabDescriptors,
  type LoopSpec,
} from '../../src/world/loopDeLoop';
import { PROVING_GROUND_MAP } from '../../src/world/maps';
import { scriptVehicleHarness } from '../scriptVehicleHarness';
import { measurements } from './runner';

/** How forgiving a loop is, measured: the widest entry angle, the largest
 * lateral offset and the lowest entry speed from which the car still comes
 * out the far side. Every run drives the real helix from the ground with a
 * plain lane-following test driver (proportional steering toward the lane
 * centreline, saturating at full lock), the way a player aims; nothing in
 * the game steers for the player. The two authored loops are measured side
 * by side: the lab's 10 m loop (the control) and the proving ground's 18 m
 * loop. */
const HZ = 120;

/** Each integration file runs in its own worker, so this file writes its
 * own measurements; the numbers are the deliverable for the CTO. */
afterAll(() => {
  mkdirSync('scratch', { recursive: true });
  const picked: Record<string, unknown> = {};
  for (const key of ['loopForgiveness'])
    if (key in measurements) picked[key] = measurements[key];
  writeFileSync(
    'scratch/loop-forgiveness.json',
    JSON.stringify(picked, null, 2) + '\n',
  );
});
const DEG = Math.PI / 180;

interface Outcome {
  completed: boolean;
  reason: 'completed' | 'fell' | 'recovery' | 'stalled';
  peakSteerDeg: number;
  peakAlphaDeg: number;
  minMu: number;
  peakGripUsage: number;
  peakFzRatio: number;
  entrySpeed: number;
  exitSpeed: number;
}

const baseSpec = (spec: LoopSpec): LoopSpec => ({
  ...spec,
  x: 0,
  z: 0,
  heading: Math.PI, // Entry lane runs along +Z.
});

export async function attempt(
  spec: LoopSpec,
  speed: number,
  entryAngleDeg: number,
  lateralOffset: number,
  drive: boolean,
  inside: { kick: number; ride: number } = { kick: 0, ride: 0 },
  tuning: Readonly<Record<string, number>> = {},
  trace?: (
    step: number,
    x: number,
    y: number,
    z: number,
    steer: number,
    speed: number,
    grounded: number,
  ) => void,
): Promise<Outcome> {
  const rig = await scriptVehicleHarness({ flatPlane: true });
  try {
    const { vehicle, loop, setPad, surfacedBodies, world, store } = rig;
    for (const [key, value] of Object.entries(tuning))
      store.set(key as Parameters<typeof store.set>[0], value);
    const s = vehicle.telemetry;
    for (const slab of loopSlabDescriptors(spec))
      surfacedBodies.createStaticBody(slab);
    const f = new Vector3(0, 0, 1); // Heading pi.
    const left = new Vector3(1, 0, 0); // up x forward.
    const R = spec.radius;
    // Start 45 m before the entry, aimed so the path meets the entry point
    // (plus the lateral offset) at the entry angle; positive angle aims left.
    const dir = f
      .clone()
      .applyAxisAngle(new Vector3(0, 1, 0), entryAngleDeg * DEG);
    const entry = new Vector3(spec.x, 0, spec.z).addScaledVector(
      left,
      lateralOffset,
    );
    const start = entry.clone().addScaledVector(dir, -45);
    const back = dir.clone().negate();
    const q = new Quaternion().setFromRotationMatrix(
      new Matrix4().makeBasis(
        new Vector3().crossVectors(new Vector3(0, 1, 0), back),
        new Vector3(0, 1, 0),
        back,
      ),
    );
    vehicle.respawn(
      { x: start.x, y: 0.86, z: start.z },
      { x: q.x, y: q.y, z: q.z, w: q.w },
    );
    world.setLinearVelocity(vehicle.body, {
      x: dir.x * speed,
      y: 0,
      z: dir.z * speed,
    });
    const bodyUp = new Vector3();
    const rel = new Vector3();
    let inverted = false;
    let steer = 0;
    let previousError = 0;
    const out: Outcome = {
      completed: false,
      reason: 'stalled',
      peakSteerDeg: 0,
      peakAlphaDeg: 0,
      minMu: Infinity,
      peakGripUsage: 0,
      peakFzRatio: 0,
      entrySpeed: speed,
      exitSpeed: 0,
    };
    let staticFz = 0;
    for (let step = 0; step < 8 * HZ; step++) {
      setPad({
        throttle: 1,
        brake: 0,
        steer,
        handbrake: false,
        boost: false,
        source: 'gamepad',
      });
      loop.stepMany(1);
      trace?.(
        step,
        s.position.x,
        s.position.y,
        s.position.z,
        steer,
        s.speed,
        s.groundedWheels,
      );
      if (step === 2) staticFz = s.wheels.reduce((sum, w) => sum + w.Fz, 0) / 4;
      // Relative to the lane centreline at the entry, not the offset start.
      rel.copy(s.position).sub(entry).addScaledVector(left, lateralOffset);
      const along = rel.dot(f);
      const across = rel.dot(left);
      const onLoop = s.position.y > 1.2;
      if (onLoop) {
        // Lane angle from height and forward progress; lane centre slides
        // with it. Steer toward the centreline like a driver aiming.
        const theta = Math.atan2(along, R - s.position.y);
        const laneAcross =
          (spec.shift * ((theta + 2 * Math.PI) % (2 * Math.PI))) /
          (2 * Math.PI);
        // `ride` asks the driver to hold a line that far off centre, toward
        // the side the exit slides away from (the outside of the helix).
        const outward = -Math.sign(spec.shift || 1);
        const error = across - laneAcross - outward * inside.ride;
        const rate = (error - previousError) * HZ;
        previousError = error;
        steer = drive
          ? Math.max(-1, Math.min(1, -0.12 * error - 0.05 * rate))
          : 0;
        // `kick`: a quarter second of fixed steer toward the outside between
        // 60 and 105 degrees up the wall, the over-correction the CTO makes
        // when he tries to adjust his line.
        if (
          inside.kick > 0 &&
          theta > Math.PI / 3 &&
          theta < (7 * Math.PI) / 12
        )
          steer = outward * inside.kick;
        for (const w of s.wheels) {
          if (!w.grounded) continue;
          out.minMu = Math.min(out.minMu, w.mu);
          out.peakGripUsage = Math.max(out.peakGripUsage, w.gripUsage);
          out.peakAlphaDeg = Math.max(
            out.peakAlphaDeg,
            Math.abs(w.alpha) / DEG,
          );
          if (staticFz > 0)
            out.peakFzRatio = Math.max(out.peakFzRatio, w.Fz / staticFz);
        }
        out.peakSteerDeg = Math.max(
          out.peakSteerDeg,
          Math.abs(s.steerAngle) / DEG,
        );
        if (s.airborne && s.airTime > 0.4) {
          out.reason = 'fell';
          return out;
        }
      } else if (drive && along < 0) {
        // Approach: aim at the lane centre, damped so the car arrives
        // travelling straight rather than swinging through the centreline.
        const error = across;
        const rate = (error - previousError) * HZ;
        previousError = error;
        steer = Math.max(-1, Math.min(1, -0.06 * error - 0.04 * rate));
      } else steer = 0;
      bodyUp.set(0, 1, 0).applyQuaternion(s.rotation);
      if (bodyUp.y < -0.9 && s.groundedWheels >= 2) inverted = true;
      if (s.recoveryCount > 0) {
        out.reason = 'recovery';
        return out;
      }
      if (
        inverted &&
        bodyUp.y > 0.9 &&
        s.groundedWheels === 4 &&
        s.position.y < 1.2 &&
        along > 2
      ) {
        out.completed = true;
        out.reason = 'completed';
        out.exitSpeed = s.speed;
        return out;
      }
    }
    return out;
  } finally {
    rig.dispose();
  }
}

/** Largest value in `values` (ascending) whose attempt completes, scanning
 * until the first failure; -1 if the first fails. */
async function widest(
  values: readonly number[],
  run: (value: number) => Promise<Outcome>,
  table: Record<string, Outcome>,
): Promise<number> {
  let best = -1;
  for (const value of values) {
    const outcome = await run(value);
    table[String(value)] = outcome;
    if (!outcome.completed) break;
    best = value;
  }
  return best;
}

const forgiving = PROVING_GROUND_MAP.loops[1]!;
export const LOOPS: Record<string, LoopSpec> = {
  /** The lab loop, 10 m, the control: reads as broken, kept on the lab ring. */
  small: baseSpec(LOOP_LAYOUT[0]!),
  /** The west loop as authored: 14 m, the measured minimum fair radius. */
  west: baseSpec(PROVING_GROUND_MAP.loops[0]!),
  /** The east loop as first built: bigger radius only (the "before"). */
  bigPlain: baseSpec({
    x: forgiving.x,
    z: forgiving.z,
    heading: forgiving.heading,
    radius: forgiving.radius,
    width: 16,
    shift: 18,
    segments: forgiving.segments,
  }),
  /** The east loop as authored: wide lane, banked shoulders, sticky surface. */
  big: baseSpec(forgiving),
};
const ANGLES = [0, 2, 4, 6, 8, 10, 12, 15, 18, 21, 25, 30];
const KICKS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
const RIDES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12];
const OFFSETS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const SPEEDS_DOWN = [60, 54, 48, 44, 40, 36, 32, 28, 24, 20, 16];

it('measures entry angle, lateral offset and speed tolerance of both authored loops', async () => {
  const report: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(LOOPS)) {
    const good = name === 'small' ? 40 : name === 'west' ? 44 : 50;
    const angles: Record<string, Outcome> = {};
    const offsets: Record<string, Outcome> = {};
    const speeds: Record<string, Outcome> = {};
    const angle = await widest(
      ANGLES,
      (a) => attempt(spec, good, a, 0, true),
      angles,
    );
    const offset = await widest(
      OFFSETS,
      (o) => attempt(spec, good, 0, o, true),
      offsets,
    );
    // Speed: scan downward, the floor is the lowest that still completes.
    let floor = Infinity;
    for (const v of SPEEDS_DOWN) {
      const outcome = await attempt(spec, v, 0, 0, true);
      speeds[String(v)] = outcome;
      if (outcome.completed) floor = v;
      else if (floor < Infinity) break;
    }
    const kicks: Record<string, Outcome> = {};
    const rides: Record<string, Outcome> = {};
    const kick = await widest(
      KICKS,
      (k) => attempt(spec, good, 0, 0, true, { kick: k, ride: 0 }),
      kicks,
    );
    const ride = await widest(
      RIDES,
      (d) => attempt(spec, good, 0, 0, true, { kick: 0, ride: d }),
      rides,
    );
    const noDriver = await attempt(spec, good, 0, 0, false);
    report[name] = {
      radius: spec.radius,
      width: spec.width,
      shift: spec.shift,
      atSpeed: good,
      entryAngleToleranceDeg: angle,
      lateralOffsetToleranceM: offset,
      lowestCompletingSpeed: floor,
      steerKickTolerance: kick,
      rideOffCentreToleranceM: ride,
      noSteeringCompletes: noDriver.completed,
      noSteering: noDriver,
      angles,
      offsets,
      speeds,
      kicks,
      rides,
    };
  }
  measurements.loopForgiveness = report;
  // Sanity only: the measurement is the deliverable. Both loops complete a
  // dead-on entry at a good speed.
  expect(
    (report.small as { angles: Record<string, Outcome> }).angles['0']!
      .completed,
  ).toBe(true);
  // The rule, pinned: the minimum fair loop takes a crooked entry and a
  // kick; the control takes neither.
  const west = report.west as {
    entryAngleToleranceDeg: number;
    lateralOffsetToleranceM: number;
    steerKickTolerance: number;
  };
  expect(west.entryAngleToleranceDeg).toBeGreaterThanOrEqual(8);
  expect(west.lateralOffsetToleranceM).toBeGreaterThanOrEqual(2);
  expect(west.steerKickTolerance).toBeGreaterThanOrEqual(0.6);
  expect(
    (report.big as { angles: Record<string, Outcome> }).angles['0']!.completed,
  ).toBe(true);
}, 1_200_000);
