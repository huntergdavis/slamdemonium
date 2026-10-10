import { expect, it } from 'vitest';
import {
  createImpactSeverity,
  estimateImpactSeverity,
} from '../../src/core/impactSeverity';
import { Takedowns } from '../../src/core/takedowns';
import { sampleRoad } from '../../src/world/roadGenerator';
import { createTraffic } from '../../src/world/traffic';
import {
  neutralScriptInput,
  scriptVehicleHarness,
} from '../scriptVehicleHarness';

const DT = 1 / 120;

async function runRivalWreck(aftertouch: boolean) {
  const harness = await scriptVehicleHarness({ flatPlane: true });
  const { world, surfacedBodies, vehicle } = harness;
  const path = sampleRoad([{ kind: 'straight', length: 500 }], {
    x: 0,
    z: 0,
    heading: 0,
  });
  const traffic = createTraffic(world, surfacedBodies, path, [
    { station: 140, laneSide: -1, speed: 20, rival: true },
  ]);
  const takedowns = new Takedowns();
  if (aftertouch) takedowns.beginAftertouchEpisode();
  const impact = createImpactSeverity();
  const normal = { x: 0, y: 0, z: 0 };
  const relative = { x: 0, y: 0, z: 0 };
  let contacts = 0;
  let peakSeverity = 0;
  let wreckEventSteps = 0;
  try {
    traffic.preStep(DT, { x: 3.5, y: 1, z: -130 });
    world.step(DT);
    traffic.postStep();
    const rival = traffic.states[0]!;
    expect(rival.bodyId).toBeGreaterThan(0);
    // A boosted rear-end against a slowing rival must still award the
    // takedown even though the race AI now reaches boosted pace itself.
    world.setLinearVelocity(rival.bodyId, { x: 0, y: 0, z: 0 });
    vehicle.respawn(
      { x: rival.position.x, y: 1, z: rival.position.z + 12 },
      { x: 0, y: 0, z: 0, w: 1 },
    );
    world.setLinearVelocity(vehicle.body, { x: 0, y: 0, z: -80 });
    world.onContact((a, b, impulse, _point, contactNormal) => {
      const other = a === vehicle.body ? b : b === vehicle.body ? a : -1;
      if (other !== rival.bodyId) return;
      const sign = a === vehicle.body ? -1 : 1;
      normal.x = contactNormal.x * sign;
      normal.y = contactNormal.y * sign;
      normal.z = contactNormal.z * sign;
      const trafficVelocity = traffic.velocityForBody(other)!;
      relative.x = vehicle.telemetry.velocity.x - trafficVelocity.x;
      relative.y = vehicle.telemetry.velocity.y - trafficVelocity.y;
      relative.z = vehicle.telemetry.velocity.z - trafficVelocity.z;
      estimateImpactSeverity(
        impulse,
        relative,
        normal,
        vehicle.currentMass,
        impact,
      );
      peakSeverity = Math.max(peakSeverity, impact.severity);
      takedowns.notePlayerContact(traffic.stateForBody(other), impact.severity);
      traffic.onPlayerContact(other, impact, normal, relative);
      contacts++;
    });
    for (let step = 0; step < 240; step++) {
      vehicle.preStep(DT, neutralScriptInput, 'gamepad');
      traffic.preStep(DT, vehicle.telemetry.position, vehicle.telemetry.speed);
      world.step(DT);
      traffic.postStep(vehicle.body, vehicle.currentMass);
      vehicle.postStep(DT);
      if (traffic.newlyWrecked.length > 0) {
        expect(traffic.newlyWrecked).toContain(rival);
        wreckEventSteps++;
      }
      const victim = takedowns.update(DT, traffic.newlyWrecked);
      if (victim) vehicle.awardTakedown();
    }
    expect(contacts).toBeGreaterThan(0);
    expect(peakSeverity).toBeGreaterThan(0.25);
    expect(rival.wrecked).toBe(true);
    expect(wreckEventSteps).toBe(1);
    expect(traffic.newlyWrecked).toHaveLength(0);
    expect(takedowns.count).toBe(1);
    expect(takedowns.lastCreditKind).toBe(
      aftertouch ? 'aftertouch' : 'ordinary',
    );
    expect(vehicle.telemetry.boostSections).toBe(2);
  } finally {
    traffic.dispose();
    harness.dispose();
  }
}

it(
  'awards one ordinary takedown and boost section for a real rival wreck',
  () => runRivalWreck(false),
  120_000,
);

it(
  'awards one Aftertouch takedown and boost section from a real rival wreck',
  () => runRivalWreck(true),
  120_000,
);
