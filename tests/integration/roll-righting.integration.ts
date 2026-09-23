import { Matrix4, Quaternion, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { SURFACE_IDS } from '../../src/content/surfaces';
import type { SurfacedStaticBodyDesc } from '../../src/world/surfacedBodies';
import { scriptVehicleHarness } from '../scriptVehicleHarness';

const HZ = 120;

/** A loop of pitched slabs in the vertical plane along -Z, bottom tangent to
 * the ground at z0. Test geometry only; the authored loop is separate data. */
function loopSlabs(
  x0: number,
  z0: number,
  radius: number,
  width: number,
  segments: number,
): SurfacedStaticBodyDesc[] {
  const out: SurfacedStaticBodyDesc[] = [];
  const thickness = 0.3;
  const arc = (2 * Math.PI * radius) / segments;
  for (let i = 0; i < segments; i++) {
    const theta = ((i + 0.5) * 2 * Math.PI) / segments;
    const p = new Vector3(
      x0,
      radius * (1 - Math.cos(theta)),
      z0 - radius * Math.sin(theta),
    );
    const tangent = new Vector3(0, Math.sin(theta), -Math.cos(theta));
    const up = new Vector3(0, Math.cos(theta), Math.sin(theta));
    const right = new Vector3().crossVectors(up, tangent).normalize();
    const q = new Quaternion().setFromRotationMatrix(
      new Matrix4().makeBasis(right, up, tangent),
    );
    const center = p.clone().addScaledVector(up, -thickness / 2);
    out.push({
      center: { x: center.x, y: center.y, z: center.z },
      halfExtents: { x: width / 2, y: thickness / 2, z: (arc * 1.12) / 2 },
      rotation: { x: q.x, y: q.y, z: q.z, w: q.w },
      friction: 0.5,
      restitution: 0,
      surface: SURFACE_IDS.asphalt,
    });
  }
  return out;
}

/** Before the gate, the righting assist read a loop as a flipped car and
 * applied its full torque about the forward axis the whole way round: on
 * this ride it produced a 1 rad/s roll rate and a quarter metre of lateral
 * drift. Measured against the ground under the car, it stays silent. */
it('does not fight an inverted car that is riding a loop: no roll rate, no drift, and it rides down upright', async () => {
  const rig = await scriptVehicleHarness({ flatPlane: true });
  try {
    const { vehicle, loop, setPad, surfacedBodies, world } = rig;
    const s = vehicle.telemetry;
    const radius = 8;
    const z0 = -40;
    for (const slab of loopSlabs(130, z0, radius, 12, 48))
      surfacedBodies.createStaticBody(slab);
    // Spawn upside down just before the top, moving over it toward +Z.
    const theta = (170 * Math.PI) / 180;
    const p = new Vector3(
      130,
      radius * (1 - Math.cos(theta)),
      z0 - radius * Math.sin(theta),
    );
    const forward = new Vector3(0, Math.sin(theta), -Math.cos(theta)).negate();
    const up = new Vector3(0, Math.cos(theta), Math.sin(theta));
    const back = forward.clone().negate();
    const right = new Vector3().crossVectors(up, back).normalize();
    const q = new Quaternion().setFromRotationMatrix(
      new Matrix4().makeBasis(right, up, back),
    );
    const spawn = p.clone().addScaledVector(up, 0.86);
    setPad({
      throttle: 0.3,
      brake: 0,
      steer: 0,
      handbrake: false,
      boost: false,
      source: 'gamepad',
    });
    vehicle.respawn(
      { x: spawn.x, y: spawn.y, z: spawn.z },
      { x: q.x, y: q.y, z: q.z, w: q.w },
    );
    world.setLinearVelocity(vehicle.body, {
      x: forward.x * 22,
      y: forward.y * 22,
      z: forward.z * 22,
    });
    const bodyUp = new Vector3();
    const fwd = new Vector3();
    let maxRollRate = 0;
    let maxDrift = 0;
    let groundedOnArc = 0;
    let arcSteps = 0;
    let downUpright = false;
    for (let step = 0; step < 3 * HZ; step++) {
      loop.stepMany(1);
      bodyUp.set(0, 1, 0).applyQuaternion(s.rotation);
      fwd.set(0, 0, -1).applyQuaternion(s.rotation);
      const onArc =
        s.position.y > 1.5 &&
        Math.abs(
          Math.hypot(s.position.y - radius, z0 - s.position.z) - radius,
        ) < 3;
      if (onArc) {
        arcSteps++;
        if (s.groundedWheels > 0) groundedOnArc++;
        maxRollRate = Math.max(
          maxRollRate,
          Math.abs(s.angularVelocity.dot(fwd)),
        );
        maxDrift = Math.max(maxDrift, Math.abs(s.position.x - 130));
      }
      if (
        s.position.y < 1.3 &&
        s.groundedWheels === 4 &&
        bodyUp.y > 0.9 &&
        s.position.z > z0 - 1
      ) {
        downUpright = true;
        break;
      }
    }
    expect(arcSteps).toBeGreaterThan(60);
    expect(groundedOnArc / arcSteps).toBeGreaterThan(0.85);
    expect(maxRollRate).toBeLessThan(0.05);
    expect(maxDrift).toBeLessThan(0.05);
    expect(downUpright).toBe(true);
    expect(s.recoveryCount).toBe(0);
  } finally {
    rig.dispose();
  }
});

/** The rescue the assist exists for still works: a car dropped on its roof
 * on flat ground, at rest, rights itself. */
it('still rights a car that is flipped on flat ground', async () => {
  const rig = await scriptVehicleHarness({ flatPlane: true });
  try {
    const { vehicle, loop, setPad } = rig;
    const s = vehicle.telemetry;
    setPad({
      throttle: 0,
      brake: 0,
      steer: 0,
      handbrake: false,
      boost: false,
      source: 'gamepad',
    });
    // Nearly upside down, slightly rolled so there is a side to fall to.
    const q = new Quaternion().setFromAxisAngle(
      new Vector3(0, 0, 1),
      Math.PI - 0.3,
    );
    vehicle.respawn(
      { x: 130, y: 1.2, z: 0 },
      { x: q.x, y: q.y, z: q.z, w: q.w },
    );
    const bodyUp = new Vector3();
    let uprightAt = -1;
    for (let step = 0; step < 5 * HZ; step++) {
      loop.stepMany(1);
      bodyUp.set(0, 1, 0).applyQuaternion(s.rotation);
      if (bodyUp.y > 0.9 && s.groundedWheels === 4) {
        uprightAt = step / HZ;
        break;
      }
    }
    expect(uprightAt).toBeGreaterThan(0);
    expect(uprightAt).toBeLessThan(5);
  } finally {
    rig.dispose();
  }
});
