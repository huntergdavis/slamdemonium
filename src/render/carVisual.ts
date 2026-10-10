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
import { VEHICLE_GEOMETRY as G } from '../vehicle/constants';
import type { CarCrushState } from '../world/carModels';

export type { VehicleVisualState, WheelVisualState } from './carVisualState';

const TAU = Math.PI * 2;
const WHEEL_NAMES = ['FL', 'FR', 'RL', 'RR'] as const;
const WIDTH_SCALE = G.width / 1.8;
const HEIGHT_SCALE = G.height;
const LENGTH_SCALE = G.length / 4;

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
  // The player's single body can be deformed only when an impact changes its
  // damage state. Subdivision gives a real folded outline in colour and shadow.
  const bodyGeometry = geometry(new BoxGeometry(1, 1, 1, 6, 4, 8));
  const bodyPositions = bodyGeometry.getAttribute('position');
  const pristineBody = new Float32Array(bodyPositions.array);
  const unitPlane = geometry(new PlaneGeometry(1, 1));
  const bodyMaterial = material(
    new MeshStandardMaterial({
      color: 0xff6b24,
      roughness: 0.72,
      metalness: 0,
    }),
  );
  function setPaint(paint: 'orange' | 'vesper-gold'): void {
    bodyMaterial.color.setHex(paint === 'vesper-gold' ? 0xe8c741 : 0xff6b24);
  }
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
  const body = mesh(root, 'car.body', bodyGeometry, bodyMaterial);
  body.scale.set(G.width, G.height, G.length);
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
    // Each strip has its own vertices so the white arrow follows a buckled hood.
    const stripGeometry = geometry(new PlaneGeometry(1, 1, 1, 8));
    const strip = mesh(root, name, stripGeometry, noseMaterial);
    strip.position.set(
      ((ax + bx) / 2) * WIDTH_SCALE,
      G.height / 2 + 0.003,
      ((az + bz) / 2) * LENGTH_SCALE,
    );
    strip.rotation.set(-Math.PI / 2, 0, Math.atan2(ax - bx, az - bz));
    strip.scale.set(
      0.16 * WIDTH_SCALE,
      Math.hypot((bx - ax) * WIDTH_SCALE, (bz - az) * LENGTH_SCALE),
      1,
    );
    strip.updateMatrix();
    const positions = stripGeometry.getAttribute('position');
    chevronStrips.push({
      strip,
      positions,
      pristine: new Float32Array(positions.array),
      inverse: strip.matrix.clone().invert(),
    });
  }
  const chevronStrips: {
    strip: Mesh;
    positions: ReturnType<BufferGeometry['getAttribute']>;
    pristine: Float32Array;
    inverse: ReturnType<Mesh['matrix']['clone']>;
  }[] = [];
  topStrip('car.chevron.left', -0.62, -0.85, 0, -1.72);
  topStrip('car.chevron.right', 0, -1.72, 0.62, -0.85);
  const nose = mesh(root, 'car.nose', unitPlane, noseMaterial);
  nose.position.set(0, 0.125 * HEIGHT_SCALE, -G.length / 2 - 0.003);
  nose.scale.set(0.26 * WIDTH_SCALE, 0.75 * HEIGHT_SCALE, 1);
  const tail = mesh(root, 'car.tail', unitPlane, tailMaterial);
  tail.position.set(0, 0.08 * HEIGHT_SCALE, G.length / 2 + 0.003);
  tail.scale.set(1.44 * WIDTH_SCALE, 0.14 * HEIGHT_SCALE, 1);

  const visibleCrush: CarCrushState = {
    front: 0,
    rear: 0,
    left: 0,
    right: 0,
  };
  const band = (coordinate: number) => {
    const t = Math.min(1, Math.max(0, (coordinate - 0.06) / 0.38));
    return t * t * (3 - 2 * t);
  };
  const crease = (coordinate: number, center: number, halfWidth: number) =>
    Math.max(0, 1 - Math.abs(coordinate - center) / halfWidth);
  function deformedBodyPoint(
    x: number,
    y: number,
    z: number,
    crush: Readonly<CarCrushState>,
  ): [number, number, number] {
    const nx = x / G.width;
    const ny = y / G.height;
    const nz = z / G.length;
    const front = crush.front * band(-nz);
    const rear = crush.rear * band(nz);
    const left = crush.left * band(-nx);
    const right = crush.right * band(nx);
    const fold = 0.82 + 0.18 * Math.sin(nx * 19 + nz * 13 + ny * 7);
    const roof = band(ny);
    // Shorten and pinch the nose, then buckle the hood across the part the
    // chase camera actually sees. The shifted creases make the fold diagonal.
    const frontCorner = front * Math.min(1, Math.abs(nx) * 2);
    const trough = crush.front * crease(nz, -0.3 - nx * 0.05, 0.13);
    const crest =
      crush.front *
      crease(nz, -0.1 + nx * 0.045, 0.145) *
      (0.82 + 0.18 * Math.cos(nx * 9));
    return [
      x + (left - right) * 0.42 * fold - Math.sign(x) * frontCorner * 0.35,
      y -
        roof *
          (0.39 * (front + rear) +
            0.3 * (left + right) +
            0.24 * trough +
            0.15 * frontCorner) +
        roof * 0.9 * crest,
      z + front * 1.08 * (0.92 + 0.08 * fold) - rear * 0.72 * fold,
    ];
  }
  function setCrush(next: Readonly<CarCrushState>): void {
    if (
      visibleCrush.front === next.front &&
      visibleCrush.rear === next.rear &&
      visibleCrush.left === next.left &&
      visibleCrush.right === next.right
    )
      return;
    Object.assign(visibleCrush, next);
    for (let i = 0; i < bodyPositions.count; i++) {
      const [x, y, z] = deformedBodyPoint(
        pristineBody[i * 3]! * G.width,
        pristineBody[i * 3 + 1]! * G.height,
        pristineBody[i * 3 + 2]! * G.length,
        next,
      );
      bodyPositions.setXYZ(i, x / G.width, y / G.height, z / G.length);
    }
    bodyPositions.needsUpdate = true;
    bodyGeometry.computeVertexNormals();
    for (const { strip, positions, pristine, inverse } of chevronStrips) {
      for (let i = 0; i < positions.count; i++) {
        const point = new Vector3(
          pristine[i * 3]!,
          pristine[i * 3 + 1]!,
          pristine[i * 3 + 2]!,
        ).applyMatrix4(strip.matrix);
        const [x, y, z] = deformedBodyPoint(point.x, point.y, point.z, next);
        point.set(x, y, z).applyMatrix4(inverse);
        positions.setXYZ(i, point.x, point.y, point.z);
      }
      positions.needsUpdate = true;
      strip.geometry.computeVertexNormals();
    }
    nose.position.z = -G.length / 2 - 0.003 + next.front * 1.08;
    nose.position.y = 0.125 * HEIGHT_SCALE - next.front * 0.3;
    nose.scale.y = (0.75 - next.front * 0.18) * HEIGHT_SCALE;
    tail.position.z = G.length / 2 + 0.003 - next.rear * 0.55;
  }

  const wheelGeometry = geometry(
    new BoxGeometry(0.24 * WIDTH_SCALE, 2 * G.wheelRadius, 2 * G.wheelRadius),
  );
  const wheels = WHEEL_NAMES.map((name, index) => {
    const pivot = new Group();
    pivot.name = 'car.wheel.' + name + '.steer';
    pivot.position.set(
      index % 2 ? G.track / 2 : -G.track / 2,
      -0.52 * HEIGHT_SCALE,
      index < 2 ? -G.wheelbase / 2 : G.wheelbase / 2,
    );
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
    stripe.position.set(
      index % 2 ? 0.123 * WIDTH_SCALE : -0.123 * WIDTH_SCALE,
      G.wheelRadius / 2,
      0,
    );
    stripe.rotation.y = Math.PI / 2;
    stripe.scale.set(0.05 * WIDTH_SCALE, G.wheelRadius, 1);
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
  return {
    root,
    update,
    setCrush,
    setPaint,
    setDebugVisible,
    toggleDebug,
    dispose,
  };
}
