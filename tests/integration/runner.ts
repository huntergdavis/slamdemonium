import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect } from 'vitest';
import {
  assertReplay,
  exportInputScript,
  type InputScript,
} from '../../src/input/script';
import type { Vehicle } from '../../src/vehicle/vehicle';
import { scriptVehicleHarness } from '../scriptVehicleHarness';

export const measurements: Record<string, unknown> = {};

export async function runScript(
  script: InputScript,
  observe?: (vehicle: Vehicle, step: number) => void,
) {
  const started = performance.now();
  let maxAngularSpeed = 0;
  const rig = await scriptVehicleHarness({
    flatPlane: true,
    observeStep: (vehicle, step) => {
      maxAngularSpeed = Math.max(
        maxAngularSpeed,
        vehicle.telemetry.angularVelocity.length(),
      );
      observe?.(vehicle, step);
    },
  });
  try {
    rig.scripts.load(exportInputScript(script), { tuning: 'verify' });
    rig.loop.stepMany(script.durationSteps);
    const result = rig.scripts.result();
    assertReplay(result, {
      elapsedSteps: script.durationSteps,
      peakSpeed: {
        min: 0,
        max: script.tuning.topSpeed + script.tuning.boostTopSpeedAdd + 0.1,
      },
    });
    expect(rig.scripts.progress()).toEqual({
      completedSteps: script.durationSteps,
      totalSteps: script.durationSteps,
      done: true,
    });
    expect(rig.vehicle.telemetry.recoveryCount).toBe(0);
    // Design 6.10 and 13.2: engine-side angular clamp, allowing float32 roundoff.
    expect(maxAngularSpeed).toBeLessThanOrEqual(
      script.tuning.maxAngularVelocity + 1e-4,
    );
    return { result, maxAngularSpeed, elapsedMs: performance.now() - started };
  } finally {
    rig.dispose();
  }
}

/** Reuses the WP5 float-bit hashing approach, with SHA-256 and wheel/filter state added.
 * All completed steps participate; wall-clock timings and renderer fields are excluded.
 * Reference: tests/vehicle.test.ts seeded determinism check (WP5 / PR #31).
 */
export class StateHash {
  private readonly hash = createHash('sha256');
  private readonly bits = Buffer.alloc(1024);
  private offset = 0;
  private add(value: number): void {
    if (!Number.isFinite(value))
      throw new Error('Cannot hash non-finite simulation state.');
    this.bits.writeDoubleLE(value, this.offset);
    this.offset += 8;
  }
  record(vehicle: Vehicle, step: number): void {
    this.offset = 0;
    const s = vehicle.telemetry;
    this.add(step);
    for (const vector of [s.position, s.velocity, s.angularVelocity]) {
      this.add(vector.x);
      this.add(vector.y);
      this.add(vector.z);
    }
    this.add(s.rotation.x);
    this.add(s.rotation.y);
    this.add(s.rotation.z);
    this.add(s.rotation.w);
    for (const value of [
      s.speed,
      s.beta,
      s.yawRate,
      s.steerAngle,
      s.boostMeter,
      s.boostEnvelope,
      s.driftTarget,
      s.longitudinalAcceleration,
      s.lateralAcceleration,
      vehicle.controls.throttle,
      vehicle.controls.brake,
      vehicle.controls.steer,
      vehicle.controls.rearGrip,
      Number(vehicle.controls.handbrake),
      Number(vehicle.controls.boost),
      vehicle.drift.side,
      vehicle.drift.holdAngle,
      vehicle.drift.betaDot,
    ])
      this.add(value);
    for (const wheel of s.wheels) {
      for (const value of [
        wheel.Fz,
        wheel.Fx,
        wheel.Fy,
        wheel.mu,
        wheel.alpha,
        wheel.rawAlpha,
        wheel.compression,
        wheel.suspensionLength,
        wheel.steerAngle,
        wheel.spinAngle,
        wheel.vx,
        wheel.vy,
        Number(wheel.grounded),
        Number(wheel.spinning),
        Number(wheel.locked),
      ])
        this.add(value);
    }
    this.hash.update(this.bits);
  }
  digest(): string {
    return this.hash.digest('hex');
  }
}

export function writeMeasurements() {
  mkdirSync('scratch', { recursive: true });
  writeFileSync(
    'scratch/wp9b-integration.json',
    JSON.stringify(
      {
        scope:
          'Node, real stock Jolt + Vehicle, fresh-spawn v1 scripts on a flat plane, stepMany only',
        node: process.version,
        platform: process.platform,
        architecture: process.arch,
        measurements,
      },
      null,
      2,
    ) + '\n',
  );
}
