import initJolt from 'jolt-physics/wasm';
import wasmUrl from 'jolt-physics/jolt-physics.wasm.wasm?url';
import { DEFAULT_VALUES } from '../tuning/schema';
import type {
  BodyId,
  ContactCallback,
  DynamicBoxDesc,
  IPhysicsWorld,
  MassDesc,
  Quat,
  StaticMeshDesc,
  V3,
} from './adapter';

const STATIC = 0;
const MOVING = 1;
let enginePromise: Promise<typeof initJolt> | undefined;

export interface PhysicsInitOptions {
  /** Node tests supply the exact published binary path; browsers use Vite asset URLs. */
  wasmPath?: string;
}

function copyVector(from: initJolt.Vec3 | initJolt.RVec3, out: V3): void {
  out.x = from.GetX();
  out.y = from.GetY();
  out.z = from.GetZ();
}

function positive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(label);
}

function validateMass(desc: MassDesc): void {
  positive(desc.mass, 'Mass must be positive and finite.');
  positive(desc.inertiaScale.x, 'X inertia scale must be positive.');
  positive(desc.inertiaScale.y, 'Y inertia scale must be positive.');
  positive(desc.inertiaScale.z, 'Z inertia scale must be positive.');
  if (
    !Number.isFinite(desc.comOffset.x + desc.comOffset.y + desc.comOffset.z)
  ) {
    throw new RangeError('Center of mass must be finite.');
  }
}

/** All native engine types and ownership remain inside this file. */
export async function createPhysicsWorld(
  options: PhysicsInitOptions = {},
): Promise<IPhysicsWorld> {
  enginePromise ??= initJolt({
    locateFile: (path: string, prefix: string) =>
      path.endsWith('.wasm') ? (options.wasmPath ?? wasmUrl) : prefix + path,
  });
  const J = await enginePromise;

  const pairs = new J.ObjectLayerPairFilterTable(2);
  pairs.EnableCollision(STATIC, MOVING);
  pairs.EnableCollision(MOVING, MOVING);
  const broad = new J.BroadPhaseLayerInterfaceTable(2, 2);
  const staticLayer = new J.BroadPhaseLayer(STATIC);
  const movingLayer = new J.BroadPhaseLayer(MOVING);
  broad.MapObjectToBroadPhaseLayer(STATIC, staticLayer);
  broad.MapObjectToBroadPhaseLayer(MOVING, movingLayer);
  J.destroy(staticLayer);
  J.destroy(movingLayer);
  const broadPairs = new J.ObjectVsBroadPhaseLayerFilterTable(
    broad,
    2,
    pairs,
    2,
  );
  const settings = new J.JoltSettings();
  // Capacity is paid once in Jolt's fixed WASM allocator. A fresh-process
  // sweep measured about 12.84 MiB used at 1024/4096/2048, versus 20.41 MiB
  // at 8192/32768/16384, with startup staying around 0.4-0.55 s. The larger
  // ceiling gives maps and editors room for thousands of dormant bodies.
  settings.mMaxBodies = 8192;
  settings.mMaxBodyPairs = 32768;
  settings.mMaxContactConstraints = 16384;
  // Deliberate for the single-thread WASM build on GitHub Pages: Pages does
  // not provide cross-origin isolation, so worker threads cannot be used.
  settings.mMaxWorkerThreads = 0;
  settings.mObjectLayerPairFilter = pairs;
  settings.mBroadPhaseLayerInterface = broad;
  settings.mObjectVsBroadPhaseLayerFilter = broadPairs;
  const world = new J.JoltInterface(settings);
  J.destroy(settings); // World owns the three collision-layer interfaces.
  const physics = world.GetPhysicsSystem();
  const bodies = physics.GetBodyInterface();
  const physicsSettings = physics.GetPhysicsSettings();
  physicsSettings.mDeterministicSimulation = true;
  physics.SetPhysicsSettings(physicsSettings);

  const vector = new J.Vec3(0, 0, 0);
  const linear = new J.Vec3(0, 0, 0);
  const angular = new J.Vec3(0, 0, 0);
  const position = new J.RVec3(0, 0, 0);
  const rotation = new J.Quat(0, 0, 0, 1);
  const massProps = new J.MassProperties();
  const ray = new J.RRayCast();
  const raySettings = new J.RayCastSettings();
  const collector = new J.CastRayClosestHitCollisionCollector();
  const broadFilter = new J.DefaultBroadPhaseLayerFilter(
    world.GetObjectVsBroadPhaseLayerFilter(),
    MOVING,
  );
  const objectFilter = new J.DefaultObjectLayerFilter(
    world.GetObjectLayerPairFilter(),
    MOVING,
  );
  const bodyFilter = new J.IgnoreMultipleBodiesFilter();
  bodyFilter.Reserve(1);
  const shapeFilter = new J.ShapeFilter();
  const records = new Map<
    BodyId,
    {
      id: initJolt.BodyID;
      body: initJolt.Body;
      halfExtents: V3;
      dynamic: boolean;
      surfaceId: number;
      inertia: V3;
      /** In the simulation (broadphase). Pooled bodies start false. */
      added: boolean;
    }
  >();
  let disposed = false;
  let contactCallback: ContactCallback | undefined;
  const contactPoint: V3 = { x: 0, y: 0, z: 0 };
  const contactNormal: V3 = { x: 0, y: 0, z: 0 };
  const contactListener = new J.ContactListenerJS();
  contactListener.OnContactValidate = () =>
    J.ValidateResult_AcceptAllContactsForThisBodyPair;
  contactListener.OnContactRemoved = () => {};
  function contact(aPtr: number, bPtr: number, manifoldPtr: number): void {
    if (!contactCallback) return;
    const a = J.wrapPointer(aPtr, J.Body);
    const b = J.wrapPointer(bPtr, J.Body);
    const manifold = J.wrapPointer(manifoldPtr, J.ContactManifold);
    copyVector(manifold.GetWorldSpaceContactPointOn1(0), contactPoint);
    copyVector(manifold.mWorldSpaceNormal, contactNormal);
    // Published bindings do not expose the solver's contact impulse.
    contactCallback(
      a.GetID().GetIndexAndSequenceNumber(),
      b.GetID().GetIndexAndSequenceNumber(),
      null,
      contactPoint,
      contactNormal,
    );
  }
  contactListener.OnContactAdded = contact;
  contactListener.OnContactPersisted = contact;
  physics.SetContactListener(contactListener);

  function assertAlive(): void {
    if (disposed) throw new Error('Physics world is disposed.');
  }
  function record(id: BodyId) {
    const value = records.get(id);
    if (!value) throw new Error('Unknown physics body.');
    return value;
  }
  function shape(half: V3, offset?: V3): initJolt.Shape {
    positive(half.x, 'Box extents must be positive.');
    positive(half.y, 'Box extents must be positive.');
    positive(half.z, 'Box extents must be positive.');
    vector.Set(half.x, half.y, half.z);
    const box = new J.BoxShape(
      vector,
      Math.min(0.05, Math.min(half.x, half.y, half.z) * 0.5),
    );
    box.AddRef();
    if (!offset) return box;
    vector.Set(offset.x, offset.y, offset.z);
    const shifted = new J.OffsetCenterOfMassShape(box, vector);
    shifted.AddRef();
    box.Release();
    return shifted;
  }
  const lastInertia: V3 = { x: 0, y: 0, z: 0 };
  const origin: V3 = { x: 0, y: 0, z: 0 };
  const yawQuat: Quat = { x: 0, y: 0, z: 0, w: 1 };
  function setMass(
    body: initJolt.Body,
    bodyShape: initJolt.Shape,
    desc: MassDesc,
  ): void {
    const source = bodyShape.GetMassProperties();
    massProps.mMass = source.mMass;
    massProps.mInertia = source.mInertia;
    massProps.ScaleToMass(desc.mass);
    // D * I * D preserves symmetry even when a shifted CoM produces cross terms.
    const x = Math.sqrt(desc.inertiaScale.x);
    const y = Math.sqrt(desc.inertiaScale.y);
    const z = Math.sqrt(desc.inertiaScale.z);
    const inertia = massProps.mInertia;
    const colX = inertia.GetAxisX();
    vector.Set(colX.GetX() * x * x, colX.GetY() * y * x, colX.GetZ() * z * x);
    inertia.SetAxisX(vector);
    const colY = inertia.GetAxisY();
    vector.Set(colY.GetX() * x * y, colY.GetY() * y * y, colY.GetZ() * z * y);
    inertia.SetAxisY(vector);
    const colZ = inertia.GetAxisZ();
    vector.Set(colZ.GetX() * x * z, colZ.GetY() * y * z, colZ.GetZ() * z * z);
    inertia.SetAxisZ(vector);
    lastInertia.x = inertia.GetAxisX().GetX();
    lastInertia.y = inertia.GetAxisY().GetY();
    lastInertia.z = inertia.GetAxisZ().GetZ();
    body.GetMotionProperties().SetMassProperties(J.EAllowedDOFs_All, massProps);
  }
  function add(
    body: initJolt.Body,
    half: V3,
    dynamic: boolean,
    surfaceId: number,
    activate = true,
  ): BodyId {
    const id = body.GetID(); // Borrowed until DestroyBody.
    const key = id.GetIndexAndSequenceNumber();
    records.set(key, {
      id,
      body,
      halfExtents: { ...half },
      dynamic,
      surfaceId,
      inertia: { ...lastInertia },
      added: activate,
    });
    if (activate)
      bodies.AddBody(
        id,
        dynamic ? J.EActivation_Activate : J.EActivation_DontActivate,
      );
    return key;
  }
  function setRotation(quat: Quat | undefined): void {
    if (!quat) {
      rotation.Set(0, 0, 0, 1);
      return;
    }
    const length = Math.hypot(quat.x, quat.y, quat.z, quat.w);
    if (!Number.isFinite(length) || Math.abs(length - 1) > 1e-3)
      throw new RangeError('Body rotation must be a unit quaternion.');
    rotation.Set(quat.x, quat.y, quat.z, quat.w);
  }
  function createStatic(
    center: V3,
    quat: Quat | undefined,
    halfExtents: V3,
    friction: number,
    restitution: number,
    surfaceId: number,
    activate: boolean,
  ): BodyId {
    const box = shape(halfExtents);
    position.Set(center.x, center.y, center.z);
    setRotation(quat);
    const creation = new J.BodyCreationSettings(
      box,
      position,
      rotation,
      J.EMotionType_Static,
      STATIC,
    );
    creation.mFriction = friction;
    creation.mRestitution = restitution;
    const body = bodies.CreateBody(creation);
    J.destroy(creation);
    box.Release();
    return add(body, halfExtents, false, surfaceId, activate);
  }
  function createStaticMesh(desc: StaticMeshDesc): BodyId {
    if (
      desc.vertices.length < 3 ||
      desc.indices.length < 3 ||
      desc.indices.length % 3 !== 0
    )
      throw new RangeError('Static mesh needs vertices and complete triangles.');
    for (const index of desc.indices) {
      if (!Number.isInteger(index) || index < 0 || index >= desc.vertices.length)
        throw new RangeError('Static mesh index is out of range.');
    }
    const triangles = new J.TriangleList();
    triangles.reserve(desc.indices.length / 3);
    for (let i = 0; i < desc.indices.length; i += 3) {
      const v1 = desc.vertices[desc.indices[i]!]!;
      const v2 = desc.vertices[desc.indices[i + 1]!]!;
      const v3 = desc.vertices[desc.indices[i + 2]!]!;
      triangles.push_back(
        new J.Triangle(
          new J.Vec3(v1.x, v1.y, v1.z),
          new J.Vec3(v2.x, v2.y, v2.z),
          new J.Vec3(v3.x, v3.y, v3.z),
          0,
        ),
      );
    }
    for (const vertex of desc.vertices) {
      if (!Number.isFinite(vertex.x + vertex.y + vertex.z))
        throw new RangeError('Static mesh vertex must be finite.');
    }
    const materials = new J.PhysicsMaterialList();
    const material = new J.PhysicsMaterial();
    materials.push_back(material);
    const settings = new J.MeshShapeSettings(triangles, materials);
    settings.Sanitize();
    const result = settings.Create();
    if (result.HasError()) {
      const error = result.GetError();
      J.destroy(result);
      J.destroy(settings);
      J.destroy(material);
      J.destroy(materials);
      J.destroy(triangles);
      throw new Error('Static mesh shape failed: ' + error.toString());
    }
    const mesh = result.Get();
    position.Set(desc.center.x, desc.center.y, desc.center.z);
    setRotation(desc.rotation);
    const creation = new J.BodyCreationSettings(
      mesh,
      position,
      rotation,
      J.EMotionType_Static,
      STATIC,
    );
    creation.mFriction = desc.friction ?? 0.5;
    creation.mRestitution = desc.restitution ?? 0;
    const body = bodies.CreateBody(creation);
    J.destroy(creation);
    mesh.AddRef();
    mesh.Release();
    J.destroy(result);
    J.destroy(settings);
    J.destroy(material);
    J.destroy(materials);
    J.destroy(triangles);
    const extent = { x: 0, y: 0, z: 0 };
    for (const vertex of desc.vertices) {
      extent.x = Math.max(extent.x, Math.abs(vertex.x));
      extent.y = Math.max(extent.y, Math.abs(vertex.y));
      extent.z = Math.max(extent.z, Math.abs(vertex.z));
    }
    return add(body, extent, false, desc.surfaceId ?? 0, true);
  }
  function createDynamic(
    desc: Omit<DynamicBoxDesc, 'center'>,
    center: V3,
    surfaceId: number,
    activate: boolean,
  ): BodyId {
    validateMass(desc);
    const box = shape(desc.halfExtents, desc.comOffset);
    position.Set(center.x, center.y, center.z);
    rotation.Set(0, 0, 0, 1);
    const creation = new J.BodyCreationSettings(
      box,
      position,
      rotation,
      J.EMotionType_Dynamic,
      MOVING,
    );
    creation.mFriction = desc.friction;
    creation.mRestitution = desc.restitution;
    creation.mMotionQuality = desc.ccd
      ? J.EMotionQuality_LinearCast
      : J.EMotionQuality_Discrete;
    creation.mAngularDamping = desc.angularDamping;
    creation.mLinearDamping = 0; // The vehicle owns coast drag.
    creation.mMaxAngularVelocity = desc.maxAngularVelocity;
    creation.mMaxLinearVelocity = 500;
    const body = bodies.CreateBody(creation);
    setMass(body, box, desc);
    J.destroy(creation);
    box.Release();
    return add(body, desc.halfExtents, true, surfaceId, activate);
  }

  const api: IPhysicsWorld = {
    setGravity(g) {
      assertAlive();
      if (!Number.isFinite(g) || g < 0)
        throw new RangeError('Gravity must be a finite magnitude.');
      vector.Set(0, -g, 0);
      physics.SetGravity(vector);
    },
    step(dt) {
      assertAlive();
      positive(dt, 'Physics timestep must be positive and finite.');
      world.Step(dt, 1);
    },
    createStaticBox(
      center,
      halfExtents,
      rotY = 0,
      friction = 0.5,
      restitution = 0,
      surfaceId = 0,
    ) {
      assertAlive();
      yawQuat.y = Math.sin(rotY / 2);
      yawQuat.w = Math.cos(rotY / 2);
      return createStatic(
        center,
        yawQuat,
        halfExtents,
        friction,
        restitution,
        surfaceId,
        true,
      );
    },
    createStaticBody(desc) {
      assertAlive();
      return createStatic(
        desc.center,
        desc.rotation,
        desc.halfExtents,
        desc.friction ?? 0.5,
        desc.restitution ?? 0,
        desc.surfaceId ?? 0,
        true,
      );
    },
    createStaticMesh(desc) {
      assertAlive();
      return createStaticMesh(desc);
    },
    createDynamicBox(desc: DynamicBoxDesc) {
      assertAlive();
      return createDynamic(desc, desc.center, 0, true);
    },
    createPooledBox(desc) {
      assertAlive();
      return desc.motion === 'static'
        ? createStatic(
            origin,
            undefined,
            desc.halfExtents,
            desc.friction ?? 0.5,
            desc.restitution ?? 0,
            desc.surfaceId ?? 0,
            false,
          )
        : createDynamic(desc, origin, desc.surfaceId ?? 0, false);
    },
    activateBody(id, pos, quat) {
      assertAlive();
      const entry = record(id);
      position.Set(pos.x, pos.y, pos.z);
      setRotation(quat);
      bodies.SetPositionAndRotation(
        entry.id,
        position,
        rotation,
        J.EActivation_DontActivate,
      );
      if (entry.dynamic) {
        vector.Set(0, 0, 0);
        bodies.SetLinearAndAngularVelocity(entry.id, vector, vector);
      }
      if (!entry.added) {
        bodies.AddBody(
          entry.id,
          entry.dynamic ? J.EActivation_Activate : J.EActivation_DontActivate,
        );
        entry.added = true;
      } else if (entry.dynamic) bodies.ActivateBody(entry.id);
    },
    deactivateBody(id) {
      assertAlive();
      const entry = record(id);
      if (!entry.added) return;
      bodies.RemoveBody(entry.id);
      entry.added = false;
    },
    isBodyActive(id) {
      return record(id).added;
    },
    destroyBody(id) {
      assertAlive();
      const entry = record(id);
      if (entry.added) bodies.RemoveBody(entry.id);
      bodies.DestroyBody(entry.id);
      records.delete(id);
    },
    updateMassProperties(id, desc) {
      validateMass(desc);
      const entry = record(id);
      if (!entry.dynamic)
        throw new Error('Static bodies have no dynamic mass properties.');
      bodies.GetPositionAndRotation(entry.id, position, rotation);
      bodies.GetLinearAndAngularVelocity(entry.id, linear, angular);
      const box = shape(entry.halfExtents, desc.comOffset);
      bodies.SetShape(entry.id, box, false, J.EActivation_Activate);
      setMass(entry.body, box, desc);
      Object.assign(entry.inertia, lastInertia);
      box.Release();
      bodies.SetPositionRotationAndVelocity(
        entry.id,
        position,
        rotation,
        linear,
        angular,
      );
    },
    setContactProperties(id, friction, restitution) {
      const body = record(id).body;
      body.SetFriction(friction);
      body.SetRestitution(restitution);
    },
    setBodyProperties(id, properties) {
      const body = record(id).body;
      const motion = body.GetMotionProperties();
      motion.SetAngularDamping(properties.angularDamping);
      motion.SetMaxAngularVelocity(properties.maxAngularVelocity);
      body.SetFriction(properties.friction);
      body.SetRestitution(properties.restitution);
    },
    getLocalInertia(id, out) {
      const inertia = record(id).inertia;
      out.x = inertia.x;
      out.y = inertia.y;
      out.z = inertia.z;
    },
    getTransform(id, outPos: V3, outQuat: Quat) {
      bodies.GetPositionAndRotation(record(id).id, position, rotation);
      copyVector(position, outPos);
      outQuat.x = rotation.GetX();
      outQuat.y = rotation.GetY();
      outQuat.z = rotation.GetZ();
      outQuat.w = rotation.GetW();
    },
    getLinearVelocity(id, out) {
      bodies.GetLinearAndAngularVelocity(record(id).id, linear, angular);
      copyVector(linear, out);
    },
    getAngularVelocity(id, out) {
      bodies.GetLinearAndAngularVelocity(record(id).id, linear, angular);
      copyVector(angular, out);
    },
    getPointVelocity(id, point, out) {
      position.Set(point.x, point.y, point.z);
      copyVector(bodies.GetPointVelocity(record(id).id, position), out);
    },
    applyForceAtPoint(id, force, point) {
      vector.Set(force.x, force.y, force.z);
      position.Set(point.x, point.y, point.z);
      bodies.AddForce(record(id).id, vector, position, J.EActivation_Activate);
    },
    applyTorque(id, torque) {
      vector.Set(torque.x, torque.y, torque.z);
      bodies.AddTorque(record(id).id, vector, J.EActivation_Activate);
    },
    setLinearVelocity(id, velocity) {
      vector.Set(velocity.x, velocity.y, velocity.z);
      const body = record(id).id;
      bodies.SetLinearVelocity(body, vector);
      bodies.ActivateBody(body);
    },
    setAngularVelocity(id, velocity) {
      vector.Set(velocity.x, velocity.y, velocity.z);
      const entry = record(id);
      entry.body.GetMotionProperties().SetAngularVelocityClamped(vector);
      bodies.ActivateBody(entry.id);
    },
    setTransform(id, pos, quat, zeroVelocity) {
      position.Set(pos.x, pos.y, pos.z);
      rotation.Set(quat.x, quat.y, quat.z, quat.w);
      const entry = record(id);
      bodies.SetPositionAndRotation(
        entry.id,
        position,
        rotation,
        J.EActivation_Activate,
      );
      if (zeroVelocity && entry.dynamic) {
        vector.Set(0, 0, 0);
        bodies.SetLinearAndAngularVelocity(entry.id, vector, vector);
        entry.body.ResetForce();
        entry.body.ResetTorque();
      }
    },
    rayCast(origin, dir, maxLen, out, ignoreBody) {
      assertAlive();
      positive(maxLen, 'Ray length must be positive.');
      ray.mOrigin.Set(origin.x, origin.y, origin.z);
      ray.mDirection.Set(dir.x * maxLen, dir.y * maxLen, dir.z * maxLen);
      collector.Reset();
      bodyFilter.Clear();
      if (ignoreBody !== undefined)
        bodyFilter.IgnoreBody(record(ignoreBody).id);
      physics
        .GetNarrowPhaseQuery()
        .CastRay(
          ray,
          raySettings,
          collector,
          broadFilter,
          objectFilter,
          bodyFilter,
          shapeFilter,
        );
      if (!collector.HadHit()) return false;
      const hit = collector.mHit;
      out.distance = hit.mFraction * maxLen;
      out.bodyId = hit.mBodyID.GetIndexAndSequenceNumber();
      out.surfaceId = record(out.bodyId).surfaceId;
      const point = ray.GetPointOnRay(hit.mFraction);
      copyVector(point, out.point);
      copyVector(
        record(out.bodyId).body.GetWorldSpaceSurfaceNormal(
          hit.mSubShapeID2,
          point,
        ),
        out.normal,
      );
      return true;
    },
    onContact(callback) {
      contactCallback = callback;
    },
    getMemoryStats(out) {
      out.heapBytes = J.HEAPU8.byteLength;
      out.freeBytes = J.JoltInterface.prototype.sGetFreeMemory();
    },
    dispose() {
      if (disposed) return;
      contactCallback = undefined;
      for (const entry of records.values()) {
        if (entry.added) bodies.RemoveBody(entry.id);
        bodies.DestroyBody(entry.id);
      }
      records.clear();
      // Filters borrow world infrastructure, so destroy them before the world.
      for (const owned of [
        shapeFilter,
        bodyFilter,
        objectFilter,
        broadFilter,
        collector,
        raySettings,
        ray,
        massProps,
        rotation,
        position,
        angular,
        linear,
        vector,
      ])
        J.destroy(owned);
      J.destroy(world);
      J.destroy(contactListener);
      disposed = true;
    },
  };
  api.setGravity(DEFAULT_VALUES.gravity);
  return api;
}
