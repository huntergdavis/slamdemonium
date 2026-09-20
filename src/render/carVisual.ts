import {
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
  Vector3,
  type Material,
  type Scene,
} from 'three';
import type { VehicleVisualState } from './carVisualState';

export type { VehicleVisualState, WheelVisualState } from './carVisualState';

const TAU = Math.PI * 2;
const WHEEL_NAMES = ['FL', 'FR', 'RL', 'RR'] as const;

/** Mount once; update with render-ready state. Owns no physics, input or camera. */
export function createCarVisual(scene: Scene) {
  const root = new Group();
  root.name = 'car';
  const debug = new Group();
  debug.name = 'car.gizmos';
  debug.visible = false;
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  function geometry<T extends BufferGeometry>(value: T): T {
    geometries.add(value);
    return value;
  }
  function material<T extends Material>(value: T): T {
    materials.add(value);
    return value;
  }
  const unitBox = geometry(new BoxGeometry(1, 1, 1));
  const unitPlane = geometry(new PlaneGeometry(1, 1));
  const bodyMaterial = material(
    new MeshStandardMaterial({
      color: 0xff6b24,
      roughness: 0.72,
      metalness: 0,
    }),
  );
  const rubberMaterial = material(
    new MeshStandardMaterial({
      color: 0x171b20,
      roughness: 0.95,
      metalness: 0,
    }),
  );
  function unlit(color: number, overlay = false) {
    return material(
      new MeshBasicMaterial({
        color,
        toneMapped: false,
        side: DoubleSide,
        depthTest: !overlay,
        depthWrite: !overlay,
        fog: !overlay,
      }),
    );
  }
  const noseMaterial = unlit(0xfff4b3);
  const witnessMaterial = unlit(0xabb7c0);
  const tailMaterial = unlit(0x9f2838);
  const idleColor = new Color(0x9f2838);
  const brakeColor = new Color(0xff6570);

  function mesh(
    parent: Group,
    name: string,
    shape: BufferGeometry,
    surface: Material,
  ) {
    const object = new Mesh(shape, surface);
    object.name = name;
    parent.add(object);
    return object;
  }
  const body = mesh(root, 'car.body', unitBox, bodyMaterial);
  body.scale.set(1.8, 1, 4);
  body.castShadow = true;
  body.receiveShadow = true;

  // Strip centerlines are exact D1 endpoints, not a guessed chevron texture.
  function topStrip(
    name: string,
    ax: number,
    az: number,
    bx: number,
    bz: number,
  ) {
    const strip = mesh(root, name, unitPlane, noseMaterial);
    strip.position.set((ax + bx) / 2, 0.503, (az + bz) / 2);
    strip.rotation.set(-Math.PI / 2, 0, Math.atan2(ax - bx, az - bz));
    strip.scale.set(0.16, Math.hypot(bx - ax, bz - az), 1);
  }
  topStrip('car.chevron.left', -0.62, -0.85, 0, -1.72);
  topStrip('car.chevron.right', 0, -1.72, 0.62, -0.85);
  const nose = mesh(root, 'car.nose', unitPlane, noseMaterial);
  nose.position.set(0, 0.125, -2.003);
  nose.scale.set(0.26, 0.75, 1);
  const tail = mesh(root, 'car.tail', unitPlane, tailMaterial);
  tail.position.set(0, 0.08, 2.003);
  tail.scale.set(1.44, 0.14, 1);

  const wheelGeometry = geometry(new BoxGeometry(0.24, 0.68, 0.68));
  const wheels = WHEEL_NAMES.map((name, index) => {
    const pivot = new Group();
    pivot.name = 'car.wheel.' + name + '.steer';
    pivot.position.set(index % 2 ? 0.8 : -0.8, -0.52, index < 2 ? -1.3 : 1.3);
    root.add(pivot);
    const spin = new Group();
    spin.name = 'car.wheel.' + name + '.spin';
    pivot.add(spin);
    const tire = mesh(spin, 'car.wheel.' + name, wheelGeometry, rubberMaterial);
    tire.castShadow = true;
    tire.receiveShadow = true;
    // One radial stripe from hub to +Y edge, on the outside X face only.
    const stripe = mesh(
      spin,
      'car.wheel.' + name + '.witness',
      unitPlane,
      witnessMaterial,
    );
    stripe.position.set(index % 2 ? 0.123 : -0.123, 0.17, 0);
    stripe.rotation.y = Math.PI / 2;
    stripe.scale.set(0.05, 0.34, 1);
    return { pivot, spin };
  });

  const headingMaterial = unlit(0xfff4b3, true);
  const velocityMaterial = unlit(0x3ed8ee, true);
  const forceMaterial = unlit(0xffd166, true);
  const dotGeometry = geometry(new CircleGeometry(0.09, 12));
  const headGeometry = geometry(new BufferGeometry());
  headGeometry.setAttribute(
    'position',
    new Float32BufferAttribute([-0.22, 0, 0, 0.22, 0, 0, 0, 0, -0.5], 3),
  );

  function overlayMesh(
    parent: Group,
    name: string,
    shape: BufferGeometry,
    surface: Material,
  ) {
    const object = mesh(parent, name, shape, surface);
    object.renderOrder = 20;
    return object;
  }
  function groundArrow(name: string, surface: Material, letter: 'H' | 'V') {
    const group = new Group();
    group.name = name;
    debug.add(group);
    const shaft = overlayMesh(group, name + '.shaft', unitBox, surface);
    const head = overlayMesh(group, name + '.head', headGeometry, surface);
    const dot = overlayMesh(group, name + '.tail', dotGeometry, surface);
    dot.rotation.x = -Math.PI / 2;
    const label = new Group();
    label.name = name + '.label';
    group.add(label);
    // Geometry labels keep the module usable in Node tests and need no canvas/font.
    function stroke(ax: number, az: number, bx: number, bz: number) {
      const object = overlayMesh(label, name + '.glyph', unitBox, surface);
      object.position.set((ax + bx) / 2, 0, (az + bz) / 2);
      object.scale.set(0.055, 0.008, Math.hypot(bx - ax, bz - az));
      object.rotation.y = Math.atan2(bx - ax, bz - az);
    }
    if (letter === 'H') {
      stroke(-0.16, -0.23, -0.16, 0.23);
      stroke(0.16, -0.23, 0.16, 0.23);
      stroke(-0.16, 0, 0.16, 0);
    } else {
      stroke(-0.2, -0.23, 0, 0.23);
      stroke(0, 0.23, 0.2, -0.23);
    }
    function setLength(length: number) {
      shaft.scale.set(0.085, 0.008, length - 0.5);
      shaft.position.z = -(length - 0.5) / 2;
      head.position.z = -(length - 0.5);
      label.position.z = -length - 0.4;
    }
    return { group, setLength };
  }
  const heading = groundArrow('car.gizmos.heading', headingMaterial, 'H');
  heading.setLength(4.6);
  const velocity = groundArrow('car.gizmos.velocity', velocityMaterial, 'V');
  const cone = geometry(new ConeGeometry(1, 1, 8));
  const sphere = geometry(new SphereGeometry(0.055, 8, 6));
  const forces = WHEEL_NAMES.map((name) => {
    const group = new Group();
    group.name = 'car.gizmos.force.' + name;
    debug.add(group);
    const shaft = overlayMesh(
      group,
      group.name + '.shaft',
      unitBox,
      forceMaterial,
    );
    const head = overlayMesh(group, group.name + '.head', cone, forceMaterial);
    overlayMesh(group, group.name + '.tail', sphere, forceMaterial);
    return { group, shaft, head };
  });
  const direction = new Vector3();
  const up = new Vector3(0, 1, 0);
  let lastState: VehicleVisualState | undefined;
  let disposed = false;
  scene.add(root, debug);

  function updateDebug(state: VehicleVisualState): void {
    direction.set(0, 0, -1).applyQuaternion(root.quaternion);
    const horizontalHeading = Math.hypot(direction.x, direction.z);
    heading.group.visible = horizontalHeading > 1e-6;
    heading.group.position.set(state.position.x, 0.045, state.position.z);
    if (heading.group.visible)
      heading.group.rotation.y = Math.atan2(-direction.x, -direction.z);
    const speed = Math.hypot(state.velocityWorld.x, state.velocityWorld.z);
    velocity.group.visible = Number.isFinite(speed) && speed >= 0.25;
    velocity.group.position.set(state.position.x, 0.035, state.position.z);
    if (velocity.group.visible) {
      velocity.group.rotation.y = Math.atan2(
        -state.velocityWorld.x,
        -state.velocityWorld.z,
      );
      velocity.setLength(Math.min(7, Math.max(0.75, speed * 0.12)));
    }
    for (let index = 0; index < 4; index++) {
      const wheel = state.wheels[index]!;
      const force = forces[index]!;
      direction.copy(wheel.tireForceWorld);
      const magnitude = direction.length();
      force.group.visible =
        wheel.grounded && Number.isFinite(magnitude) && magnitude >= 1;
      if (!force.group.visible) continue;
      // 1 m / 2 kN, clipped at 4 m; no false minimum force length.
      const length = Math.min(4, magnitude / 2000);
      const headLength = Math.min(0.3, length * 0.3);
      force.group.position.copy(wheel.contactPointWorld);
      force.group.position.y += 0.06;
      direction.multiplyScalar(1 / magnitude);
      force.group.quaternion.setFromUnitVectors(up, direction);
      force.shaft.scale.set(0.045, length - headLength, 0.045);
      force.shaft.position.y = (length - headLength) / 2;
      force.head.scale.set(headLength * 0.45, headLength, headLength * 0.45);
      force.head.position.y = length - headLength / 2;
    }
  }

  function update(state: VehicleVisualState): void {
    if (disposed) return;
    lastState = state;
    root.position.copy(state.position);
    root.quaternion.copy(state.rotation);
    for (let index = 0; index < 4; index++) {
      const source = state.wheels[index]!;
      const wheel = wheels[index]!;
      wheel.pivot.position.copy(source.centerLocal);
      wheel.pivot.rotation.y = index < 2 ? source.steerAngle : 0;
      wheel.spin.rotation.x = ((source.spinAngle % TAU) + TAU) % TAU;
    }
    const braking = Math.max(
      Number.isFinite(state.brake01) ? state.brake01 : 0,
      Number.isFinite(state.handbrake01) ? state.handbrake01 : 0,
    );
    tailMaterial.color.lerpColors(
      idleColor,
      brakeColor,
      Math.min(1, Math.max(0, braking)),
    );
    if (debug.visible) updateDebug(state);
  }
  function setDebugVisible(visible: boolean): void {
    if (disposed) return;
    debug.visible = visible;
    if (visible && lastState) updateDebug(lastState);
  }
  function toggleDebug(): void {
    setDebugVisible(!debug.visible);
  }
  function dispose(): void {
    if (disposed) return;
    disposed = true;
    root.removeFromParent();
    debug.removeFromParent();
    for (const value of geometries) value.dispose();
    for (const value of materials) value.dispose();
    lastState = undefined;
  }
  return { root, update, setDebugVisible, toggleDebug, dispose };
}
