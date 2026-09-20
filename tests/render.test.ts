import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Quaternion, Scene, Vector3 } from 'three';
import {
  blendDirection,
  boundedFov,
  CameraRig,
  criticallyDamp,
  requestedFov,
} from '../src/render/cameraRig';
import { DynamicResolution } from '../src/render/dynamicResolution';
import {
  createSkidMarks,
  skidOpacity,
  SkidStrip,
} from '../src/render/skidMarks';
import { TuningStore } from '../src/tuning/store';
import { VehicleTelemetry, WheelState } from '../src/vehicle/telemetry';

describe('camera', () => {
  it('caps the final boosted result, preserving the unbounded requested value for tuning', () => {
    const extreme = requestedFov(110, 50, 50, 90, 22.5, 1);
    expect(extreme).toBe(560);
    expect(boundedFov(extreme)).toBe(115);
    expect(boundedFov(requestedFov(70, 15, 15, 60, 60, 0))).toBe(85);
    for (const value of [-Infinity, -3, 0, 180, Infinity, NaN]) {
      expect(boundedFov(value)).toBeGreaterThan(0);
      expect(boundedFov(value)).toBeLessThan(180);
    }
  });

  it('has the same critical-damping solution at 30, 60 and 144 Hz without overshoot', () => {
    const target = new Vector3(10, 2, -7);
    const results = [30, 60, 144].map((hz) => {
      const position = new Vector3(),
        velocity = new Vector3();
      for (let i = 0; i < hz; i++) {
        criticallyDamp(position, velocity, target, 0.25, 1 / hz);
        expect(position.x).toBeGreaterThanOrEqual(0);
        expect(position.x).toBeLessThanOrEqual(10);
      }
      return position;
    });
    expect(results[0]!.distanceTo(results[1]!)).toBeLessThan(1e-12);
    expect(results[0]!.distanceTo(results[2]!)).toBeLessThan(1e-12);
    expect(results[0]!.distanceTo(target)).toBeLessThan(0.04);
  });

  it('blends heading and travel above 8 m/s so drift remains visible; never blends through zero', () => {
    const heading = new Vector3(0, 0, -1),
      velocity = new Vector3(20, 0, 0),
      out = new Vector3();
    blendDirection(heading, velocity, 0.5, out);
    expect(out.x).toBeCloseTo(Math.SQRT1_2);
    expect(out.z).toBeCloseTo(-Math.SQRT1_2);
    blendDirection(heading, velocity.set(8, 99, 0), 1, out);
    expect(out.distanceTo(heading)).toBe(0);
    blendDirection(heading, velocity.set(0, 0, 20), 0.5, out);
    expect(out.length()).toBeCloseTo(1);
    blendDirection(heading, velocity, 0, out);
    expect(out.distanceTo(heading)).toBe(0);
  });

  it('delivers bounded FOV and honest telemetry, honors zero shake/roll, and freezes on zero dt', () => {
    const camera = new PerspectiveCamera(),
      tuning = new TuningStore();
    tuning.set('fovBase', 110);
    tuning.set('fovSpeedGain', 50);
    tuning.set('fovBoostKick', 50);
    tuning.set('camShake', 0);
    tuning.set('camRollGain', 0);
    const rig = new CameraRig(camera, tuning),
      state = new VehicleTelemetry();
    const pose = { position: new Vector3(), rotation: new Quaternion() };
    state.speed = 120;
    state.boostEnvelope = 1;
    state.lateralAcceleration = 40;
    rig.update(pose, state, 1 / 60);
    expect(camera.fov).toBe(115);
    expect(rig.telemetry.cameraFovCapped).toBe(true);
    expect(rig.telemetry.cameraFovRequested).toBeGreaterThan(camera.fov);
    expect(rig.telemetry.cameraRoll).toBe(0);
    expect(camera.position.distanceTo(rig.position)).toBe(0);
    tuning.set('camShake', 1);
    rig.update(pose, state, 0.1);
    const before = camera.position.clone();
    rig.update(pose, state, 0);
    expect(camera.position.distanceTo(before)).toBe(0);
    state.speed = 0;
    state.boostEnvelope = 0;
    rig.update(pose, state, 0);
    expect(camera.fov).toBe(110);
    expect(rig.telemetry.cameraFovCapped).toBe(false);
  });

  it('does not invent an impact from a missing impulse and snaps after respawn', () => {
    const tuning = new TuningStore(),
      camera = new PerspectiveCamera();
    const rig = new CameraRig(camera, tuning),
      state = new VehicleTelemetry();
    const pose = { position: new Vector3(), rotation: new Quaternion() };
    rig.update(pose, state, 0);
    const before = camera.position.clone();
    rig.addImpact(null, 1200);
    rig.update(pose, state, 0.1);
    expect(camera.position.distanceTo(before)).toBe(0);
    pose.position.set(130, 0.86, 0);
    rig.reset();
    rig.update(pose, state, 0);
    expect(camera.position.x).toBe(130);
    expect(camera.position.z).toBe(tuning.get('camDistance'));
    rig.cyclePreset();
    expect(rig.preset).toBe('far');
    rig.cyclePreset(2);
    expect(rig.preset).toBe('chase');
  });
});

describe('dynamic resolution', () => {
  it('waits two overloaded seconds, descends in 0.1 steps to 0.6, then recovers at 60 Hz', () => {
    const controller = new DynamicResolution();
    let now = 0;
    controller.update(now);
    for (let i = 0; i < 79; i++) controller.update((now += 25));
    expect(controller.scale).toBe(1);
    for (let i = 0; i < 3; i++) controller.update((now += 25));
    expect(controller.scale).toBe(0.9);
    for (let i = 0; i < 400; i++) controller.update((now += 25));
    expect(controller.scale).toBe(0.6);
    for (let i = 0; i < 1000; i++) controller.update((now += 1000 / 60));
    expect(controller.scale).toBe(1);
  });

  it('ignores isolated spikes and visibility gaps', () => {
    const controller = new DynamicResolution();
    let now = 0;
    controller.update(now);
    controller.update((now += 100));
    for (let i = 0; i < 120; i++) controller.update((now += 10));
    expect(controller.scale).toBe(1);
    controller.resetClock(); // The visibility owner resets before a resumed frame.
    controller.update((now += 600_000));
    expect(controller.smoothedFrameMs).toBe(0);
    controller.resetClock();
    controller.update(now);
    expect(controller.scale).toBe(1);
  });

  it('still reduces resolution for extremely slow visible rendering', () => {
    const controller = new DynamicResolution();
    controller.update(0);
    controller.update(2500);
    expect(controller.scale).toBe(0.9);
    expect(controller.smoothedFrameMs).toBe(2500);
  });
});

describe('skid strips', () => {
  it('reuses fixed buffers across wraparound, keeps contact offset and fades at 20 seconds', () => {
    const strip = new SkidStrip(4),
      wheel = new WheelState();
    const positions = strip.positions.array,
      births = strip.births.array;
    wheel.grounded = true;
    wheel.locked = true;
    for (let i = 0; i < 12; i++) {
      wheel.contactPoint.z = -i;
      strip.sample(wheel, i);
      strip.upload();
    }
    expect(strip.count).toBe(4);
    expect(strip.written).toBe(11);
    expect(strip.geometry.drawRange.count).toBe(24);
    expect(strip.positions.array).toBe(positions);
    expect(strip.births.array).toBe(births);
    for (let i = 0; i < 24; i++)
      expect(strip.positions.getY(i)).toBeCloseTo(0.012);
    expect(skidOpacity(0)).toBe(0.55);
    expect(skidOpacity(10)).toBe(0.275);
    expect(skidOpacity(20)).toBe(0);
    expect(skidOpacity(50)).toBe(0);
    strip.dispose();
  });

  it('does not bridge airborne, low-slip, respawn or teleport gaps; ignores stationary samples', () => {
    const strip = new SkidStrip(8),
      wheel = new WheelState();
    wheel.grounded = true;
    wheel.gripUsage = 0.96;
    strip.sample(wheel, 0);
    strip.sample(wheel, 1);
    expect(strip.count).toBe(0);
    wheel.contactPoint.z = -1;
    strip.sample(wheel, 2);
    expect(strip.count).toBe(1);
    wheel.grounded = false;
    strip.sample(wheel, 3);
    wheel.grounded = true;
    wheel.contactPoint.z = -2;
    strip.sample(wheel, 4);
    expect(strip.count).toBe(1);
    wheel.gripUsage = 0.95;
    strip.sample(wheel, 5);
    wheel.spinning = true;
    wheel.contactPoint.z = -3;
    strip.sample(wheel, 6);
    expect(strip.count).toBe(1);
    wheel.contactPoint.z = -4;
    strip.sample(wheel, 7);
    expect(strip.count).toBe(2);
    strip.breakStrip();
    wheel.contactPoint.z = -5;
    strip.sample(wheel, 8);
    wheel.contactPoint.z = -100;
    strip.sample(wheel, 9);
    expect(strip.count).toBe(2);
    strip.dispose();
  });

  it('owns exactly four persistent meshes and releases them', () => {
    const scene = new Scene(),
      marks = createSkidMarks(scene);
    expect(scene.children).toHaveLength(4);
    const geometries = marks.strips.map((strip) => strip.geometry);
    const wheels = new VehicleTelemetry().wheels;
    for (const wheel of wheels) {
      wheel.grounded = true;
      wheel.spinning = true;
    }
    for (let i = 0; i < 20; i++) {
      for (const wheel of wheels) wheel.contactPoint.z = -i;
      marks.sample(wheels, i);
      marks.update(i);
    }
    expect(scene.children).toHaveLength(4);
    expect(marks.strips.map((strip) => strip.geometry)).toEqual(geometries);
    marks.update(40);
    expect(scene.children.every((mesh) => !mesh.visible)).toBe(true);
    for (const wheel of wheels) wheel.contactPoint.z = -21;
    marks.sample(wheels, 41);
    marks.update(41);
    expect(scene.children.every((mesh) => mesh.visible)).toBe(true);
    marks.dispose();
    expect(scene.children).toHaveLength(0);
  });
});
