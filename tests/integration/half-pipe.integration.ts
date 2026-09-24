import { afterAll, expect, it } from 'vitest';
import {
  halfPipeHalfLength,
  halfPipeLipHeight,
  installHalfPipes,
} from '../../src/world/halfPipe';
import { PROVING_GROUND_MAP } from '../../src/world/maps';
import { scriptVehicleHarness } from '../scriptVehicleHarness';
import { measurements } from './runner';

/** Real-Jolt ride-along probe for the ground-level aquifer channel. The U is
 * intentionally tested as a sustained wall ride, not as a launcher: its
 * smooth 15-metre walls are contained at 40–50 m/s and brief airborne carving
 * is expected; 60 m/s is recorded as a lateral launch rather than hidden by a
 * staircase collider. */
const HZ = 120;
const pipe = PROVING_GROUND_MAP.halfPipes[0]!;
const STATIC_LOAD = 1300 * 20;

interface RideOutcome {
  readonly speed: number;
  readonly steer: number;
  readonly maxGroundedHeight: number;
  readonly maxChassisHeight: number;
  readonly airborneFraction: number;
  readonly peakLoad: number;
  readonly maxAbsAcross: number;
  readonly recovered: boolean;
}

async function ride(speed: number, steer: number): Promise<RideOutcome> {
  const rig = await scriptVehicleHarness({ flatPlane: true });
  try {
    const { vehicle, loop, setPad, surfacedBodies, world } = rig;
    installHalfPipes(surfacedBodies, [pipe]);
    const half = halfPipeHalfLength(pipe);
    const yaw = -Math.PI / 2;
    vehicle.respawn(
      { x: pipe.x - half - 24, y: 0.86, z: pipe.z },
      { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) },
    );
    world.setLinearVelocity(vehicle.body, { x: speed, y: 0, z: 0 });
    setPad({
      throttle: 1,
      brake: 0,
      steer,
      handbrake: false,
      boost: false,
      source: 'gamepad',
    });
    let maxGroundedHeight = 0;
    let maxChassisHeight = 0;
    let airborne = 0;
    let peakLoad = 0;
    let maxAbsAcross = 0;
    const steps = 10 * HZ;
    for (let step = 0; step < steps; step++) {
      loop.stepMany(1);
      const t = vehicle.telemetry;
      maxChassisHeight = Math.max(maxChassisHeight, t.position.y);
      if (t.airborne) airborne++;
      maxGroundedHeight = Math.max(
        maxGroundedHeight,
        maxChassisHeight,
        t.wheels.reduce(
          (m, wheel) =>
            wheel.grounded ? Math.max(m, wheel.contactPoint.y) : m,
          0,
        ),
      );
      for (const wheel of t.wheels)
        peakLoad = Math.max(peakLoad, wheel.Fz / STATIC_LOAD);
      maxAbsAcross = Math.max(maxAbsAcross, Math.abs(t.position.z - pipe.z));
    }
    return {
      speed,
      steer,
      maxGroundedHeight,
      maxChassisHeight,
      airborneFraction: airborne / steps,
      peakLoad,
      maxAbsAcross,
      recovered: vehicle.telemetry.recoveryCount > 0,
    };
  } finally {
    rig.dispose();
  }
}

const report: RideOutcome[] = [];
afterAll(() => {
  measurements.halfPipe = {
    recipe: {
      radius: pipe.radius,
      lipHeight: halfPipeLipHeight(pipe),
      floorWidth: pipe.width,
      length: pipe.deck,
      gravity: 20,
    },
    ride: report,
    launcher: {
      reliableReturn: false,
      measured:
        'R16-R18 launch outside; only R22-R25 returned marginally at one speed with 34-54x static load',
    },
  };
});

it('rides the 15 m aquifer walls at gravity 20 without a recovery', async () => {
  for (const speed of [40, 50, 60])
    for (const steer of [-0.12, 0.12]) report.push(await ride(speed, steer));

  const rideable = report.filter((r) => r.speed <= 50);
  const launchSpeed = report.filter((r) => r.speed === 60);
  expect(Math.max(...rideable.map((r) => r.maxGroundedHeight))).toBeGreaterThan(
    5,
  );
  expect(Math.max(...rideable.map((r) => r.peakLoad))).toBeLessThan(40);
  expect(Math.max(...rideable.map((r) => r.airborneFraction))).toBeLessThan(
    0.4,
  );
  expect(rideable.every((r) => !r.recovered)).toBe(true);
  expect(Math.max(...rideable.map((r) => r.maxAbsAcross))).toBeLessThan(120);
  expect(Math.min(...launchSpeed.map((r) => r.maxAbsAcross))).toBeGreaterThan(
    120,
  );
}, 900_000);
