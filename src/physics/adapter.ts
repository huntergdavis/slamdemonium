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

/** A static box with a full rotation, so a pitched ramp is one body.
 * `rotation` defaults to identity and must be a unit quaternion. */
export interface StaticBodyDesc {
  center: V3;
  halfExtents: V3;
  rotation?: Quat;
  friction?: number;
  restitution?: number;
  surfaceId?: number;
}

/** A static triangle mesh. Vertices and indices are local to `center` and
 * `rotation`; the same authored mesh can therefore feed physics and render. */
export interface StaticMeshDesc {
  center: V3;
  vertices: readonly V3[];
  indices: readonly number[];
  rotation?: Quat;
  friction?: number;
  restitution?: number;
  surfaceId?: number;
}
/** A body created at boot and kept out of the simulation until activated.
 * Activation and deactivation never create or destroy anything, so they
 * leave the WebAssembly heap exactly where the boot baseline put it. */
export type PooledBoxDesc =
  | {
      motion: 'static';
      halfExtents: V3;
      friction?: number;
      restitution?: number;
      surfaceId?: number;
    }
  | ({ motion: 'dynamic'; surfaceId?: number } & Omit<
      DynamicBoxDesc,
      'center'
    >);

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
  createStaticBody(desc: StaticBodyDesc): BodyId;
  createStaticMesh(desc: StaticMeshDesc): BodyId;
  createDynamicBox(desc: DynamicBoxDesc): BodyId;
  /** Boot only: creates the body but does not add it to the simulation. */
  createPooledBox(desc: PooledBoxDesc): BodyId;
  /** Places an inactive pooled body and adds it to the simulation with zero
   * velocity. Idempotent for an already active body (it is moved). */
  activateBody(id: BodyId, pos: V3, quat: Quat): void;
  /** Removes a body from the simulation without destroying it. */
  deactivateBody(id: BodyId): void;
  isBodyActive(id: BodyId): boolean;
  /** Scoped removal for teardown: destroys the body. Never on the hot path. */
  destroyBody(id: BodyId): void;
  updateMassProperties(id: BodyId, desc: MassDesc): void;
  setContactProperties(id: BodyId, friction: number, restitution: number): void;
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
   *
   * The callback runs INSIDE step(), from the engine's contact listener, and
   * two rules follow. Never call any world method from it: a getter such as
   * getLinearVelocity takes a body lock the solver already holds and spins
   * forever in single-threaded WASM (it cost an hour to find; there is no
   * error, only a hang), and adding, removing or moving bodies mid-step is
   * undefined behaviour. Copy the borrowed scalars and the pre-step values
   * you already hold (telemetry velocity, not a fresh read) into fixed
   * storage, and do the work after step() returns. Boot, the audio director
   * and the breakable props all follow this.
   */
  onContact(callback: ContactCallback): void;
  /** Both heap capacity and allocator free bytes; capacity alone cannot detect leaks. */
  getMemoryStats(out: PhysicsMemory): void;
  dispose(): void;
}
