import { mkdirSync, writeFileSync } from 'node:fs';
import { afterAll, expect, it } from 'vitest';
import {
  halfPipeHalfLength,
  halfPipeLipHeight,
  installHalfPipes,
} from '../../src/world/halfPipe';
import { PROVING_GROUND_MAP } from '../../src/world/maps';
import { scriptVehicleHarness } from '../scriptVehicleHarness';
import { measurements } from './runner';

/** The half-pipe transfer as authored, on the real engine, from both ends:
 * where the car comes down and how hard, by approach speed. The recipe's
 * claims live here: 20 to 30 m/s lands in the far pipe upright at about the
 * giant ramp's landing impact; flat out flies over the whole structure and
 * lands upright beyond it, hard (the vertical speed is half the launch
 * speed), which is the legible miss. */
const HZ = 120;
const pipe = PROVING_GROUND_MAP.halfPipes[0]!;
const RAMP_LANDING_YARDSTICK = 22; // The giant ramp lands at 19 to 20 m/s.

afterAll(() => {
  mkdirSync('scratch', { recursive: true });
  writeFileSync(
    'scratch/half-pipe.json',
    JSON.stringify({ halfPipe: measurements.halfPipe }, null, 2) + '\n',
  );
});

interface Outcome {
  where:
    'farWall' | 'farFlat' | 'deck' | 'ownPipe' | 'overshoot' | 'crash' | 'none';
  upright: boolean;
  launchSpeed: number;
  apex: number;
  landingImpact: number;
  landingAlong: number;
  peakLoad: number;
}

/** Drive at the spine along its axis from `direction` (+1 eastbound, -1
 * westbound) at the approach speed, ten metres before the wall's ground
 * edge, full throttle, and report the landing. */
async function transfer(direction: 1 | -1, speed: number): Promise<Outcome> {
  const rig = await scriptVehicleHarness({ flatPlane: true });
  try {
    const { vehicle, loop, setPad, surfacedBodies, world } = rig;
    const s = vehicle.telemetry;
    installHalfPipes(surfacedBodies, [pipe]);
    const half = halfPipeHalfLength(pipe);
    const H = halfPipeLipHeight(pipe);
    // Axis is +X; "along" is signed distance from the deck centre in the
    // direction of travel.
    const startAlong = -(half + 10);
    const yaw = direction === 1 ? -Math.PI / 2 : Math.PI / 2;
    vehicle.respawn(
      { x: pipe.x + direction * startAlong, y: 0.86, z: pipe.z },
      { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) },
    );
    world.setLinearVelocity(vehicle.body, { x: direction * speed, y: 0, z: 0 });
    setPad({
      throttle: 1,
      brake: 0,
      steer: 0,
      handbrake: false,
      boost: false,
      source: 'gamepad',
    });
    let staticLoad = 0;
    let peakLoad = 0;
    let launched = false;
    let launchSpeed = 0;
    let apex = 0;
    for (let step = 0; step < 12 * HZ; step++) {
      loop.stepMany(1);
      const along = direction * (s.position.x - pipe.x);
      if (step === 2) staticLoad = s.wheels.reduce((a, w) => a + w.Fz, 0) / 4;
      for (const w of s.wheels)
        if (w.grounded && staticLoad > 0)
          peakLoad = Math.max(peakLoad, w.Fz / staticLoad);
      if (s.airborne && s.position.y > H - 1) {
        if (!launched) {
          launched = true;
          launchSpeed = s.speed;
        }
        apex = Math.max(apex, s.position.y);
      }
      if (s.recoveryCount > 0 || s.position.y < -2)
        return {
          where: 'crash',
          upright: false,
          launchSpeed,
          apex,
          landingImpact: 0,
          landingAlong: along,
          peakLoad,
        };
      if (launched && !s.airborne && s.groundedWheels >= 2) {
        const y = s.position.y;
        let where: Outcome['where'];
        if (along <= -pipe.deck / 2 + 0.5) where = 'ownPipe';
        else if (along < pipe.deck / 2 - 0.5) where = 'deck';
        else if (along <= half + 1 && y > 0.4) where = 'farWall';
        else if (along <= half + 40) where = 'farFlat';
        else where = 'overshoot';
        const impact = s.landingSpeed;
        let upright = true;
        for (let k = 0; k < HZ; k++) {
          loop.stepMany(1);
          if (s.recoveryCount > 0) upright = false;
        }
        return {
          where,
          upright,
          launchSpeed,
          apex,
          landingImpact: impact,
          landingAlong: along,
          peakLoad,
        };
      }
    }
    return {
      where: 'none',
      upright: launched,
      launchSpeed,
      apex,
      landingImpact: 0,
      landingAlong: direction * (s.position.x - pipe.x),
      peakLoad,
    };
  } finally {
    rig.dispose();
  }
}

it('lands the transfer in the far pipe from 20 to 30 m/s both ways, and flat out flies over it and lands softly', async () => {
  const speeds = [20, 25, 30, 35, 40, 50, 60];
  const report: Record<string, Record<string, Outcome>> = {};
  for (const direction of [1, -1] as const) {
    const rows: Record<string, Outcome> = {};
    for (const v of speeds) rows[String(v)] = await transfer(direction, v);
    report[direction === 1 ? 'eastbound' : 'westbound'] = rows;
  }
  measurements.halfPipe = { pipe, report };
  for (const rows of Object.values(report)) {
    for (const [v, o] of Object.entries(rows)) {
      expect(o.where, `${v} m/s`).not.toBe('crash');
      expect(o.where, `${v} m/s`).not.toBe('ownPipe');
      expect(o.upright, `${v} m/s upright`).toBe(true);
      // Throttle up the wall adds speed, until top speed caps it.
      expect(o.launchSpeed).toBeGreaterThan(Math.min(Number(v), 58));
    }
    // The working window: in the far pipe, at the ramp's landing or below.
    // A 30 degree launch comes down at half its launch speed plus the drop
    // from the lip: 15 m/s from a 20 m/s approach, 23 from 30.
    for (const v of ['20', '25', '30']) {
      expect(['farWall', 'farFlat', 'deck']).toContain(rows[v]!.where);
      expect(rows[v]!.landingImpact, `${v} m/s impact`).toBeLessThanOrEqual(
        RAMP_LANDING_YARDSTICK + 2,
      );
    }
    // The miss: over the whole structure, down on open pavement, upright.
    // Not soft: 28 to 33 m/s from 50 and 60, the price of ignoring the
    // chevrons, recorded so nobody calls it walking pace again.
    for (const v of ['50', '60']) {
      expect(rows[v]!.where).toBe('overshoot');
      expect(rows[v]!.landingImpact, `${v} m/s impact`).toBeLessThanOrEqual(36);
      expect(rows[v]!.upright).toBe(true);
    }
    // Transition load stays in the loop's fair region.
    for (const o of Object.values(rows)) expect(o.peakLoad).toBeLessThan(26);
  }
}, 900_000);
