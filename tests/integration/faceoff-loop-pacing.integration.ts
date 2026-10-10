import { expect, it } from 'vitest';
import { FixedStepLoop } from '../../src/core/loop';
import { MAPS } from '../../src/world/maps';
import { loopMeshDescriptor, loopStepBudget } from '../../src/world/loopDeLoop';
import { scriptVehicleHarness } from '../scriptVehicleHarness';

/** The hosted Face Off route lost the hard loop near its crest on a slow
 * browser frame. This uses the shipped triangle mesh, Sports chassis, a
 * 37.7 m/s approach and keyboard-source steering once per rendered frame. */
it('keeps the authored hard loop drivable at six rendered frames per second', async () => {
  const spec = MAPS['face-off'].loops[1]!;
  const rig = await scriptVehicleHarness({ flatPlane: true });
  try {
    rig.surfacedBodies.createStaticMesh(loopMeshDescriptor(spec));
    const heading = spec.heading;
    rig.vehicle.respawn(
      { x: spec.x + 45, y: 1, z: spec.z },
      { x: 0, y: Math.sin(heading / 2), z: 0, w: Math.cos(heading / 2) },
    );
    rig.world.setLinearVelocity(rig.vehicle.body, { x: -37.7, y: 0, z: 0 });
    expect(loopStepBudget({ x: spec.x + 200, y: 1, z: spec.z }, [spec])).toBe(
      32,
    );
    expect(loopStepBudget({ x: spec.x + 45, y: 1, z: spec.z }, [spec])).toBe(
      16,
    );

    const held = {
      throttle: 0,
      brake: 0,
      steer: 0,
      handbrake: false,
      boost: false,
    };
    const loop = new FixedStepLoop(
      {
        physicsHz: 120,
        timeScale: 1,
        get maxStepsPerFrame() {
          return loopStepBudget(rig.vehicle.telemetry.position, [spec]);
        },
        maxFrameDeltaSeconds: 0.25,
      },
      {
        sampleForStep: () => {},
        preStep: (dt) => rig.vehicle.preStep(dt, held, 'keyboard'),
        stepPhysics: (dt) => rig.world.step(dt),
        postStep: (dt) => rig.vehicle.postStep(dt),
        render: () => {},
      },
    );
    loop.frame(0);
    let now = 0;
    let last = 0;
    let priorError = 0;
    let onLoop = false;
    let maxTheta = 0;
    for (let frame = 1; frame < 6 * 18; frame++) {
      now += 1000 / 6 + (frame === 12 ? 200 : 0);
      const dt = Math.max(0.008, Math.min(0.05, (now - last) / 1000));
      last = now;
      const state = rig.vehicle.telemetry;
      const along = spec.x - state.position.x;
      const across = state.position.z - spec.z;
      if (!onLoop && state.position.y > 1.2 && along > 0) onLoop = true;
      if (onLoop) {
        const theta = Math.atan2(along, spec.radius - state.position.y);
        const wrapped = (theta + 2 * Math.PI) % (2 * Math.PI);
        maxTheta = Math.max(maxTheta, wrapped);
        const error = across - (spec.shift * wrapped) / (2 * Math.PI);
        held.steer = Math.max(
          -1,
          Math.min(1, -0.12 * error - (0.05 * (error - priorError)) / dt),
        );
        priorError = error;
        held.throttle = 1;
        held.brake = 0;
      } else {
        const error = across;
        held.steer = Math.max(
          -1,
          Math.min(1, -0.06 * error - (0.04 * (error - priorError)) / dt),
        );
        priorError = error;
        held.throttle = Math.max(0, Math.min(1, 0.6 * (38 - state.speed)));
        held.brake =
          state.speed > 39.5 ? Math.min(1, 0.3 * (state.speed - 39.5)) : 0;
      }
      loop.frame(now);
    }
    expect(maxTheta).toBeGreaterThan(5.8);
    expect(rig.vehicle.telemetry.position.x).toBeLessThan(spec.x - 100);
    expect(rig.vehicle.telemetry.speed).toBeGreaterThan(40);
  } finally {
    rig.dispose();
  }
}, 30_000);
