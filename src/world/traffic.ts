import type { Scene } from 'three';
import type { ImpactSeverity } from '../core/impactSeverity';
import { SURFACE_IDS } from '../content/surfaces';
import { VEHICLE_GEOMETRY } from '../vehicle/constants';
import {
  type BodyId,
  type ContactVelocityReader,
  type IPhysicsWorld,
  type Quat,
  type V3,
} from '../physics/adapter';
import type { RoadPath } from './roadGenerator';
import {
  approachRivalLine,
  rivalAttackActive,
  rivalAttackTarget,
  rivalBoostBonus,
  rivalRamSpeedBonus,
} from './rivals';
import type { SurfacedBodies } from './surfacedBodies';
import { trafficCrushShape } from './trafficCrushShape';
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
  /** Rivals contest the player's line and remain identifiable through LOD. */
  readonly rival?: boolean;
  /** Opt-in junction priority for authored crossing roads. */
  readonly signalStream?: 'arterial' | 'cross';
  readonly signalJunctions?: readonly {
    readonly x: number;
    readonly z: number;
  }[];
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
  rival: boolean;
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
  cornerLimit: number;
  signalCommit: number;
  wreckAge: number;
  attackOffset: number;
  leader: RecordState | null;
  obstacle: RecordState | null;
  obstacleClearance: number;
  obstacleLate: boolean;
  threatened: boolean;
  crashPending: boolean;
  crashNormal: V3;
  crashClosingSpeed: number;
  crashBleedRemaining: number;
  shapeDirty: boolean;
  /** Contact episode state: one slam chunk, or one scrape increment per side
   * per physics step even when Jolt reports several contact points. */
  contactGap: number;
  slamSides: number;
  scrapeSides: number;
}

interface Slot {
  readonly bodyId: BodyId;
  record: RecordState | null;
  friction: number;
  /** The kind whose collision box the pooled body currently carries. */
  kind: CarModelKind | null;
  shapeKey: string | null;
}

const BODY_HALF = { x: 0.95, y: 0.55, z: 2.1 };
const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };
const ENTER = 120;
const EXIT = 180;
const VISUAL_RADIUS = 400;
/** Signed station offsets keep one rival in shunting range and leave room for
 * challengers ahead and behind. Only the takedown map authors rival records. */
const RIVAL_START_OFFSETS = [65, 48, -48, -65] as const;
const RIVAL_PACK_OFFSETS = [36, 24, -24, -36] as const;
const RIVAL_STRIKE_OFFSET = 12;
const RIVAL_REJOIN_SECONDS = 4;
const RIVAL_REJOIN_BEHIND = 220;
const RIVAL_ATTACK_GRACE_SECONDS = 6;
const RIVAL_PLAYER_ATTACK_MIN_SPEED = 20;
const CRUSH_SHAPE_UPDATES_PER_STEP = 1;
export const MAX_DRIVING = 12;
const POOL_SIZE = MAX_DRIVING;
const WRECK_LOOKAHEAD = 100;
const WRECK_PHYSICS_RADIUS = 220;
const WRECK_BRAKE = 9;
const WRECK_PLANNED_BRAKE = 4;
const WRECK_STOP_MARGIN = 12;
const CORNER_LOOKAHEAD = 100;
const CORNER_SAMPLE = 20;
const CIVILIAN_LATERAL_ACCEL = 3.5;
const CIVILIAN_BRAKE = 4;
const SIGNAL_PERIOD = 20;
const SIGNAL_STOP_LINE = 18;
const SIGNAL_LOOKAHEAD = 180;
const SIGNAL_BRAKE = 5;
const PROMOTION_CLEARANCE = 2;
const PLAYER_FOOTPRINT_RADIUS = Math.hypot(
  VEHICLE_GEOMETRY.length / 2,
  VEHICLE_GEOMETRY.width / 2,
);
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
const SLAM_CLOSING_SPEED = 2.5;
const CONTACT_EPISODE_GAP = 0.18;
// Ordinary low-speed chains dent both cars without stopping the lane drive;
// the takedown course gives rival combat its own more violent threshold.
const WORLD_WRECK_CLOSING_SPEED = 12;
/** A rival hitting a solid side-on is an arcade takedown opportunity. */
const RIVAL_SOLID_WRECK_SPEED = 8;
const RIVAL_SOLID_CRUSH_MULTIPLIER = 2.8;
const RIVAL_TRAFFIC_WRECK_SPEED = 5;
const RIVAL_TRAFFIC_CRUSH_MULTIPLIER = 2.2;
const HARD_LANDING_CLOSING_SPEED = 12;
const SCRAPE_CRUSH_PER_SECOND = 0.16;
const SCRAPE_CRUSH_CAP = 0.28;
const CRUSH_SIDES = ['front', 'rear', 'left', 'right'] as const;
type CrushSide = (typeof CRUSH_SIDES)[number];

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

/** Transform the hit normal into the visual model's local frame. The
 * catalogue's +Z nose is turned 180° from the chassis's -Z travel axis. */
function visualCrushSide(
  state: TrafficCarState,
  nx: number,
  ny: number,
  nz: number,
): CrushSide | undefined {
  const q = state.rotation;
  const qx = -q.x;
  const qy = -q.y;
  const qz = -q.z;
  const tx = 2 * (qy * nz - qz * ny);
  const ty = 2 * (qz * nx - qx * nz);
  const tz = 2 * (qx * ny - qy * nx);
  const localX = -(nx + q.w * tx + qy * tz - qz * ty);
  const localZ = -(nz + q.w * tz + qx * ty - qy * tx);
  if (Math.hypot(localX, localZ) < 0.45) return undefined;
  return Math.abs(localZ) >= Math.abs(localX)
    ? localZ >= 0
      ? 'front'
      : 'rear'
    : localX >= 0
      ? 'right'
      : 'left';
}

export function slamCrushChunk(closingSpeed: number): number {
  // A gentle knock still changes the outline. Larger slams retain the
  // measured #182 progression instead of saturating at moderate speed.
  const speed = Math.max(0, closingSpeed);
  if (speed <= 8) return 0.15 + speed * 0.01875;
  if (speed <= 15) return 0.3 + ((speed - 8) * 0.15) / 7;
  if (speed <= 23) return 0.45 + ((speed - 15) * 0.25) / 8;
  return Math.min(1, 0.7 + ((speed - 23) * 0.3) / 37);
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
      rival: record.rival === true,
      modelKind: record.modelKind ?? pickCarModelKind(index + 1),
      crush: { front: 0, rear: 0, left: 0, right: 0 },
    },
    wrecked: false,
    wreckPosition: { x: 0, y: 0, z: 0 },
    wreckRotation: { ...IDENTITY },
    slot: null,
    enabled: true,
    driveSpeed: record.speed,
    cornerLimit: record.speed,
    signalCommit: -1,
    wreckAge: 0,
    attackOffset: 0,
    leader: null,
    obstacle: null,
    obstacleClearance: Infinity,
    obstacleLate: false,
    threatened: false,
    crashPending: false,
    crashNormal: { x: 0, y: 0, z: 0 },
    crashClosingSpeed: 0,
    crashBleedRemaining: 0,
    shapeDirty: false,
    contactGap: Infinity,
    slamSides: 0,
    scrapeSides: 0,
  }));
  const hasRivals = records.some((record) => record.rival === true);
  let rules: TrafficSpacingRules | undefined;
  let activeCount = authored.length;
  const slots: Slot[] = [];
  const slotByBodyId = new Map<BodyId, Slot>();
  const visualStates: TrafficCarState[] = [];
  const newlyWrecked: TrafficCarState[] = [];
  const wreckRecords: RecordState[] = [];
  const nearbyWrecks: RecordState[] = [];
  const rivalTargets: V3[] = [];
  let hadNearbyWrecks = false;
  let physicalCount = 0;
  let farPoseBucket = 0;
  let stepDt = 0;
  let nextEncounterId = records.length + 1;
  let playerStation = 0;
  let stationRefresh = 0.2;
  let rivalSeconds = 0;
  let trafficSeconds = 0;
  let rivalDriveSeconds = 0;
  let rivalryStarted = false;
  let attackWindowIndex = -1;
  let attackCarId = 0;
  let shapeSlotCursor = 0;
  const readPosition: V3 = { x: 0, y: 0, z: 0 };
  const readRotation: Quat = { ...IDENTITY };
  const readVelocity: V3 = { x: 0, y: 0, z: 0 };
  const playerVelocity: V3 = { x: 0, y: 0, z: 0 };
  const contactVelocityA: V3 = { x: 0, y: 0, z: 0 };
  const contactVelocityB: V3 = { x: 0, y: 0, z: 0 };
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
    const slot: Slot = {
      bodyId,
      kind: null,
      shapeKey: null,
      record: null,
      friction: DRIVE_FRICTION,
    };
    slots.push(slot);
    slotByBodyId.set(bodyId, slot);
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
      Math.cos(out.heading) *
        (record.authored.laneSide * 3.5 + record.attackOffset);
    out.z =
      a.z +
      (b.z - a.z) * t +
      Math.sin(out.heading) *
        (record.authored.laneSide * 3.5 + record.attackOffset);
    return out;
  }

  /** Ease civilians below the lateral force available at an upcoming bend.
   * Braking distance makes the limit take effect before entering the curve. */
  function civilianCornerSpeed(
    record: RecordState,
    authoredSpeed: number,
  ): number {
    let limit = authoredSpeed;
    for (
      let distance = 0;
      distance < CORNER_LOOKAHEAD;
      distance += CORNER_SAMPLE
    ) {
      const a = routePose(
        record,
        record.station + record.state.direction * distance,
        routeScratch,
      );
      const b = routePose(
        record,
        record.station + record.state.direction * (distance + CORNER_SAMPLE),
        nextScratch,
      );
      const curvature =
        Math.abs(wrapAngle(b.heading - a.heading)) / CORNER_SAMPLE;
      if (curvature < 0.0001) continue;
      limit = Math.min(
        limit,
        Math.sqrt(
          CIVILIAN_LATERAL_ACCEL / curvature + 2 * CIVILIAN_BRAKE * distance,
        ),
      );
    }
    return limit;
  }

  /** Alternate two streams with an all-red clearance interval. Cars close
   * enough to clear on green commit; everyone else brakes before the box. */
  function signalSpeed(record: RecordState, speed: number): number {
    const junctions = record.authored.signalJunctions;
    const stream = record.authored.signalStream;
    if (!junctions || !stream) return speed;
    const car = record.state;
    const forwardX = car.forward.x;
    const forwardZ = car.forward.z;
    const rightX = -forwardZ;
    const rightZ = forwardX;
    const phase = trafficSeconds % SIGNAL_PERIOD;
    for (let index = 0; index < junctions.length; index++) {
      const junction = junctions[index]!;
      const dx = junction.x - car.position.x;
      const dz = junction.z - car.position.z;
      const ahead = dx * forwardX + dz * forwardZ;
      if (ahead < 0 && record.signalCommit === index) record.signalCommit = -1;
      if (ahead <= SIGNAL_STOP_LINE || ahead > SIGNAL_LOOKAHEAD) continue;
      if (Math.abs(dx * rightX + dz * rightZ) > 15) continue;
      if (record.signalCommit === index) continue;
      const green =
        stream === 'arterial' ? phase < 11 : phase >= 13 && phase < 18;
      const untilOppositeGreen =
        stream === 'arterial'
          ? phase < 13
            ? 13 - phase
            : SIGNAL_PERIOD + 13 - phase
          : SIGNAL_PERIOD - phase;
      const clearTime = (ahead + SIGNAL_STOP_LINE) / Math.max(12, car.speed);
      if (green && clearTime + 0.4 < untilOppositeGreen) {
        if (ahead < 50) record.signalCommit = index;
        continue;
      }
      speed = Math.min(
        speed,
        Math.sqrt(2 * SIGNAL_BRAKE * Math.max(0, ahead - SIGNAL_STOP_LINE)),
      );
    }
    return speed;
  }

  function nearestRoadStation(position: V3): number {
    let best = Infinity;
    let station = 0;
    for (const sample of path.samples) {
      const distance = horizontalDistanceSquared(position, sample.x, sample.z);
      if (distance < best) {
        best = distance;
        station = sample.s;
      }
    }
    return station;
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

  /** Find a wreck on this car's path from the wreck's solved world pose, not
   * its former route station. A sideways wreck can block both lanes. */
  function updateObstacle(record: RecordState): void {
    const previousObstacle = record.obstacle;
    const previousLate = record.obstacleLate;
    record.obstacle = null;
    record.obstacleClearance = Infinity;
    record.obstacleLate = false;
    const car = record.state;
    const forwardX = car.forward.x;
    const forwardZ = car.forward.z;
    const rightX = -forwardZ;
    const rightZ = forwardX;
    const carShape = CAR_MODELS[car.modelKind].halfExtents;
    for (const wreck of nearbyWrecks) {
      if (wreck === record) continue;
      const other = wreck.state;
      const dx = other.position.x - car.position.x;
      const dz = other.position.z - car.position.z;
      const ahead = dx * forwardX + dz * forwardZ;
      if (ahead < -carShape.z || ahead > WRECK_LOOKAHEAD) continue;
      const side = Math.abs(dx * rightX + dz * rightZ);
      const wreckShape = CAR_MODELS[other.modelKind].halfExtents;
      const wreckForwardX = other.forward.x;
      const wreckForwardZ = other.forward.z;
      const wreckRightX = -wreckForwardZ;
      const wreckRightZ = wreckForwardX;
      const longExtent =
        Math.abs(forwardX * wreckForwardX + forwardZ * wreckForwardZ) *
          wreckShape.z +
        Math.abs(forwardX * wreckRightX + forwardZ * wreckRightZ) *
          wreckShape.x;
      const sideExtent =
        Math.abs(rightX * wreckForwardX + rightZ * wreckForwardZ) *
          wreckShape.z +
        Math.abs(rightX * wreckRightX + rightZ * wreckRightZ) * wreckShape.x;
      if (side > carShape.x + sideExtent + 0.5) continue;
      const clearance = ahead - carShape.z - longExtent;
      if (clearance >= record.obstacleClearance) continue;
      record.obstacle = wreck;
      record.obstacleClearance = clearance;
    }
    const obstacle = record.obstacle;
    if (!obstacle) return;
    obstacle.threatened = true;
    const speed = record.slot ? car.speed : record.driveSpeed;
    record.obstacleLate =
      obstacle === previousObstacle
        ? previousLate
        : speed > 8 &&
          record.obstacleClearance <
            (speed * speed) / (2 * WRECK_BRAKE) + WRECK_STOP_MARGIN;
  }

  function markWreck(record: RecordState): void {
    if (record.wrecked) return;
    record.wrecked = true;
    record.state.wrecked = true;
    newlyWrecked.push(record.state);
    wreckRecords.push(record);
    // Keep the existing ordered lane links. Followers skip wrecked entries
    // when they read the chain, avoiding a full-circuit sort on each impact.
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
  function safeFollowingGap(a: RecordState, b: RecordState): number {
    return (
      CAR_MODELS[a.state.modelKind].halfExtents.z +
      CAR_MODELS[b.state.modelKind].halfExtents.z +
      3
    );
  }

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
      const left: RecordState[] = [];
      const right: RecordState[] = [];
      let lastProgress = -Infinity;
      let nextGap = 0;
      for (const record of lane) {
        const progress = direction * record.station;
        const last = chosen.at(-1);
        if (
          progress - lastProgress + 0.001 <
          Math.max(nextGap, last ? safeFollowingGap(last, record) : 0)
        )
          continue;
        record.enabled = true;
        chosen.push(record);
        (record.authored.laneSide < 0 ? left : right).push(record);
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
        if (wrapGap < Math.max(minGap, safeFollowingGap(first, last))) {
          last.enabled = false;
          chosen.pop();
          (last.authored.laneSide < 0 ? left : right).pop();
        }
      }
      for (const lane of [left, right])
        if (lane.length > 1)
          for (let i = 0; i < lane.length; i++)
            lane[i]!.leader = lane[i + 1] ?? (path.closed ? lane[0]! : null);
    }
    // The density slider controls background traffic, never the four authored
    // opponents. They also need their own pace controller rather than an
    // ordinary follower speed limit from the sparse traffic selection.
    for (const record of authored)
      if (record.state.rival && !record.wrecked) {
        record.enabled = true;
        record.leader = null;
      }
    for (const record of authored) {
      if (!record.enabled && record.slot) demote(record);
      if (record.enabled && !record.wrecked) updateVisualPose(record);
      if (record.enabled) activeCount++;
    }
  }

  /** Body creation is deferred until its full footprint is clear. A visual
   * follower may still brake or queue while waiting for a physical slot. */
  function promotionIsClear(record: RecordState, player: V3): boolean {
    const car = record.state;
    const shape = CAR_MODELS[car.modelKind].halfExtents;
    const forwardX = car.forward.x;
    const forwardZ = car.forward.z;
    const rightX = -forwardZ;
    const rightZ = forwardX;
    const playerDx = player.x - car.position.x;
    const playerDz = player.z - car.position.z;
    if (
      Math.abs(playerDx * forwardX + playerDz * forwardZ) <
        shape.z + PLAYER_FOOTPRINT_RADIUS + PROMOTION_CLEARANCE &&
      Math.abs(playerDx * rightX + playerDz * rightZ) <
        shape.x + PLAYER_FOOTPRINT_RADIUS + PROMOTION_CLEARANCE
    )
      return false;
    for (const slot of slots) {
      const other = slot.record?.state;
      if (!other) continue;
      const otherShape = CAR_MODELS[other.modelKind].halfExtents;
      const dx = other.position.x - car.position.x;
      const dz = other.position.z - car.position.z;
      const along = Math.abs(dx * forwardX + dz * forwardZ);
      const across = Math.abs(dx * rightX + dz * rightZ);
      const aligned = Math.abs(
        forwardX * other.forward.x + forwardZ * other.forward.z,
      );
      const crossed = Math.abs(
        forwardX * other.forward.z - forwardZ * other.forward.x,
      );
      const otherLong = aligned * otherShape.z + crossed * otherShape.x;
      const otherWide = crossed * otherShape.z + aligned * otherShape.x;
      if (
        along < shape.z + otherLong + PROMOTION_CLEARANCE &&
        across < shape.x + otherWide + PROMOTION_CLEARANCE
      )
        return false;
    }
    return true;
  }

  function promote(record: RecordState, player: V3): void {
    if (!promotionIsClear(record, player)) return;
    const slot = slots.find((candidate) => candidate.record === null);
    if (!slot) return;
    const state = record.state;
    updateSlotShape(slot, record);
    record.shapeDirty = false;
    physics.activateBody(slot.bodyId, state.position, state.rotation, true);
    setSlotProperties(slot, record.wrecked);
    slot.record = record;
    record.slot = slot;
    record.contactGap = Infinity;
    record.slamSides = 0;
    record.scrapeSides = 0;
    state.bodyId = slot.bodyId;
    if (!record.wrecked) physics.setLinearVelocity(slot.bodyId, state.velocity);
    physicalCount++;
  }

  function updateSlotShape(slot: Slot, record: RecordState): void {
    const state = record.state;
    const crushed = trafficCrushShape(state.modelKind, state.crush);
    if (crushed) {
      if (slot.shapeKey === crushed.key) return;
      physics.setBodyConvexShape(
        slot.bodyId,
        crushed.key,
        crushed.vertices,
        crushed.halfExtents,
        BODY_MASS_DESC,
      );
      slot.shapeKey = crushed.key;
    } else if (slot.kind !== state.modelKind || slot.shapeKey !== null) {
      physics.setBodyShape(
        slot.bodyId,
        CAR_MODELS[state.modelKind].halfExtents,
        BODY_MASS_DESC,
      );
      slot.shapeKey = null;
    }
    slot.kind = state.modelKind;
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
    } else {
      // The limited-force body can lag far behind its authored station after
      // contact. Continue the visual follower from the solved road position,
      // or demotion would teleport it to the stale target station.
      physics.getTransform(slot.bodyId, readPosition, readRotation);
      Object.assign(record.state.position, readPosition);
      record.station = nearestRoadStation(readPosition);
    }
    physics.deactivateBody(slot.bodyId);
    record.state.bodyId = -1;
    slot.record = null;
    record.slot = null;
    physicalCount--;
  }

  function makeRoomFor(
    player: V3,
    candidateDistanceSquared: number,
    urgent = false,
  ): void {
    if (physicalCount < MAX_DRIVING) return;
    // A closer intact car takes a body from a farther one. Hysteresis keeps
    // two cars at the edge from swapping bodies every step.
    const threshold = urgent ? 0 : Math.sqrt(candidateDistanceSquared) + 20;
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
      // A distant collision must not steal the player's immediately hittable
      // car. If no safe slot exists, that follower will queue visually.
      if (urgent && candidateDistanceSquared > 60 ** 2 && distance < 60 ** 2)
        continue;
      if (distance > farthest) {
        farthest = distance;
        victim = record;
      }
    }
    if (victim) demote(victim);
  }

  function preStep(dt: number, player: V3, playerSpeed = 0): void {
    trafficSeconds += dt;
    newlyWrecked.length = 0;
    stepDt = dt;
    if (!rivalryStarted && playerSpeed > 10) {
      rivalDriveSeconds += dt;
      rivalryStarted = rivalDriveSeconds >= RIVAL_ATTACK_GRACE_SECONDS;
    }
    if (hasRivals) {
      if (rivalryStarted) rivalSeconds += dt;
      rivalTargets.length = 0;
      for (const record of authored)
        if (record.state.rival && !record.wrecked)
          rivalTargets.push(record.state.position);
      if (rivalryStarted) {
        const windowIndex = Math.floor(rivalSeconds / 3);
        const previous = authored.find(
          (record) => record.state.id === attackCarId && !record.wrecked,
        );
        if (windowIndex !== attackWindowIndex || !previous) {
          attackWindowIndex = windowIndex;
          let selected: RecordState | undefined;
          let bestScore = Infinity;
          for (const record of authored) {
            const car = record.state;
            if (!car.rival || record.wrecked) continue;
            const dx = player.x - car.position.x;
            const dz = player.z - car.position.z;
            const distance = Math.hypot(dx, dz);
            if (distance > 120) continue;
            const assigned =
              rivalAttackActive(rivalSeconds, car.id) && distance <= 60;
            const aheadOfCar = dx * car.forward.x + dz * car.forward.z;
            const score =
              (assigned ? -1000 : 0) + distance - (aheadOfCar > 0 ? 16 : 0);
            if (score >= bestScore) continue;
            bestScore = score;
            selected = record;
          }
          attackCarId = selected?.state.id ?? 0;
        }
      }
    }
    if (hasRivals) stationRefresh += dt;
    if (hasRivals && stationRefresh >= 0.2) {
      stationRefresh = 0;
      playerStation = nearestRoadStation(player);
    }
    if (hasRivals)
      for (const record of authored) {
        if (!record.state.rival || !record.wrecked) continue;
        record.wreckAge += dt;
        const behind =
          (playerStation - record.station + path.length) % path.length;
        const outOfRearView =
          behind >= RIVAL_REJOIN_BEHIND && behind < path.length / 2;
        if (
          record.wreckAge < RIVAL_REJOIN_SECONDS ||
          (!outOfRearView &&
            horizontalDistanceSquared(
              player,
              record.state.position.x,
              record.state.position.z,
            ) <
              (VISUAL_RADIUS + 40) ** 2)
        )
          continue;
        demote(record);
        const index = wreckRecords.indexOf(record);
        if (index >= 0) wreckRecords.splice(index, 1);
        record.wrecked = false;
        record.state.wrecked = false;
        record.state.id = nextEncounterId++;
        record.state.crush.front =
          record.state.crush.rear =
          record.state.crush.left =
          record.state.crush.right =
            0;
        record.station =
          (playerStation -
            115 -
            (authored.indexOf(record) % RIVAL_PACK_OFFSETS.length) * 20 +
            path.length) %
          path.length;
        record.driveSpeed = record.authored.speed;
        record.wreckAge = 0;
        record.attackOffset = 0;
        record.obstacle = null;
        record.obstacleLate = false;
        record.shapeDirty = true;
        updateVisualPose(record);
      }
    visualStates.length = 0;
    nearbyWrecks.length = 0;
    for (const record of wreckRecords) {
      record.threatened = false;
      if (
        record.enabled &&
        horizontalDistanceSquared(
          player,
          record.state.position.x,
          record.state.position.z,
        ) <=
          (VISUAL_RADIUS + WRECK_LOOKAHEAD) ** 2
      )
        nearbyWrecks.push(record);
    }
    if (nearbyWrecks.length) {
      for (const record of authored) {
        if (
          record.enabled &&
          !record.wrecked &&
          horizontalDistanceSquared(
            player,
            record.state.position.x,
            record.state.position.z,
          ) <=
            (VISUAL_RADIUS + WRECK_LOOKAHEAD) ** 2
        )
          updateObstacle(record);
        else record.obstacle = null;
      }
    } else if (hadNearbyWrecks) {
      for (const record of authored) record.obstacle = null;
    }
    hadNearbyWrecks = nearbyWrecks.length > 0;
    // A wreck is the obstacle itself. Preserve/promote its collider before
    // assigning a body to any incoming car, even if the wreck moved away
    // from its authored station after the hit.
    for (const wreck of nearbyWrecks) {
      if (!wreck.threatened || wreck.slot) continue;
      const distanceSquared = horizontalDistanceSquared(
        player,
        wreck.state.position.x,
        wreck.state.position.z,
      );
      if (distanceSquared > WRECK_PHYSICS_RADIUS ** 2) continue;
      makeRoomFor(player, distanceSquared, true);
      if (physicalCount < MAX_DRIVING) promote(wreck, player);
    }
    // A car too close to brake must get a real collision, rather than keep
    // following its visual-only lane pose through the wreck.
    for (const record of authored) {
      if (!record.obstacleLate || !record.obstacle?.slot || record.slot)
        continue;
      const distanceSquared = horizontalDistanceSquared(
        player,
        record.state.position.x,
        record.state.position.z,
      );
      if (distanceSquared > WRECK_PHYSICS_RADIUS ** 2) continue;
      makeRoomFor(player, distanceSquared, true);
      if (physicalCount < MAX_DRIVING) promote(record, player);
    }
    // Refresh one distant slice per step instead of all authored cars on the
    // same 10 Hz tick. Nearby poses still update every step.
    const farPoseBuckets = Math.max(1, Math.round(0.1 / dt));
    farPoseBucket = (farPoseBucket + 1) % farPoseBuckets;
    // Convex hull replacement is expensive during a pileup. Apply at most one
    // latest crush state per step, rotating through the physical pool so a
    // sustained scrape cannot starve another car's pending shape update.
    let shapeUpdates = 0;
    for (
      let scanned = 0;
      scanned < slots.length && shapeUpdates < CRUSH_SHAPE_UPDATES_PER_STEP;
      scanned++
    ) {
      const index = (shapeSlotCursor + scanned) % slots.length;
      const slot = slots[index]!;
      const record = slot.record;
      if (!record?.shapeDirty) continue;
      updateSlotShape(slot, record);
      record.shapeDirty = false;
      shapeSlotCursor = (index + 1) % slots.length;
      shapeUpdates++;
    }
    for (let i = 0; i < authored.length; i++) {
      const record = authored[i]!;
      const state = record.state;
      if (
        state.rival &&
        !record.wrecked &&
        !record.slot &&
        horizontalDistanceSquared(player, state.position.x, state.position.z) >
          (VISUAL_RADIUS + 40) ** 2
      ) {
        // Once fully outside the rendered world, return behind the chase
        // camera. This preserves a continuous nearby contest without a car
        // appearing suddenly in the forward road scene.
        record.station =
          (playerStation -
            115 -
            (i % RIVAL_PACK_OFFSETS.length) * 20 +
            path.length) %
          path.length;
        updateVisualPose(record);
      }
      const attackNow =
        state.rival &&
        rivalryStarted &&
        playerSpeed >= RIVAL_PLAYER_ATTACK_MIN_SPEED &&
        state.id === attackCarId;
      const attackPlayer = attackNow ? player : state.position;
      if (state.rival && !record.wrecked) {
        const target = rivalAttackTarget(
          state.position,
          state.forward,
          attackPlayer,
          rivalTargets,
        );
        record.attackOffset = approachRivalLine(
          record.attackOffset,
          attackNow ? target : 0,
          dt,
        );
      }
      if (!record.wrecked) {
        const direction = state.direction;
        if (
          !state.rival &&
          (record.slot || i % farPoseBuckets === farPoseBucket)
        )
          record.cornerLimit = civilianCornerSpeed(
            record,
            record.authored.speed,
          );
        let desiredSpeed = state.rival
          ? record.authored.speed
          : record.cornerLimit;
        if (!state.rival) desiredSpeed = signalSpeed(record, desiredSpeed);
        if (state.rival) {
          const ahead =
            (record.station - playerStation + path.length) % path.length;
          const behind =
            (playerStation - record.station + path.length) % path.length;
          const signed = ahead <= behind ? ahead : -behind;
          const packIndex = i % RIVAL_PACK_OFFSETS.length;
          // During an attack window, close the pack target to an alongside
          // gap by speed control rather than teleporting the rival.
          const normalTarget = RIVAL_PACK_OFFSETS[packIndex]!;
          const target = attackNow
            ? Math.sign(normalTarget) * RIVAL_STRIKE_OFFSET
            : normalTarget;
          if (!rivalryStarted) {
            // Preserve the proven #195 launch behaviour during the grace:
            // parked players do not attract a 52 m/s pack through spawn.
            const launchTarget =
              RIVAL_START_OFFSETS[packIndex]! +
              (packIndex === 1
                ? Math.max(0, Math.min(20, playerSpeed - 40))
                : 0);
            desiredSpeed = Math.max(
              0,
              Math.min(
                85,
                playerSpeed -
                  Math.max(-20, Math.min(20, (signed - launchTarget) * 0.28)),
              ),
            );
          } else {
            // Own boost raises the speed ceiling for a short pulse. A rival
            // ahead eases off only when it leaves the contest; one behind closes
            // at boosted pace. The force controller still governs acceleration.
            const error = signed - target;
            const boosted = rivalBoostBonus(rivalSeconds, state.id);
            const packCorrection = Math.max(-18, Math.min(20, error * 0.4));
            desiredSpeed = Math.max(
              18,
              Math.min(
                88,
                Math.max(52, playerSpeed + 4) +
                  boosted -
                  packCorrection +
                  (attackNow
                    ? rivalRamSpeedBonus(
                        state.position,
                        state.forward,
                        attackPlayer,
                        rivalTargets,
                      )
                    : 0),
              ),
            );
          }
        }
        if (rules && record.enabled && record.leader) {
          let ahead: RecordState | null = record.leader;
          while (ahead?.wrecked) ahead = ahead.leader;
          if (ahead === record) ahead = null;
          if (ahead) {
            const gap =
              (((direction * (ahead.station - record.station)) % path.length) +
                path.length) %
              path.length;
            // A faster car queues behind a slower one, without lane swapping.
            const safeGap = Math.max(
              rules.minGap,
              safeFollowingGap(record, ahead),
            );
            const followingSpeed = ahead.driveSpeed + (gap - safeGap) * 0.6;
            record.driveSpeed = Math.max(
              0,
              Math.min(desiredSpeed, followingSpeed),
            );
          } else record.driveSpeed = desiredSpeed;
        } else record.driveSpeed = desiredSpeed;
        if (record.obstacle) {
          const canHit =
            record.obstacleLate && record.slot && record.obstacle.slot;
          if (!canHit) {
            const clearance = Math.max(
              0,
              record.obstacleClearance - WRECK_STOP_MARGIN,
            );
            record.driveSpeed = Math.min(
              record.driveSpeed,
              Math.sqrt(2 * WRECK_PLANNED_BRAKE * clearance),
            );
            if (!record.slot)
              record.driveSpeed = Math.min(record.driveSpeed, clearance / dt);
          }
        }
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
      if (
        record.slot &&
        distanceSquared > EXIT * EXIT &&
        !(
          record.wrecked &&
          record.threatened &&
          distanceSquared <= WRECK_PHYSICS_RADIUS ** 2
        )
      ) {
        demote(record);
        updateVisualPose(record);
        continue;
      }
      if (!record.slot && distanceSquared <= ENTER * ENTER) {
        makeRoomFor(player, distanceSquared);
        if (physicalCount < MAX_DRIVING) promote(record, player);
      }
      const slot = record.slot;
      if (!slot) continue;
      // Contacts only record damage. The pool pass above performs at most one
      // inward hull swap before the next solver step.
      record.contactGap += dt;
      if (record.contactGap >= CONTACT_EPISODE_GAP) record.slamSides = 0;
      record.scrapeSides = 0;
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
      const lateralCorrectionCap = state.rival && rivalryStarted ? 6 : 3;
      const laneFollowGain = state.rival && rivalryStarted ? 2 : 0.7;
      const desiredX =
        -Math.sin(nextHeading) * record.driveSpeed +
        Math.max(
          -lateralCorrectionCap,
          Math.min(
            lateralCorrectionCap,
            (pose.x - state.position.x) * laneFollowGain,
          ),
        );
      const desiredZ =
        -Math.cos(nextHeading) * record.driveSpeed +
        Math.max(
          -lateralCorrectionCap,
          Math.min(
            lateralCorrectionCap,
            (pose.z - state.position.z) * laneFollowGain,
          ),
        );
      // Soft speed hold; a hit still wins over the controller.
      force.x = (desiredX - state.velocity.x) * BODY_MASS * 2;
      force.z = (desiredZ - state.velocity.z) * BODY_MASS * 2;
      const magnitude = Math.hypot(force.x, force.z);
      // Rivals can close after boost without a position warp; ordinary
      // traffic keeps the calmer five-metre-per-second-squared controller.
      const accelerationCap = record.obstacle
        ? WRECK_BRAKE
        : state.rival
          ? 26
          : 5;
      if (magnitude > BODY_MASS * accelerationCap) {
        const scale = (BODY_MASS * accelerationCap) / magnitude;
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
      for (let sideIndex = 0; sideIndex < CRUSH_SIDES.length; sideIndex++) {
        if (!(record.scrapeSides & (1 << sideIndex))) continue;
        const side = CRUSH_SIDES[sideIndex]!;
        const oldCrush = record.state.crush[side];
        record.state.crush[side] = Math.max(
          record.state.crush[side],
          Math.min(
            SCRAPE_CRUSH_CAP,
            record.state.crush[side] + SCRAPE_CRUSH_PER_SECOND * stepDt,
          ),
        );
        if (record.state.crush[side] > oldCrush) record.shapeDirty = true;
      }
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

  function addSlam(
    record: RecordState,
    sideIndex: number,
    speed: number,
    multiplier = 1,
  ): void {
    const bit = 1 << sideIndex;
    if (record.slamSides & bit) return;
    const side = CRUSH_SIDES[sideIndex]!;
    const oldCrush = record.state.crush[side];
    record.state.crush[side] = Math.min(
      1,
      oldCrush + slamCrushChunk(speed) * multiplier,
    );
    if (record.state.crush[side] > oldCrush) record.shapeDirty = true;
    record.slamSides |= bit;
  }

  function recordContactCrush(
    record: RecordState,
    nx: number,
    ny: number,
    nz: number,
    closingSpeed: number,
    allowScrape: boolean,
    slamMultiplier = 1,
  ): void {
    if (Math.hypot(nx, nz) < 0.45) {
      // A hard roof or underbody landing compresses the whole shell. A normal
      // ground contact never reaches the slam threshold and is ignored.
      if (Math.abs(ny) < 0.7 || closingSpeed < HARD_LANDING_CLOSING_SPEED)
        return;
      for (let sideIndex = 0; sideIndex < CRUSH_SIDES.length; sideIndex++)
        addSlam(record, sideIndex, closingSpeed, slamMultiplier);
      record.contactGap = 0;
      return;
    }
    const side = visualCrushSide(record.state, nx, ny, nz);
    if (!side) return;
    const sideIndex = CRUSH_SIDES.indexOf(side);
    if (closingSpeed >= SLAM_CLOSING_SPEED)
      addSlam(record, sideIndex, closingSpeed, slamMultiplier);
    else if (allowScrape) record.scrapeSides |= 1 << sideIndex;
    else return;
    record.contactGap = 0;
  }

  /** Called inside the contact callback: only the supplied Body readers may
   * be used. Both sides of a traffic-to-traffic impact receive the same
   * closing speed, with opposite outward struck-face normals. */
  function onWorldContact(
    a: BodyId,
    b: BodyId,
    normal: Readonly<V3>,
    readVelocities: ContactVelocityReader,
  ): void {
    const recordA = slotByBodyId.get(a)?.record;
    const recordB = slotByBodyId.get(b)?.record;
    if (!recordA && !recordB) return;
    readVelocities(contactVelocityA, contactVelocityB);
    const dx = contactVelocityA.x - contactVelocityB.x;
    const dy = contactVelocityA.y - contactVelocityB.y;
    const dz = contactVelocityA.z - contactVelocityB.z;
    const normalSpeed = dx * normal.x + dy * normal.y + dz * normal.z;
    const closingSpeed = Math.max(0, normalSpeed);
    const tangentSpeedSquared = Math.max(
      0,
      dx * dx + dy * dy + dz * dz - normalSpeed * normalSpeed,
    );
    const grinding = tangentSpeedSquared > 0.8 * 0.8;
    const horizontalHit = Math.hypot(normal.x, normal.z) >= 0.7;
    const rivalTrafficHit =
      !!recordA &&
      !!recordB &&
      horizontalHit &&
      (recordA.state.rival || recordB.state.rival);
    if (recordA) {
      const rivalSolidHit = recordA.state.rival && !recordB && horizontalHit;
      recordContactCrush(
        recordA,
        normal.x,
        normal.y,
        normal.z,
        closingSpeed,
        grinding,
        rivalSolidHit
          ? RIVAL_SOLID_CRUSH_MULTIPLIER
          : rivalTrafficHit
            ? RIVAL_TRAFFIC_CRUSH_MULTIPLIER
            : 1,
      );
      if (
        closingSpeed >=
        (rivalSolidHit
          ? RIVAL_SOLID_WRECK_SPEED
          : rivalTrafficHit
            ? RIVAL_TRAFFIC_WRECK_SPEED
            : WORLD_WRECK_CLOSING_SPEED)
      ) {
        markWreck(recordA);
      }
    }
    if (recordB) {
      const rivalSolidHit = recordB.state.rival && !recordA && horizontalHit;
      recordContactCrush(
        recordB,
        -normal.x,
        -normal.y,
        -normal.z,
        closingSpeed,
        grinding,
        rivalSolidHit
          ? RIVAL_SOLID_CRUSH_MULTIPLIER
          : rivalTrafficHit
            ? RIVAL_TRAFFIC_CRUSH_MULTIPLIER
            : 1,
      );
      if (
        closingSpeed >=
        (rivalSolidHit
          ? RIVAL_SOLID_WRECK_SPEED
          : rivalTrafficHit
            ? RIVAL_TRAFFIC_WRECK_SPEED
            : WORLD_WRECK_CLOSING_SPEED)
      ) {
        markWreck(recordB);
      }
    }
  }

  /** Called inside the contact callback: no physics reads or mutations. */
  function onPlayerContact(
    otherBody: BodyId,
    impact: Readonly<ImpactSeverity>,
    normalIntoPlayer?: Readonly<V3>,
    relativeVelocity?: Readonly<V3>,
  ): void {
    const record = slotByBodyId.get(otherBody)?.record;
    if (record) {
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
          recordContactCrush(record, nx, ny, nz, closingSpeed, true);
        }
      }
      // Gentle contact dents without counting as a wreck or a slam.
      if (impact.severity < 0.25) return;
      if (record.wrecked) return;
      markWreck(record);
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
    }
  }

  /** Last post-step velocity, safe to read inside a contact callback. */
  function velocityForBody(bodyId: BodyId): Readonly<V3> | undefined {
    return slotByBodyId.get(bodyId)?.record?.state.velocity;
  }

  /** Restart an event without recreating pooled Jolt bodies. A retired
   * encounter gets a new id so contact/near-miss history cannot leak into the
   * next run, even if the same authored rival starts in the same lane. */
  function resetForEvent(): void {
    for (const record of authored) {
      demote(record);
      record.station = record.authored.station;
      record.state.id = nextEncounterId++;
      record.state.bodyId = -1;
      record.state.speed = record.authored.speed;
      record.state.wrecked = false;
      record.state.crush.front = 0;
      record.state.crush.rear = 0;
      record.state.crush.left = 0;
      record.state.crush.right = 0;
      record.wrecked = false;
      record.wreckAge = 0;
      record.driveSpeed = record.authored.speed;
      record.attackOffset = 0;
      record.obstacle = null;
      record.obstacleClearance = Infinity;
      record.obstacleLate = false;
      record.threatened = false;
      record.crashPending = false;
      record.crashClosingSpeed = 0;
      record.crashBleedRemaining = 0;
      record.shapeDirty = false;
      record.contactGap = Infinity;
      record.slamSides = 0;
      record.scrapeSides = 0;
      record.leader = null;
      record.enabled = true;
      updateVisualPose(record);
    }
    wreckRecords.length = 0;
    nearbyWrecks.length = 0;
    newlyWrecked.length = 0;
    visualStates.length = 0;
    rivalTargets.length = 0;
    hadNearbyWrecks = false;
    physicalCount = 0;
    activeCount = authored.length;
    playerStation = 0;
    stationRefresh = 0.2;
    rivalSeconds = 0;
    rivalDriveSeconds = 0;
    rivalryStarted = false;
    attackWindowIndex = -1;
    attackCarId = 0;
    // Force following gaps to be rebuilt at authored stations, even when the
    // density sliders retain exactly the same values as the previous run.
    if (rules) {
      const current = rules;
      rules = undefined;
      setRules(current);
    }
  }

  if (initialRules) setRules(initialRules);

  return {
    /** Reused array and records; safe to iterate after physics without allocation. */
    states: visualStates as readonly TrafficCarState[],
    visualStates: visualStates as readonly TrafficCarState[],
    /** Wreck transitions from this physics step, including off-screen cars. */
    newlyWrecked: newlyWrecked as readonly TrafficCarState[],
    hasRivals,
    recordCount: authored.length,
    /** Test-only controller snapshot, allocated only when browser tooling asks. */
    debugRivals() {
      return {
        rivalryStarted,
        rivalDriveSeconds,
        rivalSeconds,
        attackCarId,
        cars: authored
          .filter((record) => record.state.rival)
          .map((record) => {
            const target = routePose(record, record.station, routeScratch);
            return {
              id: record.state.id,
              selected: record.state.id === attackCarId,
              enabled: record.enabled,
              physical: !!record.slot,
              wrecked: record.wrecked,
              attackOffset: record.attackOffset,
              driveSpeed: record.driveSpeed,
              actualSpeed: record.state.speed,
              targetX: target.x,
              targetZ: target.z,
              errorX: target.x - record.state.position.x,
              errorZ: target.z - record.state.position.z,
              station: record.station,
            };
          }),
      };
    },
    get activeCount() {
      return activeCount;
    },
    setRules,
    resetForEvent,
    preStep,
    postStep,
    onPlayerContact,
    onWorldContact,
    stateForBody(bodyId: BodyId): TrafficCarState | undefined {
      return slotByBodyId.get(bodyId)?.record?.state;
    },
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
        state.rival ? 0 : traffic.hasRivals ? (state.id % 7) + 1 : undefined,
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
