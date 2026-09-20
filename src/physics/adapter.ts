/** SI units; right-handed coordinates, +Y up, vehicle forward -Z. */
export interface V3 {
  x: number;
  y: number;
  z: number;
}
export interface Quat extends V3 {
  w: number;
}
export type BodyId = number;

export interface MassDesc {
  mass: number;
  /** Local offset from the geometric box center; +Z is backward. */
  comOffset: V3;
  /** Local X (pitch), Y (yaw), Z (roll) inertia multipliers. */
  inertiaScale: V3;
}

export interface DynamicBoxDesc extends MassDesc {
  center: V3;
  halfExtents: V3;
  friction: number;
  restitution: number;
  ccd: boolean;
  maxAngularVelocity: number;
  angularDamping: number;
}

export type BodyProperties = Pick<
  DynamicBoxDesc,
  'angularDamping' | 'maxAngularVelocity' | 'friction' | 'restitution'
>;

export interface RayHit {
  distance: number;
  point: V3;
  normal: V3;
  bodyId: BodyId;
  surfaceId: number;
}

export interface PhysicsMemory {
  heapBytes: number;
  freeBytes: number;
}

/** Point and normal are reused scratch records: copy them if retained. */
export type ContactCallback = (
  a: BodyId,
  b: BodyId,
  impulse: number | null,
  point: V3,
  normal: V3,
) => void;

export interface IPhysicsWorld {
  setGravity(g: number): void;
  step(dt: number): void;
  createStaticBox(
    center: V3,
    halfExtents: V3,
    rotY?: number,
    friction?: number,
    restitution?: number,
    surfaceId?: number,
  ): BodyId;
  createDynamicBox(desc: DynamicBoxDesc): BodyId;
  updateMassProperties(id: BodyId, desc: MassDesc): void;
  setBodyProperties(id: BodyId, properties: BodyProperties): void;
  /** Diagonal of the local inertia tensor, including the COM shift and scale. */
  getLocalInertia(id: BodyId, out: V3): void;
  getTransform(id: BodyId, outPos: V3, outQuat: Quat): void;
  getLinearVelocity(id: BodyId, out: V3): void;
  getAngularVelocity(id: BodyId, out: V3): void;
  getPointVelocity(id: BodyId, worldPoint: V3, out: V3): void;
  applyForceAtPoint(id: BodyId, force: V3, worldPoint: V3): void;
  applyTorque(id: BodyId, torque: V3): void;
  setLinearVelocity(id: BodyId, velocity: V3): void;
  setAngularVelocity(id: BodyId, velocity: V3): void;
  setTransform(id: BodyId, pos: V3, quat: Quat, zeroVelocity: boolean): void;
  /** Unit direction; excludes ignoreBody, e.g. the chassis during suspension queries. */
  rayCast(
    origin: V3,
    dir: V3,
    maxLen: number,
    out: RayHit,
    ignoreBody?: BodyId,
  ): boolean;
  /**
   * Null impulse means this engine cannot provide a solved contact impulse.
   * Stock Jolt supplies real IDs/point/normal but no impulse; Rapier can supply
   * a real impulse via its post-solve contactImpulse/contact-force API.
   */
  onContact(callback: ContactCallback): void;
  /** Both heap capacity and allocator free bytes; capacity alone cannot detect leaks. */
  getMemoryStats(out: PhysicsMemory): void;
  dispose(): void;
}
