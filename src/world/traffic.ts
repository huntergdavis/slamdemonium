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
  speed: number;
  wrecked: boolean;
}

interface RecordState {
  readonly authored: TrafficCarRecord;
  station: number;
  wrecked: boolean;
  wreckPosition: V3;
  wreckRotation: Quat;
  slot: Slot | null;
}

interface Slot {
  readonly bodyId: BodyId;
  record: RecordState | null;
  readonly state: TrafficCarState;
}

const BODY_HALF = { x: 0.95, y: 0.55, z: 2.1 };
const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };
const ENTER = 240;
const DRIVE = 180;
const EXIT = 300;
const MAX_DRIVING = 4;
const POOL_SIZE = 8;
const BODY_MASS = 1100;

function horizontalDistance(a: V3, x: number, z: number): number {
  return Math.hypot(a.x - x, a.z - z);
}

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** Four dumb lane/speed followers with eight bodies reserved at boot. Bodies
 * enter asleep, drive only within 180 m, and leave beyond 300 m. Wrecks retain
 * their last pose by authored record; an encounter id changes on re-promotion. */
export function createTraffic(
  physics: IPhysicsWorld,
  bodies: SurfacedBodies,
  path: RoadPath,
  records: readonly TrafficCarRecord[],
) {
  const authored: RecordState[] = records.map((record) => ({
    authored: record,
    station: record.station,
    wrecked: false,
    wreckPosition: { x: 0, y: 0, z: 0 },
    wreckRotation: { ...IDENTITY },
    slot: null,
  }));
  const slots: Slot[] = [];
  const activeStates: TrafficCarState[] = [];
  let nextEncounterId = 1;
  const readPosition: V3 = { x: 0, y: 0, z: 0 };
  const readRotation: Quat = { ...IDENTITY };
  const readVelocity: V3 = { x: 0, y: 0, z: 0 };
  const force: V3 = { x: 0, y: 0, z: 0 };
  const point: V3 = { x: 0, y: 0, z: 0 };
  const angular: V3 = { x: 0, y: 0, z: 0 };
  const routeScratch: MutableRoadPose = { x: 0, z: 0, heading: 0 };
  const nextScratch: MutableRoadPose = { x: 0, z: 0, heading: 0 };
  const wakeVelocity: V3 = { x: 0, y: 0, z: 0 };

  for (let i = 0; i < POOL_SIZE; i++) {
    const bodyId = bodies.createPooledBox({
      motion: 'dynamic',
      surface: SURFACE_IDS.concrete,
      halfExtents: BODY_HALF,
      mass: BODY_MASS,
      comOffset: { x: 0, y: -0.15, z: 0 },
      inertiaScale: { x: 1, y: 1, z: 1 },
      friction: 0.7,
      restitution: 0.05,
      ccd: true,
      maxAngularVelocity: 9,
      angularDamping: 0.25,
    });
    slots.push({
      bodyId,
      record: null,
      state: {
        id: 0,
        bodyId,
        position: { x: 0, y: 0, z: 0 },
        rotation: { ...IDENTITY },
        forward: { x: 0, y: 0, z: -1 },
        velocity: { x: 0, y: 0, z: 0 },
        laneSide: 1,
        speed: 0,
        wrecked: false,
      },
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

  function promote(record: RecordState): void {
    const slot = slots.find((candidate) => candidate.record === null);
    if (!slot) return;
    const pose = routePose(record, record.station, routeScratch);
    const position = record.wrecked
      ? record.wreckPosition
      : { x: pose.x, y: BODY_HALF.y + 0.04, z: pose.z };
    const rotation = record.wrecked
      ? record.wreckRotation
      : {
          x: 0,
          y: Math.sin(pose.heading / 2),
          z: 0,
          w: Math.cos(pose.heading / 2),
        };
    physics.activateBody(slot.bodyId, position, rotation, true);
    slot.record = record;
    record.slot = slot;
    const state = slot.state;
    state.id = nextEncounterId++;
    state.laneSide = record.authored.laneSide;
    state.wrecked = record.wrecked;
    state.speed = 0;
    Object.assign(state.position, position);
    Object.assign(state.rotation, rotation);
    state.forward.x = -Math.sin(pose.heading);
    state.forward.y = 0;
    state.forward.z = -Math.cos(pose.heading);
    state.velocity.x = state.velocity.y = state.velocity.z = 0;
    activeStates.push(state);
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
    }
    physics.deactivateBody(slot.bodyId);
    const index = activeStates.indexOf(slot.state);
    if (index >= 0) activeStates.splice(index, 1);
    slot.record = null;
    record.slot = null;
  }

  function preStep(dt: number, player: V3): void {
    for (const record of authored) {
      const slot = record.slot;
      // Wrecks remain at their final pose; undamaged cars progress only while
      // simulated so there is no large teleport at the streaming boundary.
      const pose = routePose(record, record.station, routeScratch);
      const targetX = slot
        ? slot.state.position.x
        : record.wrecked
          ? record.wreckPosition.x
          : pose.x;
      const targetZ = slot
        ? slot.state.position.z
        : record.wrecked
          ? record.wreckPosition.z
          : pose.z;
      const distance = horizontalDistance(player, targetX, targetZ);
      if (!slot) {
        if (distance <= ENTER && activeStates.length < MAX_DRIVING)
          promote(record);
        continue;
      }
      if (distance > EXIT) {
        demote(record);
        continue;
      }
      // A wreck stays physically free to tumble and settle while nearby.
      if (record.wrecked) continue;
      if (distance > DRIVE) {
        if (physics.isBodyAwake(slot.bodyId)) physics.sleepBody(slot.bodyId);
        continue;
      }
      const state = slot.state;
      const next = routePose(record, record.station + 8, nextScratch);
      const nextHeading = Math.atan2(-(next.x - pose.x), -(next.z - pose.z));
      const desiredX =
        -Math.sin(nextHeading) * record.authored.speed +
        Math.max(-3, Math.min(3, (pose.x - state.position.x) * 0.7));
      const desiredZ =
        -Math.cos(nextHeading) * record.authored.speed +
        Math.max(-3, Math.min(3, (pose.z - state.position.z) * 0.7));
      if (!physics.isBodyAwake(slot.bodyId)) {
        wakeVelocity.x = desiredX;
        wakeVelocity.y = state.velocity.y;
        wakeVelocity.z = desiredZ;
        physics.setLinearVelocity(slot.bodyId, wakeVelocity);
      } else {
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
      }
      const heading = 2 * Math.atan2(state.rotation.y, state.rotation.w);
      angular.x = 0;
      angular.y = Math.max(
        -0.8,
        Math.min(0.8, wrapAngle(nextHeading - heading) * 2),
      );
      angular.z = 0;
      physics.setAngularVelocity(slot.bodyId, angular);
      record.station =
        (record.station + record.authored.speed * dt) % path.length;
    }
  }

  function postStep(): void {
    for (const slot of slots) {
      const record = slot.record;
      if (!record) continue;
      const state = slot.state;
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
      slot.state.wrecked = true;
      return;
    }
  }

  return {
    /** Reused array and records; safe to iterate after physics without allocation. */
    states: activeStates as readonly TrafficCarState[],
    preStep,
    postStep,
    onPlayerContact,
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
  const body = new InstancedMesh(bodyGeometry, bodyMaterial, POOL_SIZE);
  const cabin = new InstancedMesh(cabinGeometry, cabinMaterial, POOL_SIZE);
  const helper = new Object3D();
  const colors = [0xff4c3a, 0xe8c741, 0x63c9f1, 0xd9e0e7];
  for (let i = 0; i < POOL_SIZE; i++)
    body.setColorAt(i, new Color(colors[i % colors.length]!));
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
    for (const state of traffic.states) {
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
      i++;
    }
    helper.scale.setScalar(0);
    helper.updateMatrix();
    for (; i < POOL_SIZE; i++) {
      body.setMatrixAt(i, helper.matrix);
      cabin.setMatrixAt(i, helper.matrix);
    }
    body.instanceMatrix.needsUpdate = true;
    cabin.instanceMatrix.needsUpdate = true;
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
