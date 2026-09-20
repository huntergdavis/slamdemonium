import type { DynamicBoxDesc, IPhysicsWorld, RayHit } from './adapter';

export interface PhysicsSpikeResult {
  settledHeight: number;
  rayDistance: number;
  rayNormalY: number;
  forceVelocityZ: number;
  torqueVelocityY: number;
  ccdMaxX: number;
  meanStepMs: number;
  replayHashes: [string, string];
  finiteSteps: number;
  wasmHeapBytes: number;
  allocatorLostBytes: number;
}
export type WorldFactory = () => Promise<IPhysicsWorld>;

function box(): DynamicBoxDesc {
  return {
    center: { x: 5, y: 2, z: 0 },
    halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
    mass: 12,
    comOffset: { x: 0, y: 0, z: 0 },
    inertiaScale: { x: 1, y: 1, z: 1 },
    friction: 0.3,
    restitution: 0,
    ccd: true,
    maxAngularVelocity: 12,
    angularDamping: 0,
  };
}

async function replay(factory: WorldFactory, seed: number, steps: number) {
  const world = await factory();
  try {
    world.createStaticBox(
      { x: 0, y: -0.5, z: 0 },
      { x: 5000, y: 0.5, z: 5000 },
    );
    const id = world.createDynamicBox(box());
    const p = { x: 5, y: 2, z: 0 };
    const q = { x: 0, y: 0, z: 0, w: 1 };
    const v = { x: 0, y: 0, z: 0 };
    const omega = { x: 0, y: 0, z: 0 };
    const force = { x: 0, y: 0, z: 0 };
    const torque = { x: 0, y: 0, z: 0 };
    let rng = seed >>> 0;
    let elapsedMs = 0;
    for (let step = 0; step < steps; step++) {
      rng ^= rng << 13;
      rng ^= rng >>> 17;
      rng ^= rng << 5;
      force.x = ((rng >>> 0) / 0xffffffff - 0.5) * 600;
      force.z = (step % 240 < 120 ? -1 : 1) * 120;
      torque.y = force.x * 0.1;
      world.applyForceAtPoint(id, force, p);
      world.applyTorque(id, torque);
      const start = performance.now();
      world.step(1 / 120);
      elapsedMs += performance.now() - start;
      world.getTransform(id, p, q);
      world.getLinearVelocity(id, v);
      world.getAngularVelocity(id, omega);
      if (
        !Number.isFinite(
          p.x +
            p.y +
            p.z +
            q.x +
            q.y +
            q.z +
            q.w +
            v.x +
            v.y +
            v.z +
            omega.x +
            omega.y +
            omega.z,
        )
      ) {
        throw new Error('Non-finite state during five-minute replay.');
      }
      if (Math.hypot(omega.x, omega.y, omega.z) > 12.001)
        throw new Error('Angular-velocity cap exceeded.');
    }
    const state = new Float64Array([
      p.x,
      p.y,
      p.z,
      q.x,
      q.y,
      q.z,
      q.w,
      v.x,
      v.y,
      v.z,
      omega.x,
      omega.y,
      omega.z,
    ]);
    const bytes = new Uint8Array(state.buffer);
    let hash = 2166136261;
    for (let i = 0; i < bytes.length; i++)
      hash = Math.imul(hash ^ bytes[i]!, 16777619);
    return {
      hash: (hash >>> 0).toString(16).padStart(8, '0'),
      meanStepMs: elapsedMs / steps,
    };
  } finally {
    world.dispose();
  }
}

/** Runs outside the game hot path; every temporary world is disposed even on failure. */
export async function runPhysicsSpike(
  factory: WorldFactory,
): Promise<PhysicsSpikeResult> {
  const result: PhysicsSpikeResult = {
    settledHeight: 0,
    rayDistance: 0,
    rayNormalY: 0,
    forceVelocityZ: 0,
    torqueVelocityY: 0,
    ccdMaxX: -2,
    meanStepMs: 0,
    replayHashes: ['', ''],
    finiteSteps: 0,
    wasmHeapBytes: 0,
    allocatorLostBytes: 0,
  };
  const world = await factory();
  try {
    world.createStaticBox({ x: 0, y: -0.5, z: 0 }, { x: 50, y: 0.5, z: 50 });
    const id = world.createDynamicBox(box());
    const p = { x: 0, y: 0, z: 0 };
    const q = { x: 0, y: 0, z: 0, w: 1 };
    const velocity = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < 360; i++) world.step(1 / 120);
    world.getTransform(id, p, q);
    result.settledHeight = p.y;
    const hit: RayHit = {
      distance: 0,
      point: { x: 0, y: 0, z: 0 },
      normal: { x: 0, y: 0, z: 0 },
      bodyId: 0,
      surfaceId: 0,
    };
    if (
      !world.rayCast({ x: 5, y: 4, z: 0 }, { x: 0, y: -1, z: 0 }, 10, hit, id)
    )
      throw new Error('Ground ray missed.');
    result.rayDistance = hit.distance;
    result.rayNormalY = hit.normal.y;
    world.setGravity(0);
    world.setTransform(
      id,
      { x: 5, y: 2, z: 0 },
      { x: 0, y: 0, z: 0, w: 1 },
      true,
    );
    world.applyForceAtPoint(id, { x: 0, y: 0, z: -1200 }, { x: 6, y: 2, z: 0 });
    world.applyTorque(id, { x: 0, y: 60, z: 0 });
    world.step(1 / 120);
    world.getLinearVelocity(id, velocity);
    result.forceVelocityZ = velocity.z;
    world.getAngularVelocity(id, velocity);
    result.torqueVelocityY = velocity.y;

    world.createStaticBox({ x: 0, y: 2, z: 0 }, { x: 0.02, y: 2, z: 2 });
    const description = box();
    description.center = { x: -2, y: 2, z: 0 };
    description.halfExtents = { x: 0.1, y: 0.1, z: 0.1 };
    const bullet = world.createDynamicBox(description);
    world.setLinearVelocity(bullet, { x: 85, y: 0, z: 0 });
    for (let i = 0; i < 30; i++) {
      world.step(1 / 120);
      world.getTransform(bullet, p, q);
      result.ccdMaxX = Math.max(result.ccdMaxX, p.x);
    }
  } finally {
    world.dispose();
  }
  const first = await replay(factory, 0x12345678, 36_000);
  const second = await replay(factory, 0x12345678, 36_000);
  result.replayHashes = [first.hash, second.hash];
  result.finiteSteps = 72_000;
  result.meanStepMs = (first.meanStepMs + second.meanStepMs) / 2;

  const memory = { heapBytes: 0, freeBytes: 0 };
  let baseline = 0;
  for (let cycle = 0; cycle < 8; cycle++) {
    const temporary = await factory();
    try {
      temporary.createDynamicBox(box());
      temporary.step(1 / 120);
    } finally {
      temporary.dispose();
    }
    temporary.getMemoryStats(memory);
    if (cycle === 2) baseline = memory.freeBytes;
    if (cycle === 7) result.allocatorLostBytes = baseline - memory.freeBytes;
  }
  result.wasmHeapBytes = memory.heapBytes;
  return result;
}
