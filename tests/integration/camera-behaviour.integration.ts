import { Matrix4, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { expect, it } from 'vitest';
import type { RayHit, V3 } from '../../src/physics/adapter';
import { CameraRig } from '../../src/render/cameraRig';
import {
  loopLanePose,
  loopSlabDescriptors,
  type LoopSpec,
} from '../../src/world/loopDeLoop';
import { scriptVehicleHarness } from '../scriptVehicleHarness';
import { measurements } from './runner';

const HZ = 120;
const DEG = 180 / Math.PI;
const PAD = {
  brake: 0,
  handbrake: false,
  boost: false,
  source: 'gamepad' as const,
};

type Rig = Awaited<ReturnType<typeof scriptVehicleHarness>>;

/** Boot's line-of-sight query, rebuilt here from the same adapter call. */
function lineOfSight(rig: Rig) {
  const hit: RayHit = {
    distance: 0,
    point: { x: 0, y: 0, z: 0 },
    normal: { x: 0, y: 0, z: 0 },
    bodyId: 0,
    surfaceId: 0,
  };
  const dir: V3 = { x: 0, y: 0, z: 0 };
  return (from: Vector3, to: Vector3): number | null => {
    dir.x = to.x - from.x;
    dir.y = to.y - from.y;
    dir.z = to.z - from.z;
    const span = Math.hypot(dir.x, dir.y, dir.z);
    if (span < 1e-6) return null;
    dir.x /= span;
    dir.y /= span;
    dir.z /= span;
    return rig.world.rayCast(from, dir, span, hit, rig.vehicle.body)
      ? hit.distance
      : null;
  };
}

/** Reverse at about 12 m/s with a gentle wobble, the case that used to flip
 * the camera 180 degrees in a frame. */
async function reverse(swing: number) {
  const rig = await scriptVehicleHarness({ flatPlane: true });
  try {
    const { vehicle, loop, setPad, store, world } = rig;
    store.set('camReverseSwing', swing);
    const s = vehicle.telemetry;
    const camera = new PerspectiveCamera();
    const cam = new CameraRig(camera, store, { lineOfSight: lineOfSight(rig) });
    vehicle.respawn({ x: 130, y: 0.86, z: 0 }, { x: 0, y: 0, z: 0, w: 1 });
    world.setLinearVelocity(vehicle.body, { x: 0, y: 0, z: 14 }); // Car faces -Z.
    const previous = new Vector3();
    const travel = new Vector3();
    let frames = 0;
    let maxJump = 0;
    let facingTravel = 0;
    let firstFacingTravel = -1;
    let settledFrames = 0;
    for (let step = 0; step < 5 * HZ; step++) {
      const time = step / HZ;
      setPad({ ...PAD, throttle: 0, steer: 0.15 * Math.sin(time * 2.5) });
      loop.stepMany(1);
      if (step % 2) continue;
      cam.update({ position: s.position, rotation: s.rotation }, s, 1 / 60);
      if (frames > 0)
        maxJump = Math.max(maxJump, previous.angleTo(cam.direction) * DEG);
      previous.copy(cam.direction);
      frames++;
      // Facing the reversing path means the view direction points the way
      // the car is travelling (within 45 degrees). Behind the nose it does not.
      travel.set(s.velocity.x, 0, s.velocity.z).normalize();
      const facing = cam.direction.dot(travel) > Math.SQRT1_2;
      if (time > 2) {
        settledFrames++;
        if (facing) facingTravel++;
      }
      if (firstFacingTravel < 0 && facing) firstFacingTravel = time;
    }
    return {
      frames,
      maxJump,
      travelShare: facingTravel / settledFrames,
      firstOnTravelSide: firstFacingTravel,
    };
  } finally {
    rig.dispose();
  }
}

it('reversing never jumps, and with the swing on the camera comes round to face the reversing path', async () => {
  const swing = await reverse(1);
  measurements.cameraReverseSwing = swing;
  expect(swing.maxJump).toBeLessThan(20); // Was 180 in one frame.
  // Delay then swing: on the travel side well inside two seconds and stays.
  expect(swing.firstOnTravelSide).toBeGreaterThan(0.33);
  expect(swing.firstOnTravelSide).toBeLessThan(2);
  expect(swing.travelShare).toBeGreaterThan(0.95);
  const calm = await reverse(0);
  measurements.cameraReverseCalm = calm;
  expect(calm.maxJump).toBeLessThan(20);
  expect(calm.travelShare).toBeLessThan(0.05); // Stays behind the nose.
}, 300000);

it('does not swing for a reverse blip shorter than the hold', async () => {
  const rig = await scriptVehicleHarness({ flatPlane: true });
  try {
    const { vehicle, loop, setPad, store, world } = rig;
    const s = vehicle.telemetry;
    const cam = new CameraRig(new PerspectiveCamera(), store);
    vehicle.respawn({ x: 130, y: 0.86, z: 0 }, { x: 0, y: 0, z: 0, w: 1 });
    world.setLinearVelocity(vehicle.body, { x: 0, y: 0, z: 6 });
    const travel = new Vector3();
    let facingTravel = 0;
    let frames = 0;
    for (let step = 0; step < 0.25 * HZ; step++) {
      setPad({ ...PAD, throttle: 0, steer: 0 });
      loop.stepMany(1);
      if (step % 2) continue;
      cam.update({ position: s.position, rotation: s.rotation }, s, 1 / 60);
      frames++;
      travel.set(s.velocity.x, 0, s.velocity.z).normalize();
      if (cam.direction.dot(travel) > 0) facingTravel++;
    }
    expect(frames).toBeGreaterThan(10);
    expect(facingTravel).toBe(0); // Still looking over the nose.
  } finally {
    rig.dispose();
  }
});

/** The 10 m loop at 30 m/s: the camera must stay inside the tube and keep a
 * clear line of sight to the car the whole way round. Before this change it
 * was outside on 43 of 99 arc frames and blocked on 41. */
it('keeps the car in sight all the way round a loop', async () => {
  const rig = await scriptVehicleHarness({ flatPlane: true });
  try {
    const { vehicle, loop, setPad, store, surfacedBodies, world } = rig;
    const s = vehicle.telemetry;
    const sight = lineOfSight(rig);
    const cam = new CameraRig(new PerspectiveCamera(), store, {
      lineOfSight: sight,
    });
    const spec: LoopSpec = {
      x: 130,
      z: -40,
      heading: 0,
      radius: 10,
      width: 12,
      shift: 0,
      segments: 48,
    };
    for (const slab of loopSlabDescriptors(spec))
      surfacedBodies.createStaticBody(slab);
    setPad({ ...PAD, throttle: 1, steer: 0 });
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
      x: pose.tangent.x * 30,
      y: pose.tangent.y * 30,
      z: pose.tangent.z * 30,
    });
    const centre = new Vector3(130, 10, -40);
    const bodyUp = new Vector3();
    const previous = new Vector3();
    let arcFrames = 0;
    let outside = 0;
    let blocked = 0;
    let maxJump = 0;
    let frames = 0;
    let inverted = false;
    for (let step = 0; step < 4 * HZ; step++) {
      loop.stepMany(1);
      bodyUp.set(0, 1, 0).applyQuaternion(s.rotation);
      if (bodyUp.y < -0.9 && s.groundedWheels >= 2) inverted = true;
      if (inverted && bodyUp.y > 0.9 && s.position.y < 1.5) break;
      if (step % 2) continue;
      cam.update({ position: s.position, rotation: s.rotation }, s, 1 / 60);
      if (frames > 0)
        maxJump = Math.max(maxJump, previous.angleTo(cam.direction) * DEG);
      previous.copy(cam.direction);
      frames++;
      if (s.position.y <= 1.5) continue;
      arcFrames++;
      const cameraRadius = Math.hypot(
        cam.position.y - centre.y,
        cam.position.z - centre.z,
      );
      if (cameraRadius > spec.radius - 0.3) outside++;
      // The camera's own rendered position, after the pull-in, must see the car.
      if (sight(s.position, cam['camera'].position) !== null) blocked++;
    }
    measurements.cameraLoop = { arcFrames, outside, blocked, maxJump };
    expect(inverted).toBe(true);
    expect(arcFrames).toBeGreaterThan(60);
    expect(blocked).toBe(0);
    expect(outside).toBe(0);
    expect(maxJump).toBeLessThan(20);
  } finally {
    rig.dispose();
  }
}, 300000);
