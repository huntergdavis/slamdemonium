import {
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  InstancedMesh,
  MeshStandardMaterial,
  Object3D,
  type Scene,
} from 'three';
import type { ImpactSeverity } from '../core/impactSeverity';
import { SURFACE_IDS } from '../content/surfaces';
import type { BodyId, IPhysicsWorld, Quat, V3 } from '../physics/adapter';
import type { RoadPath } from './roadGenerator';
import type { SurfacedBodies } from './surfacedBodies';

interface MutableRoadPose {
  x: number;
  z: number;
  heading: number;
}

export interface TrafficCarRecord {
  readonly station: number;
  readonly laneSide: -1 | 1;
  readonly speed: number;
  /** +1 follows circuit stations; -1 travels against them. */
  readonly direction?: -1 | 1;
}

/** Mutable, reused snapshots. Encounter ids never repeat, even when a pooled
 * body is recycled; bodyId is the physical identity for contact dispatch. */
export interface TrafficCarState {
  id: number;
  bodyId: BodyId;
  position: V3;
  rotation: Quat;
  forward: V3;
  velocity: V3;
  laneSide: -1 | 1;
  direction: -1 | 1;
  speed: number;
  wrecked: boolean;
}

interface RecordState {
  readonly authored: TrafficCarRecord;
  station: number;
  readonly state: TrafficCarState;
  wrecked: boolean;
  wreckPosition: V3;
  wreckRotation: Quat;
  slot: Slot | null;
}

interface Slot {
  readonly bodyId: BodyId;
  record: RecordState | null;
  friction: number;
}

const BODY_HALF = { x: 0.95, y: 0.55, z: 2.1 };
const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };
const ENTER = 120;
const EXIT = 180;
const VISUAL_RADIUS = 750;
export const MAX_DRIVING = 12;
const POOL_SIZE = MAX_DRIVING;
const BODY_MASS = 1100;
// A box has no driven wheels: road friction above the 5 m/s² controller cap
// stops it outright. Restore heavy contact friction after a wreck so it settles.
const DRIVE_FRICTION = 0.05;
const WRECK_FRICTION = 0.7;
const RESTITUTION = 0.05;

function horizontalDistanceSquared(a: V3, x: number, z: number): number {
  const dx = a.x - x;
  const dz = a.z - z;
  return dx * dx + dz * dz;
}

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** Every authored car advances continuously. Only nearby cars own a pooled
 * Jolt body; their stable encounter state survives each LOD hand-off. */
export function createTraffic(
  physics: IPhysicsWorld,
  bodies: SurfacedBodies,
  path: RoadPath,
  records: readonly TrafficCarRecord[],
) {
  const authored: RecordState[] = records.map((record, index) => ({
    authored: record,
    station: record.station,
    state: {
      id: index + 1,
      bodyId: -1,
      position: { x: 0, y: BODY_HALF.y + 0.04, z: 0 },
      rotation: { ...IDENTITY },
      forward: { x: 0, y: 0, z: -1 },
      velocity: { x: 0, y: 0, z: 0 },
      laneSide: record.laneSide,
      direction: record.direction ?? 1,
      speed: record.speed,
      wrecked: false,
    },
    wrecked: false,
    wreckPosition: { x: 0, y: 0, z: 0 },
    wreckRotation: { ...IDENTITY },
    slot: null,
  }));
  const slots: Slot[] = [];
  const allStates = authored.map((record) => record.state);
  const visualStates: TrafficCarState[] = [];
  let physicalCount = 0;
  const readPosition: V3 = { x: 0, y: 0, z: 0 };
  const readRotation: Quat = { ...IDENTITY };
  const readVelocity: V3 = { x: 0, y: 0, z: 0 };
  const force: V3 = { x: 0, y: 0, z: 0 };
  const point: V3 = { x: 0, y: 0, z: 0 };
  const angular: V3 = { x: 0, y: 0, z: 0 };
  const routeScratch: MutableRoadPose = { x: 0, z: 0, heading: 0 };
  const nextScratch: MutableRoadPose = { x: 0, z: 0, heading: 0 };

  for (let i = 0; i < POOL_SIZE; i++) {
    const bodyId = bodies.createPooledBox({
      motion: 'dynamic',
      surface: SURFACE_IDS.concrete,
      halfExtents: BODY_HALF,
      mass: BODY_MASS,
      comOffset: { x: 0, y: -0.15, z: 0 },
      inertiaScale: { x: 1, y: 1, z: 1 },
      friction: DRIVE_FRICTION,
      restitution: RESTITUTION,
      ccd: true,
      maxAngularVelocity: 9,
      angularDamping: 0.25,
    });
    slots.push({
      bodyId,
      record: null,
      friction: DRIVE_FRICTION,
    });
  }

  function routePose(
    record: RecordState,
    station: number,
    out: MutableRoadPose,
  ): MutableRoadPose {
    const { samples, length } = path;
    const s = path.closed
      ? ((station % length) + length) % length
      : Math.max(0, Math.min(length, station));
    let lo = 0;
    let hi = samples.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (samples[mid]!.s <= s) lo = mid;
      else hi = mid;
    }
    const a = samples[lo]!;
    const b = samples[hi]!;
    const span = b.s - a.s;
    const t = span > 0 ? (s - a.s) / span : 0;
    out.heading = a.heading + (b.heading - a.heading) * t;
    out.x =
      a.x +
      (b.x - a.x) * t -
      Math.cos(out.heading) * record.authored.laneSide * 3.5;
    out.z =
      a.z +
      (b.z - a.z) * t +
      Math.sin(out.heading) * record.authored.laneSide * 3.5;
    return out;
  }

  function updateVisualPose(record: RecordState): void {
    if (record.wrecked) return;
    const pose = routePose(record, record.station, routeScratch);
    const state = record.state;
    const facing = pose.heading + (state.direction < 0 ? Math.PI : 0);
    state.position.x = pose.x;
    state.position.y = BODY_HALF.y + 0.04;
    state.position.z = pose.z;
    state.rotation.x = state.rotation.z = 0;
    state.rotation.y = Math.sin(facing / 2);
    state.rotation.w = Math.cos(facing / 2);
    state.forward.x = -Math.sin(facing);
    state.forward.y = 0;
    state.forward.z = -Math.cos(facing);
    state.velocity.x = state.forward.x * record.authored.speed;
    state.velocity.y = 0;
    state.velocity.z = state.forward.z * record.authored.speed;
    state.speed = record.authored.speed;
  }

  for (const record of authored) updateVisualPose(record);

  function promote(record: RecordState): void {
    const slot = slots.find((candidate) => candidate.record === null);
    if (!slot) return;
    const state = record.state;
    physics.activateBody(slot.bodyId, state.position, state.rotation, true);
    slot.friction = record.wrecked ? WRECK_FRICTION : DRIVE_FRICTION;
    physics.setContactProperties(slot.bodyId, slot.friction, RESTITUTION);
    slot.record = record;
    record.slot = slot;
    state.bodyId = slot.bodyId;
    if (!record.wrecked) physics.setLinearVelocity(slot.bodyId, state.velocity);
    physicalCount++;
  }

  function demote(record: RecordState): void {
    const slot = record.slot;
    if (!slot) return;
    if (record.wrecked) {
      physics.getTransform(
        slot.bodyId,
        record.wreckPosition,
        record.wreckRotation,
      );
      Object.assign(record.state.position, record.wreckPosition);
      Object.assign(record.state.rotation, record.wreckRotation);
    }
    physics.deactivateBody(slot.bodyId);
    record.state.bodyId = -1;
    slot.record = null;
    record.slot = null;
    physicalCount--;
  }

  function makeRoomFor(player: V3, candidateDistanceSquared: number): void {
    if (physicalCount < MAX_DRIVING) return;
    // A closer intact car takes a body from a farther one. Hysteresis keeps
    // two cars at the edge from swapping bodies every step.
    const threshold = Math.sqrt(candidateDistanceSquared) + 20;
    let farthest = threshold * threshold;
    let victim: RecordState | null = null;
    for (const slot of slots) {
      const record = slot.record;
      if (!record || record.wrecked) continue;
      const distance = horizontalDistanceSquared(
        player,
        record.state.position.x,
        record.state.position.z,
      );
      if (distance > farthest) {
        farthest = distance;
        victim = record;
      }
    }
    if (victim) demote(victim);
  }

  function preStep(dt: number, player: V3): void {
    visualStates.length = 0;
    for (const record of authored) {
      const state = record.state;
      if (!record.wrecked) {
        const direction = state.direction;
        record.station =
          (((record.station + direction * record.authored.speed * dt) %
            path.length) +
            path.length) %
          path.length;
      }
      if (!record.slot) updateVisualPose(record);
      const distanceSquared = horizontalDistanceSquared(
        player,
        state.position.x,
        state.position.z,
      );
      if (distanceSquared <= VISUAL_RADIUS * VISUAL_RADIUS)
        visualStates.push(state);
      if (record.slot && distanceSquared > EXIT * EXIT) {
        demote(record);
        updateVisualPose(record);
        continue;
      }
      if (!record.slot && distanceSquared <= ENTER * ENTER) {
        makeRoomFor(player, distanceSquared);
        if (physicalCount < MAX_DRIVING) promote(record);
      }
      const slot = record.slot;
      if (!slot) continue;
      // Wrecks remain physically free to tumble and settle while nearby.
      if (record.wrecked) {
        if (slot.friction !== WRECK_FRICTION) {
          physics.setContactProperties(
            slot.bodyId,
            WRECK_FRICTION,
            RESTITUTION,
          );
          slot.friction = WRECK_FRICTION;
        }
        continue;
      }
      const pose = routePose(record, record.station, routeScratch);
      const direction = state.direction;
      const next = routePose(
        record,
        record.station + 8 * direction,
        nextScratch,
      );
      const nextHeading = Math.atan2(-(next.x - pose.x), -(next.z - pose.z));
      const desiredX =
        -Math.sin(nextHeading) * record.authored.speed +
        Math.max(-3, Math.min(3, (pose.x - state.position.x) * 0.7));
      const desiredZ =
        -Math.cos(nextHeading) * record.authored.speed +
        Math.max(-3, Math.min(3, (pose.z - state.position.z) * 0.7));
      // Soft speed hold, capped at 5 m/s²; a hit wins over the controller.
      force.x = (desiredX - state.velocity.x) * BODY_MASS * 2;
      force.z = (desiredZ - state.velocity.z) * BODY_MASS * 2;
      const magnitude = Math.hypot(force.x, force.z);
      if (magnitude > BODY_MASS * 5) {
        const scale = (BODY_MASS * 5) / magnitude;
        force.x *= scale;
        force.z *= scale;
      }
      force.y = 0;
      point.x = state.position.x;
      point.y = state.position.y;
      point.z = state.position.z;
      physics.applyForceAtPoint(slot.bodyId, force, point);
      const heading = 2 * Math.atan2(state.rotation.y, state.rotation.w);
      angular.x = 0;
      angular.y = Math.max(
        -0.8,
        Math.min(0.8, wrapAngle(nextHeading - heading) * 2),
      );
      angular.z = 0;
      physics.setAngularVelocity(slot.bodyId, angular);
    }
  }

  function postStep(): void {
    for (const slot of slots) {
      const record = slot.record;
      if (!record) continue;
      const state = record.state;
      physics.getTransform(slot.bodyId, readPosition, readRotation);
      physics.getLinearVelocity(slot.bodyId, readVelocity);
      Object.assign(state.position, readPosition);
      Object.assign(state.rotation, readRotation);
      Object.assign(state.velocity, readVelocity);
      state.speed = Math.hypot(readVelocity.x, readVelocity.z);
      const q = readRotation;
      state.forward.x = -2 * (q.x * q.z + q.w * q.y);
      state.forward.y = 2 * (q.w * q.x - q.y * q.z);
      state.forward.z = -(1 - 2 * (q.x * q.x + q.y * q.y));
      state.wrecked = record.wrecked;
    }
  }

  /** Called inside the contact callback: no physics reads or mutations. */
  function onPlayerContact(
    otherBody: BodyId,
    impact: Readonly<ImpactSeverity>,
  ): void {
    if (impact.severity < 0.25) return;
    for (const slot of slots) {
      if (slot.bodyId !== otherBody || !slot.record) continue;
      slot.record.wrecked = true;
      slot.record.state.wrecked = true;
      return;
    }
  }

  /** Last post-step velocity, safe to read inside a contact callback. */
  function velocityForBody(bodyId: BodyId): Readonly<V3> | undefined {
    for (const slot of slots)
      if (slot.bodyId === bodyId && slot.record)
        return slot.record.state.velocity;
    return undefined;
  }

  return {
    /** Reused array and records; safe to iterate after physics without allocation. */
    states: allStates as readonly TrafficCarState[],
    visualStates: visualStates as readonly TrafficCarState[],
    preStep,
    postStep,
    onPlayerContact,
    velocityForBody,
    dispose() {
      for (const record of authored) demote(record);
      for (const slot of slots) bodies.destroy(slot.bodyId);
    },
  };
}

export function createTrafficVisual(
  scene: Scene,
  traffic: ReturnType<typeof createTraffic>,
) {
  const bodyGeometry = new BoxGeometry(1.9, 0.9, 4.2);
  const cabinGeometry = new BoxGeometry(1.55, 0.6, 2.2);
  cabinGeometry.translate(0, 0.7, -0.25);
  const bodyMaterial = new MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.55,
  });
  const cabinMaterial = new MeshStandardMaterial({
    color: 0x344656,
    roughness: 0.42,
  });
  const capacity = traffic.states.length;
  const body = new InstancedMesh(bodyGeometry, bodyMaterial, capacity);
  const cabin = new InstancedMesh(cabinGeometry, cabinMaterial, capacity);
  const helper = new Object3D();
  const colors = [0xff4c3a, 0xe8c741, 0x63c9f1, 0xd9e0e7].map(
    (hex) => new Color(hex),
  );
  body.castShadow = cabin.castShadow = true;
  body.receiveShadow = cabin.receiveShadow = true;
  // Instance matrices move across a 10 km map; a one-time bounds sphere at
  // their boot positions would cull the entire draw at a distant station.
  body.frustumCulled = cabin.frustumCulled = false;
  body.instanceMatrix.setUsage(DynamicDrawUsage);
  cabin.instanceMatrix.setUsage(DynamicDrawUsage);
  scene.add(body, cabin);
  function update(): void {
    let i = 0;
    for (const state of traffic.visualStates) {
      helper.position.set(state.position.x, state.position.y, state.position.z);
      helper.quaternion.set(
        state.rotation.x,
        state.rotation.y,
        state.rotation.z,
        state.rotation.w,
      );
      helper.scale.setScalar(1);
      helper.updateMatrix();
      body.setMatrixAt(i, helper.matrix);
      cabin.setMatrixAt(i, helper.matrix);
      body.setColorAt(i, colors[state.id % colors.length]!);
      i++;
    }
    body.count = cabin.count = i;
    body.instanceMatrix.needsUpdate = true;
    cabin.instanceMatrix.needsUpdate = true;
    if (body.instanceColor) body.instanceColor.needsUpdate = true;
  }
  update();
  return {
    update,
    dispose() {
      scene.remove(body, cabin);
      bodyGeometry.dispose();
      cabinGeometry.dispose();
      bodyMaterial.dispose();
      cabinMaterial.dispose();
    },
  };
}
