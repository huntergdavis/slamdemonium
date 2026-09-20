import { describe, expect, it, vi } from 'vitest';
import {
  Box3,
  BufferGeometry,
  Color,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Scene,
  Vector3,
} from 'three';
import {
  createCarVisual,
  type VehicleVisualState,
} from '../src/render/carVisual';

function fixture() {
  return {
    position: { x: 130, y: 0.86, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    velocityWorld: { x: 0, y: 0, z: -30 },
    brake01: 0,
    handbrake01: 0,
    wheels: [0, 1, 2, 3].map((i) => ({
      centerLocal: { x: i % 2 ? 0.8 : -0.8, y: -0.52, z: i < 2 ? -1.3 : 1.3 },
      steerAngle: 0,
      spinAngle: 0,
      grounded: true,
      spinning: false,
      locked: false,
      contactPointWorld: {
        x: 130 + (i % 2 ? 0.8 : -0.8),
        y: 0,
        z: i < 2 ? -1.3 : 1.3,
      },
      tireForceWorld: { x: 0, y: 0, z: -4000 },
    })) as [MutableWheel, MutableWheel, MutableWheel, MutableWheel],
  } satisfies VehicleVisualState;
}
type MutableWheel = {
  -readonly [
    K in keyof VehicleVisualState['wheels'][0]
  ]: VehicleVisualState['wheels'][0][K];
};

describe('car visual contract', () => {
  it('matches D1 dimensions, chevron endpoints, strips and wheel witness placement', () => {
    const car = createCarVisual(new Scene());
    const size = new Vector3();
    new Box3()
      .setFromObject(car.root.getObjectByName('car.body')!)
      .getSize(size);
    expect(size.toArray()).toEqual([1.8, 1, 4]);
    for (const [name, a, b] of [
      ['left', [-0.62, 0.503, -0.85], [0, 0.503, -1.72]],
      ['right', [0, 0.503, -1.72], [0.62, 0.503, -0.85]],
    ] as const) {
      const strip = car.root.getObjectByName('car.chevron.' + name)!;
      const start = strip.localToWorld(new Vector3(0, -0.5, 0));
      const end = strip.localToWorld(new Vector3(0, 0.5, 0));
      expect(start.distanceTo(new Vector3(...a))).toBeLessThan(1e-12);
      expect(end.distanceTo(new Vector3(...b))).toBeLessThan(1e-12);
      expect(strip.scale.x).toBe(0.16);
    }
    const nose = car.root.getObjectByName('car.nose')!;
    expect(nose.position.toArray()).toEqual([0, 0.125, -2.003]);
    expect(nose.scale.toArray()).toEqual([0.26, 0.75, 1]);
    const tail = car.root.getObjectByName('car.tail')!;
    expect(tail.position.toArray()).toEqual([0, 0.08, 2.003]);
    expect(tail.scale.toArray()).toEqual([1.44, 0.14, 1]);
    for (const [i, name] of ['FL', 'FR', 'RL', 'RR'].entries()) {
      const wheel = car.root.getObjectByName('car.wheel.' + name)!;
      new Box3().setFromObject(wheel).getSize(size);
      expect(size.x).toBeCloseTo(0.24);
      expect(size.y).toBeCloseTo(0.68);
      expect(size.z).toBeCloseTo(0.68);
      const witness = car.root.getObjectByName(
        'car.wheel.' + name + '.witness',
      )!;
      expect(witness.position.x).toBe(i % 2 ? 0.123 : -0.123);
      expect(witness.scale.toArray()).toEqual([0.05, 0.34, 1]);
    }
    car.dispose();
  });

  it('follows pose and each suspension center, steers only fronts, and wraps forward spin', () => {
    const car = createCarVisual(new Scene());
    const state = fixture();
    state.position.y = 2;
    state.rotation = new Quaternion().setFromAxisAngle(
      new Vector3(0, 1, 0),
      0.4,
    );
    for (const wheel of state.wheels) {
      wheel.centerLocal = { ...wheel.centerLocal, y: -0.65 };
      wheel.steerAngle = 0.3;
      wheel.spinAngle = -Math.PI / 2;
    }
    car.update(state);
    expect(car.root.position.toArray()).toEqual([130, 2, 0]);
    expect(car.root.quaternion.y).toBe(state.rotation.y);
    for (const [i, name] of ['FL', 'FR', 'RL', 'RR'].entries()) {
      const pivot = car.root.getObjectByName('car.wheel.' + name + '.steer')!;
      const spin = car.root.getObjectByName('car.wheel.' + name + '.spin')!;
      expect(pivot.position.y).toBe(-0.65);
      expect(pivot.rotation.y).toBe(i < 2 ? 0.3 : 0);
      expect(spin.rotation.x).toBeCloseTo(1.5 * Math.PI);
      // The +Y witness rotates forward toward -Z before parent steering.
      const top = new Vector3(0, 1, 0).applyQuaternion(spin.quaternion);
      expect(top.z).toBeCloseTo(-1);
    }
    car.dispose();
  });

  it('uses producer spin across wrap/lock/spin states without integrating time', () => {
    const car = createCarVisual(new Scene());
    const state = fixture();
    const spin = car.root.getObjectByName('car.wheel.RR.spin')!;
    state.wheels[3].spinAngle = 0.01;
    car.update(state);
    const before = spin.quaternion.clone();
    state.wheels[3].spinAngle = Math.PI * 2 - 0.01;
    car.update(state);
    expect(before.angleTo(spin.quaternion)).toBeCloseTo(0.02);
    state.wheels[3].locked = true;
    const locked = spin.quaternion.clone();
    for (let i = 0; i < 10; i++) car.update(state);
    expect(locked.angleTo(spin.quaternion)).toBeCloseTo(0);
    state.wheels[3].locked = false;
    state.wheels[3].spinning = true;
    state.wheels[3].spinAngle = 4;
    car.update(state);
    expect(spin.rotation.x).toBe(4);
    car.dispose();
  });

  it('brightens only from actual brake/handbrake and clamps invalid brake inputs', () => {
    const car = createCarVisual(new Scene());
    const state = fixture();
    const tail = car.root.getObjectByName('car.tail') as Mesh<
      BufferGeometry,
      MeshBasicMaterial
    >;
    state.velocityWorld.z = 10; // Reversing alone keeps idle color.
    car.update(state);
    expect(tail.material.color.getHex()).toBe(0x9f2838);
    state.handbrake01 = 0.7;
    state.brake01 = 0.4;
    car.update(state);
    expect(
      tail.material.color.equals(
        new Color(0x9f2838).lerp(new Color(0xff6570), 0.7),
      ),
    ).toBe(true);
    state.brake01 = 4;
    car.update(state);
    expect(tail.material.color.getHex()).toBe(0xff6570);
    state.brake01 = NaN;
    state.handbrake01 = -1;
    car.update(state);
    expect(tail.material.color.getHex()).toBe(0x9f2838);
    car.dispose();
  });

  it('projects H/V to the ground and draws world tire forces only for grounded wheels', () => {
    const scene = new Scene();
    const car = createCarVisual(scene);
    const state = fixture();
    car.update(state);
    expect(scene.getObjectByName('car.gizmos')!.visible).toBe(false);
    car.toggleDebug();
    const heading = scene.getObjectByName('car.gizmos.heading')!;
    const velocity = scene.getObjectByName('car.gizmos.velocity')!;
    expect(heading.position.toArray()).toEqual([130, 0.045, 0]);
    state.velocityWorld = { x: 30, y: 80, z: 0 };
    car.update(state);
    expect(velocity.rotation.y).toBeCloseTo(-Math.PI / 2);
    const force = scene.getObjectByName('car.gizmos.force.FL')!;
    expect(force.position.toArray()).toEqual([129.2, 0.06, -1.3]);
    const tip = force
      .getObjectByName('car.gizmos.force.FL.head')!
      .localToWorld(new Vector3(0, 0.5, 0));
    expect(tip.x).toBeCloseTo(129.2);
    expect(tip.z).toBeCloseTo(-3.3); // 4 kN = 2 m, remains world-forward.
    state.wheels[0].grounded = false;
    state.wheels[1].tireForceWorld = { x: 0, y: 0, z: 0 };
    state.velocityWorld = { x: 0, y: 100, z: 0 };
    state.rotation = new Quaternion().setFromAxisAngle(
      new Vector3(1, 0, 0),
      Math.PI / 2,
    );
    car.update(state);
    expect(force.visible).toBe(false);
    expect(scene.getObjectByName('car.gizmos.force.FR')!.visible).toBe(false);
    expect(velocity.visible).toBe(false);
    expect(heading.visible).toBe(false); // Vertical nose has no ground heading.
    car.toggleDebug();
    expect(scene.getObjectByName('car.gizmos')!.visible).toBe(false);
    car.dispose();
  });

  it('reuses the scene graph and disposes shared resources exactly once', () => {
    const scene = new Scene();
    const car = createCarVisual(scene);
    const state = fixture();
    const geometryDisposals = new Map();
    const materialDisposals = new Map();
    const nodes: object[] = [];
    scene.traverse((object) => {
      nodes.push(object);
      if (!(object instanceof Mesh)) return;
      for (const [resource, records] of [
        [object.geometry, geometryDisposals],
        [object.material, materialDisposals],
      ] as const) {
        if (records.has(resource)) continue;
        const listener = vi.fn();
        resource.addEventListener('dispose', listener);
        records.set(resource, listener);
      }
    });
    car.setDebugVisible(true);
    for (let i = 0; i < 500; i++) car.update(state);
    const after: object[] = [];
    scene.traverse((object) => after.push(object));
    expect(after).toEqual(nodes);
    car.dispose();
    car.dispose();
    expect(scene.children).toHaveLength(0);
    for (const listener of [
      ...geometryDisposals.values(),
      ...materialDisposals.values(),
    ])
      expect(listener).toHaveBeenCalledOnce();
  });
});
