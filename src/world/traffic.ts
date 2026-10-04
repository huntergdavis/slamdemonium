import type { Scene } from 'three';
import type { ImpactSeverity } from '../core/impactSeverity';
import { SURFACE_IDS } from '../content/surfaces';
import type { BodyId, IPhysicsWorld, Quat, V3 } from '../physics/adapter';
import type { RoadPath } from './roadGenerator';
import type { SurfacedBodies } from './surfacedBodies';
import {
  CAR_MODELS,
  createCarModelInstances,
  pickCarModelKind,
  type CarCrushState,
  type CarModelKind,
} from './carModels';

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
  /** The catalogue kind; picked by id when not authored. */
  readonly modelKind?: CarModelKind;
}

/** Centre-to-centre spacing in metres. The 12 m authored grid is the hard
 * ceiling: no slider can create more cars than the CTO already drove. */
export interface TrafficSpacingRules {
  readonly density: number;
  readonly minGap: number;
  readonly maxGap: number;
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
  /** The catalogue kind: collision box, visual parts and ride height. */
  modelKind: CarModelKind;
  /** Visual crush persists with this encounter across body LOD handoffs. */
  crush: CarCrushState;
}

interface RecordState {
  readonly authored: TrafficCarRecord;
  station: number;
  readonly state: TrafficCarState;
  wrecked: boolean;
  wreckPosition: V3;
  wreckRotation: Quat;
  slot: Slot | null;
  enabled: boolean;
  driveSpeed: number;
  leader: RecordState | null;
  crashPending: boolean;
  crashNormal: V3;
  crashClosingSpeed: number;
  crashBleedRemaining: number;
}

interface Slot {
  readonly bodyId: BodyId;
  record: RecordState | null;
  friction: number;
  /** The kind whose collision box the pooled body currently carries. */
  kind: CarModelKind | null;
}

const BODY_HALF = { x: 0.95, y: 0.55, z: 2.1 };
const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };
const ENTER = 120;
const EXIT = 180;
const VISUAL_RADIUS = 400;
export const MAX_DRIVING = 12;
const POOL_SIZE = MAX_DRIVING;
const BODY_MASS = 1100;
/** Every kind weighs the same in v1; per-kind mass waits for crumple. */
const BODY_MASS_DESC = {
  mass: BODY_MASS,
  comOffset: { x: 0, y: -0.15, z: 0 },
  inertiaScale: { x: 1, y: 1, z: 1 },
};
// A box has no driven wheels: road friction above the 5 m/s² controller cap
// stops it outright. Restore heavy contact friction after a wreck so it settles.
const DRIVE_FRICTION = 0.05;
const WRECK_FRICTION = 0.7;
const RESTITUTION = 0.05;
const WRECK_ANGULAR_DAMPING = 5;
const WRECK_MAX_ANGULAR_VELOCITY = 5;
const CRASH_BLEED_SECONDS = 0.3;
const CRASH_BLEED_RATE = 1.5;

function noise(seed: number): number {
  let x = seed | 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return (x >>> 0) / 0x100000000;
}

function horizontalDistanceSquared(a: V3, x: number, z: number): number {
  const dx = a.x - x;
  const dz = a.z - z;
  return dx * dx + dz * dz;
}

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** Transform the hit normal into the car's local frame. Its catalogue nose
 * is +z; the strongest horizontal component identifies the struck side. */
function recordVisualCrush(
  state: TrafficCarState,
  nx: number,
  ny: number,
  nz: number,
  closingSpeed: number,
): void {
  // A normal 23 m/s slam must read at chase distance, but 30 and 60 m/s
  // impacts should not saturate to the same shape.
  const excess = Math.max(0, closingSpeed - 5);
  const strength =
    excess <= 18
      ? excess / 25
      : Math.min(1, 0.72 + ((excess - 18) * 0.28) / 37);
  if (strength === 0) return;
  const q = state.rotation;
  const qx = -q.x;
  const qy = -q.y;
  const qz = -q.z;
  const tx = 2 * (qy * nz - qz * ny);
  const ty = 2 * (qz * nx - qx * nz);
  const tz = 2 * (qx * ny - qy * nx);
  const localX = nx + q.w * tx + qy * tz - qz * ty;
  const localZ = nz + q.w * tz + qx * ty - qy * tx;
  if (Math.hypot(localX, localZ) < 0.45) return;
  const side =
    Math.abs(localZ) >= Math.abs(localX)
      ? localZ >= 0
        ? 'front'
        : 'rear'
      : localX >= 0
        ? 'right'
        : 'left';
  state.crush[side] = Math.max(state.crush[side], strength);
}

/** Every authored car advances continuously. Only nearby cars own a pooled
 * Jolt body; their stable encounter state survives each LOD hand-off. */
export function createTraffic(
  physics: IPhysicsWorld,
  bodies: SurfacedBodies,
  path: RoadPath,
  records: readonly TrafficCarRecord[],
  initialRules?: TrafficSpacingRules,
) {
  const authored: RecordState[] = records.map((record, index) => ({
    authored: record,
    station: record.station,
    state: {
      id: index + 1,
      bodyId: -1,
      position: {
        x: 0,
        y: CAR_MODELS[record.modelKind ?? pickCarModelKind(index + 1)].ride,
        z: 0,
      },
      rotation: { ...IDENTITY },
      forward: { x: 0, y: 0, z: -1 },
      velocity: { x: 0, y: 0, z: 0 },
      laneSide: record.laneSide,
      direction: record.direction ?? 1,
      speed: record.speed,
      wrecked: false,
      modelKind: record.modelKind ?? pickCarModelKind(index + 1),
      crush: { front: 0, rear: 0, left: 0, right: 0 },
    },
    wrecked: false,
    wreckPosition: { x: 0, y: 0, z: 0 },
    wreckRotation: { ...IDENTITY },
    slot: null,
    enabled: true,
    driveSpeed: record.speed,
    leader: null,
    crashPending: false,
    crashNormal: { x: 0, y: 0, z: 0 },
    crashClosingSpeed: 0,
    crashBleedRemaining: 0,
  }));
  let rules: TrafficSpacingRules | undefined;
  let activeCount = authored.length;
  const slots: Slot[] = [];
  const visualStates: TrafficCarState[] = [];
  let physicalCount = 0;
  let farPoseBucket = 0;
  const readPosition: V3 = { x: 0, y: 0, z: 0 };
  const readRotation: Quat = { ...IDENTITY };
  const readVelocity: V3 = { x: 0, y: 0, z: 0 };
  const playerVelocity: V3 = { x: 0, y: 0, z: 0 };
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
      kind: null,
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
    state.position.y = CAR_MODELS[state.modelKind].ride;
    state.position.z = pose.z;
    state.rotation.x = state.rotation.z = 0;
    state.rotation.y = Math.sin(facing / 2);
    state.rotation.w = Math.cos(facing / 2);
    state.forward.x = -Math.sin(facing);
    state.forward.y = 0;
    state.forward.z = -Math.cos(facing);
    state.velocity.x = state.forward.x * record.driveSpeed;
    state.velocity.y = 0;
    state.velocity.z = state.forward.z * record.driveSpeed;
    state.speed = record.driveSpeed;
  }

  for (const record of authored) updateVisualPose(record);

  function setSlotProperties(slot: Slot, wrecked: boolean): void {
    slot.friction = wrecked ? WRECK_FRICTION : DRIVE_FRICTION;
    physics.setBodyProperties(slot.bodyId, {
      friction: slot.friction,
      restitution: wrecked ? 0 : RESTITUTION,
      angularDamping: wrecked ? WRECK_ANGULAR_DAMPING : 0.25,
      maxAngularVelocity: wrecked ? WRECK_MAX_ANGULAR_VELOCITY : 9,
    });
  }

  /** A tuning edit only changes which stable records are present. Wrecks stay
   * present and keep their ids; intact hidden cars continue around the lap. */
  function setRules(next: TrafficSpacingRules): void {
    const density = Math.max(0.35, Math.min(1, next.density));
    const minGap = Math.max(12, next.minGap);
    const maxGap = Math.max(minGap, next.maxGap);
    if (
      rules?.density === density &&
      rules.minGap === minGap &&
      rules.maxGap === maxGap
    )
      return;
    rules = { density, minGap, maxGap };
    activeCount = 0;
    for (const record of authored) {
      record.enabled = record.wrecked;
      record.leader = null;
    }
    for (const direction of [1, -1] as const) {
      const lane = authored
        .filter(
          (record) =>
            !record.wrecked && (record.authored.direction ?? 1) === direction,
        )
        .sort((a, b) => direction * (a.station - b.station));
      const chosen: RecordState[] = [];
      let lastProgress = -Infinity;
      let nextGap = 0;
      for (const record of lane) {
        const progress = direction * record.station;
        if (progress - lastProgress + 0.001 < nextGap) continue;
        record.enabled = true;
        chosen.push(record);
        lastProgress = progress;
        const zone = noise(
          Math.floor(record.station / 180) * 17 + direction * 131,
        );
        const variation = noise(record.state.id * 31 + direction * 761);
        // Quantization against the 12 m authoring grid needs explicit short
        // gaps. Otherwise even 12.1 m rounds every cluster up to 24 m.
        const extra = (1 - density) * (maxGap - minGap);
        nextGap =
          zone < 0.55
            ? variation < density
              ? minGap
              : minGap + 12 + extra
            : zone > 0.85
              ? maxGap + extra
              : minGap + (maxGap - minGap) * (0.35 + variation * 0.3) + extra;
      }
      if (path.closed && chosen.length > 1) {
        const first = chosen[0]!;
        const last = chosen[chosen.length - 1]!;
        const wrapGap =
          (((direction * (first.station - last.station)) % path.length) +
            path.length) %
          path.length;
        if (wrapGap < minGap) {
          last.enabled = false;
          chosen.pop();
        }
      }
      if (chosen.length > 1)
        for (let i = 0; i < chosen.length; i++)
          chosen[i]!.leader =
            chosen[i + 1] ?? (path.closed ? chosen[0]! : null);
    }
    for (const record of authored) {
      if (!record.enabled && record.slot) demote(record);
      if (record.enabled && !record.wrecked) updateVisualPose(record);
      if (record.enabled) activeCount++;
    }
  }

  function promote(record: RecordState): void {
    const slot = slots.find((candidate) => candidate.record === null);
    if (!slot) return;
    const state = record.state;
    if (slot.kind !== state.modelKind) {
      physics.setBodyShape(
        slot.bodyId,
        CAR_MODELS[state.modelKind].halfExtents,
        BODY_MASS_DESC,
      );
      slot.kind = state.modelKind;
    }
    physics.activateBody(slot.bodyId, state.position, state.rotation, true);
    setSlotProperties(slot, record.wrecked);
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
      record.crashBleedRemaining = 0;
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
    // Refresh one distant slice per step instead of all authored cars on the
    // same 10 Hz tick. Nearby poses still update every step.
    const farPoseBuckets = Math.max(1, Math.round(0.1 / dt));
    farPoseBucket = (farPoseBucket + 1) % farPoseBuckets;
    for (let i = 0; i < authored.length; i++) {
      const record = authored[i]!;
      const state = record.state;
      if (!record.wrecked) {
        const direction = state.direction;
        if (rules && record.enabled && record.leader) {
          const ahead = record.leader;
          const gap =
            (((direction * (ahead.station - record.station)) % path.length) +
              path.length) %
            path.length;
          // A faster car queues behind a slower one, without lane swapping.
          const followingSpeed = ahead.driveSpeed + (gap - rules.minGap) * 0.6;
          record.driveSpeed = Math.max(
            0,
            Math.min(record.authored.speed, followingSpeed),
          );
        } else record.driveSpeed = record.authored.speed;
        record.station += direction * record.driveSpeed * dt;
        if (record.station >= path.length) record.station -= path.length;
        else if (record.station < 0) record.station += path.length;
      }
      if (!record.enabled) continue;
      const oldDistanceSquared = horizontalDistanceSquared(
        player,
        state.position.x,
        state.position.z,
      );
      const refreshVisual =
        !record.slot &&
        (i % farPoseBuckets === farPoseBucket ||
          oldDistanceSquared <= (VISUAL_RADIUS + 30) ** 2);
      if (refreshVisual) updateVisualPose(record);
      const distanceSquared = refreshVisual
        ? horizontalDistanceSquared(player, state.position.x, state.position.z)
        : oldDistanceSquared;
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
        if (slot.friction !== WRECK_FRICTION) setSlotProperties(slot, true);
        if (record.crashBleedRemaining > 0) {
          physics.getLinearVelocity(slot.bodyId, readVelocity);
          const bleed = Math.exp(-CRASH_BLEED_RATE * dt);
          readVelocity.x *= bleed;
          readVelocity.z *= bleed;
          physics.setLinearVelocity(slot.bodyId, readVelocity);
          record.crashBleedRemaining = Math.max(
            0,
            record.crashBleedRemaining - dt,
          );
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
        -Math.sin(nextHeading) * record.driveSpeed +
        Math.max(-3, Math.min(3, (pose.x - state.position.x) * 0.7));
      const desiredZ =
        -Math.cos(nextHeading) * record.driveSpeed +
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

  function postStep(playerBodyId?: BodyId, playerMass = 1300): void {
    for (const slot of slots) {
      const record = slot.record;
      if (!record) continue;
      if (record.crashPending) {
        record.crashPending = false;
        setSlotProperties(slot, true);
        if (playerBodyId !== undefined) {
          physics.getLinearVelocity(playerBodyId, playerVelocity);
          physics.getLinearVelocity(slot.bodyId, readVelocity);
          const normal = record.crashNormal;
          const separation =
            (playerVelocity.x - readVelocity.x) * normal.x +
            (playerVelocity.y - readVelocity.y) * normal.y +
            (playerVelocity.z - readVelocity.z) * normal.z;
          // Inelastic first contact: Jolt has already solved this step, so
          // cancel only excessive outward speed. The tangential velocity and
          // the normal momentum of the two bodies remain unchanged.
          const maxSeparation = Math.min(
            2,
            Math.max(0.5, record.crashClosingSpeed * 0.05),
          );
          if (separation > maxSeparation) {
            const excess = separation - maxSeparation;
            const mass = Math.max(1, playerMass);
            const playerShare = (excess * BODY_MASS) / (mass + BODY_MASS);
            const trafficShare = (excess * mass) / (mass + BODY_MASS);
            playerVelocity.x -= playerShare * normal.x;
            playerVelocity.y -= playerShare * normal.y;
            playerVelocity.z -= playerShare * normal.z;
            readVelocity.x += trafficShare * normal.x;
            readVelocity.y += trafficShare * normal.y;
            readVelocity.z += trafficShare * normal.z;
            physics.setLinearVelocity(playerBodyId, playerVelocity);
            physics.setLinearVelocity(slot.bodyId, readVelocity);
          }
        }
        physics.getAngularVelocity(slot.bodyId, angular);
        const spin = Math.hypot(angular.x, angular.y, angular.z);
        if (spin > WRECK_MAX_ANGULAR_VELOCITY) {
          const scale = WRECK_MAX_ANGULAR_VELOCITY / spin;
          angular.x *= scale;
          angular.y *= scale;
          angular.z *= scale;
          physics.setAngularVelocity(slot.bodyId, angular);
        }
      }
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
    normalIntoPlayer?: Readonly<V3>,
    relativeVelocity?: Readonly<V3>,
  ): void {
    if (impact.severity < 0.25) return;
    for (const slot of slots) {
      if (slot.bodyId !== otherBody || !slot.record) continue;
      const record = slot.record;
      if (normalIntoPlayer && relativeVelocity) {
        const length = Math.hypot(
          normalIntoPlayer.x,
          normalIntoPlayer.y,
          normalIntoPlayer.z,
        );
        if (length > 0.5) {
          const nx = normalIntoPlayer.x / length;
          const ny = normalIntoPlayer.y / length;
          const nz = normalIntoPlayer.z / length;
          const closingSpeed = Math.max(
            0,
            -(
              relativeVelocity.x * nx +
              relativeVelocity.y * ny +
              relativeVelocity.z * nz
            ),
          );
          recordVisualCrush(record.state, nx, ny, nz, closingSpeed);
        }
      }
      if (record.wrecked) return;
      record.wrecked = true;
      record.state.wrecked = true;
      record.crashBleedRemaining = 0;
      if (normalIntoPlayer && relativeVelocity) {
        const length = Math.hypot(
          normalIntoPlayer.x,
          normalIntoPlayer.y,
          normalIntoPlayer.z,
        );
        if (length > 0.5) {
          record.crashNormal.x = normalIntoPlayer.x / length;
          record.crashNormal.y = normalIntoPlayer.y / length;
          record.crashNormal.z = normalIntoPlayer.z / length;
          const forward = record.state.forward;
          const longitudinal = Math.abs(
            record.crashNormal.x * forward.x + record.crashNormal.z * forward.z,
          );
          if (longitudinal > 0.7)
            record.crashBleedRemaining = CRASH_BLEED_SECONDS;
          record.crashClosingSpeed = Math.max(
            0,
            -(
              relativeVelocity.x * record.crashNormal.x +
              relativeVelocity.y * record.crashNormal.y +
              relativeVelocity.z * record.crashNormal.z
            ),
          );
          record.crashPending = record.crashClosingSpeed > 0;
        }
      }
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

  if (initialRules) setRules(initialRules);

  return {
    /** Reused array and records; safe to iterate after physics without allocation. */
    states: visualStates as readonly TrafficCarState[],
    visualStates: visualStates as readonly TrafficCarState[],
    recordCount: authored.length,
    get activeCount() {
      return activeCount;
    },
    setRules,
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
  // The catalogue owns geometry, materials and the per-kind instanced draws;
  // traffic only says which car is where.
  const cars = createCarModelInstances(scene, traffic.recordCount);
  function update(): void {
    cars.begin();
    for (const state of traffic.visualStates)
      cars.push(
        state.modelKind,
        state.position,
        state.rotation,
        state.id,
        state.crush,
      );
    cars.end();
  }
  update();
  return {
    update,
    dispose() {
      cars.dispose();
    },
  };
}
