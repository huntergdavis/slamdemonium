import {
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  InstancedMesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Vector3,
  type Scene,
} from 'three';

const MAX_EVENTS = 8;
const MAX_PAIRS = 32;
const MAX_GRINDS = 8;
const NEAR_SQUARED = 400 * 400;
const SPARKS = 48;
const GRIND_SPARKS = 16;
const METAL = 24;
const GLASS = 16;
const PAIR_COOLDOWN = 0.14;
const GRIND_GAP = 0.08;

type Particle = {
  active: boolean;
  grind: boolean;
  age: number;
  life: number;
  groundY: number;
  position: Vector3;
  velocity: Vector3;
  angle: Vector3;
  spin: Vector3;
  size: Vector3;
  paint: number;
};

type BurstEvent = {
  a: number;
  b: number;
  x: number;
  y: number;
  z: number;
  groundY: number;
  nx: number;
  ny: number;
  nz: number;
  vx: number;
  vy: number;
  vz: number;
  closing: number;
  glass: boolean;
};

type GrindPair = {
  a: number;
  b: number;
  firstAt: number;
  lastAt: number;
  nextAt: number;
  x: number;
  y: number;
  z: number;
  groundY: number;
  nx: number;
  ny: number;
  nz: number;
  vx: number;
  vy: number;
  vz: number;
  tangent: number;
};

const particle = (): Particle => ({
  active: false,
  grind: false,
  age: 0,
  life: 0,
  groundY: 0,
  position: new Vector3(),
  velocity: new Vector3(),
  angle: new Vector3(),
  spin: new Vector3(),
  size: new Vector3(),
  paint: 0,
});

/** Three instanced draws, no collision bodies or contact-time allocations.
 * The same borrowed contact values that drive crash audio and camera feedback
 * are copied into eight fixed slots, then rendered after physics. */
export function createWreckParticles(scene: Scene) {
  const geometry = new BoxGeometry(1, 1, 1);
  const sparkMaterial = new MeshBasicMaterial({ color: 0xffc466 });
  const metalMaterial = new MeshStandardMaterial({
    color: 0xffffff,
    metalness: 0.75,
    roughness: 0.48,
    flatShading: true,
  });
  const glassMaterial = new MeshBasicMaterial({
    color: 0xd0f5ff,
    transparent: true,
    opacity: 0.88,
    depthWrite: false,
  });
  const pools = [
    {
      mesh: new InstancedMesh(geometry, sparkMaterial, SPARKS),
      particles: Array.from({ length: SPARKS }, particle),
    },
    {
      mesh: new InstancedMesh(geometry, metalMaterial, METAL),
      particles: Array.from({ length: METAL }, particle),
    },
    {
      mesh: new InstancedMesh(geometry, glassMaterial, GLASS),
      particles: Array.from({ length: GLASS }, particle),
    },
  ] as const;
  for (let index = 0; index < pools.length; index++) {
    const pool = pools[index]!;
    pool.mesh.name = [
      'traffic.wreck.sparks',
      'traffic.wreck.metal',
      'traffic.wreck.glass',
    ][index]!;
    pool.mesh.frustumCulled = false;
    pool.mesh.castShadow = pool.mesh.receiveShadow = false;
    pool.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    pool.mesh.count = 0;
    scene.add(pool.mesh);
  }
  const events: BurstEvent[] = Array.from({ length: MAX_EVENTS }, () => ({
    a: 0,
    b: 0,
    x: 0,
    y: 0,
    z: 0,
    groundY: 0,
    nx: 0,
    ny: 0,
    nz: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    closing: 0,
    glass: false,
  }));
  const pairA = new Float64Array(MAX_PAIRS).fill(-1);
  const pairB = new Float64Array(MAX_PAIRS).fill(-1);
  const pairAt = new Float64Array(MAX_PAIRS).fill(-Infinity);
  const grinds: GrindPair[] = Array.from({ length: MAX_GRINDS }, () => ({
    a: -1,
    b: -1,
    firstAt: -Infinity,
    lastAt: -Infinity,
    nextAt: 0,
    x: 0,
    y: 0,
    z: 0,
    groundY: 0,
    nx: 0,
    ny: 0,
    nz: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    tangent: 0,
  }));
  const helper = new Object3D();
  const tint = new Color();
  let seconds = 0;
  let queued = 0;
  let pairCursor = 0;
  let grindCursor = 0;
  let serial = 0;
  let dropped = 0;
  let burstCount = 0;
  let grindCount = 0;

  function noteGrind(
    a: number,
    b: number,
    point: Readonly<{ x: number; y: number; z: number }>,
    groundY: number,
    normal: Readonly<{ x: number; y: number; z: number }>,
    inherit: Readonly<{ x: number; y: number; z: number }>,
    tangent: number,
  ): void {
    let pair = grinds.find((item) => item.a === a && item.b === b);
    if (!pair) {
      pair = grinds[grindCursor]!;
      grindCursor = (grindCursor + 1) % MAX_GRINDS;
      pair.a = a;
      pair.b = b;
      pair.firstAt = seconds;
      pair.nextAt = seconds + GRIND_GAP;
    } else if (seconds - pair.lastAt > GRIND_GAP) {
      pair.firstAt = seconds;
      pair.nextAt = seconds + GRIND_GAP;
    }
    pair.lastAt = seconds;
    pair.x = point.x;
    pair.y = point.y;
    pair.z = point.z;
    pair.groundY = groundY;
    pair.nx = normal.x;
    pair.ny = normal.y;
    pair.nz = normal.z;
    pair.vx = inherit.x;
    pair.vy = inherit.y;
    pair.vz = inherit.z;
    pair.tangent = tangent;
  }

  function noteContact(
    a: number,
    b: number,
    point: Readonly<{ x: number; y: number; z: number }>,
    groundY: number,
    normal: Readonly<{ x: number; y: number; z: number }>,
    inherit: Readonly<{ x: number; y: number; z: number }>,
    closing: number,
    tangent: number,
    glassEligible: boolean,
    player: Readonly<{ x: number; z: number }>,
  ): void {
    const dx = point.x - player.x;
    const dz = point.z - player.z;
    if (dx * dx + dz * dz > NEAR_SQUARED) return;
    if (tangent >= 2) noteGrind(a, b, point, groundY, normal, inherit, tangent);
    if (closing < 3.5) return;
    let slot = -1;
    for (let index = 0; index < MAX_PAIRS; index++)
      if (pairA[index] === a && pairB[index] === b) {
        slot = index;
        break;
      }
    if (slot >= 0 && seconds - pairAt[slot]! < PAIR_COOLDOWN) return;
    if (slot < 0) {
      slot = pairCursor;
      pairCursor = (pairCursor + 1) % MAX_PAIRS;
    }
    let eventIndex = queued;
    if (queued === MAX_EVENTS) {
      let weakest = 0;
      for (let index = 1; index < MAX_EVENTS; index++)
        if (events[index]!.closing < events[weakest]!.closing) weakest = index;
      dropped++;
      if (closing <= events[weakest]!.closing) return;
      eventIndex = weakest;
    } else queued++;
    pairA[slot] = a;
    pairB[slot] = b;
    pairAt[slot] = seconds;
    const event = events[eventIndex]!;
    event.a = a;
    event.b = b;
    event.x = point.x;
    event.y = point.y;
    event.z = point.z;
    event.groundY = groundY;
    event.nx = normal.x;
    event.ny = normal.y;
    event.nz = normal.z;
    event.vx = inherit.x;
    event.vy = inherit.y;
    event.vz = inherit.z;
    event.closing = closing;
    event.glass = glassEligible && closing >= 10;
  }

  function emit(
    kind: 0 | 1 | 2,
    x: number,
    y: number,
    z: number,
    groundY: number,
    nx: number,
    ny: number,
    nz: number,
    vx: number,
    vy: number,
    vz: number,
    strength: number,
    grind = false,
  ): void {
    const pool = pools[kind];
    // Sustained grinds can occupy only the tail of the spark pool. An impact
    // always has its own 32 slots and may replace the oldest impact fragment
    // in a pileup; it cannot vanish behind a long wall scrape.
    const start = kind === 0 && grind ? SPARKS - GRIND_SPARKS : 0;
    const end =
      kind === 0 && !grind ? SPARKS - GRIND_SPARKS : pool.particles.length;
    let item: Particle | undefined;
    for (let index = start; index < end; index++)
      if (!pool.particles[index]!.active) {
        item = pool.particles[index]!;
        break;
      }
    if (!item && !grind) {
      let oldest = -1;
      for (let index = start; index < end; index++) {
        const candidate = pool.particles[index]!;
        if (candidate.age > oldest) {
          oldest = candidate.age;
          item = candidate;
        }
      }
    }
    if (!item) {
      dropped++;
      return;
    }
    // A tiny integer generator gives each contact a repeatable burst without
    // allocating random vectors in the physics or rendering path.
    let seed = (Math.imul(++serial, 1664525) + 1013904223) >>> 0;
    const next = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    const across = next() * 2 - 1;
    const lift = next();
    const along = next() * 2 - 1;
    const energy = Math.max(0, Math.min(1, (strength - 5) / 45));
    item.active = true;
    item.grind = grind;
    item.age = 0;
    item.life =
      kind === 0
        ? grind
          ? 0.2 + next() * 0.2
          : 0.48 + next() * 0.35
        : kind === 1
          ? 0.8 + next() * 1.1
          : 0.7 + next() * 0.65;
    item.groundY = groundY + (kind === 1 ? 0.03 : 0.01);
    item.position.set(x + across * 0.12, y + lift * 0.1, z + along * 0.12);
    const speed = grind ? 3 : kind === 0 ? 4 + energy * 5 : 3 + energy * 3;
    item.velocity.set(
      vx * 0.14 + nx * speed + across * speed,
      vy * 0.14 + ny * speed + 2.5 + lift * speed,
      vz * 0.14 + nz * speed + along * speed,
    );
    item.angle.set(next() * Math.PI, next() * Math.PI, next() * Math.PI);
    item.spin.set(
      (next() - 0.5) * 14,
      (next() - 0.5) * 14,
      (next() - 0.5) * 14,
    );
    const width = grind
      ? 0.035
      : kind === 0
        ? 0.07 + energy * 0.07
        : kind === 1
          ? 0.14 + energy * 0.16
          : 0.16 + energy * 0.16;
    item.size.set(
      width,
      width * (kind === 1 ? 0.45 : grind ? 0.3 : 0.18),
      grind ? 0.22 : kind === 0 ? 0.6 + energy * 0.6 : width * 2.4,
    );
    item.paint = kind === 1 ? 0x65717b : 0xffffff;
  }

  function advance(dt: number): void {
    seconds += dt;
    for (let index = 0; index < queued; index++) {
      const event = events[index]!;
      const hard = event.closing >= 9;
      const sparks = hard ? Math.min(16, 6 + Math.floor(event.closing / 6)) : 3;
      const metal = hard ? Math.min(8, 2 + Math.floor(event.closing / 12)) : 0;
      for (let part = 0; part < sparks; part++)
        emit(
          0,
          event.x,
          event.y,
          event.z,
          event.groundY,
          event.nx,
          event.ny,
          event.nz,
          event.vx,
          event.vy,
          event.vz,
          event.closing,
        );
      for (let part = 0; part < metal; part++)
        emit(
          1,
          event.x,
          event.y,
          event.z,
          event.groundY,
          event.nx,
          event.ny,
          event.nz,
          event.vx,
          event.vy,
          event.vz,
          event.closing,
        );
      if (event.glass)
        for (let part = 0; part < 8; part++)
          emit(
            2,
            event.x,
            event.y,
            event.z,
            event.groundY,
            event.nx,
            event.ny,
            event.nz,
            event.vx,
            event.vy,
            event.vz,
            event.closing,
          );
      burstCount++;
    }
    queued = 0;
    for (const pair of grinds)
      if (
        seconds - pair.lastAt <= GRIND_GAP &&
        seconds - pair.firstAt >= GRIND_GAP &&
        seconds >= pair.nextAt
      ) {
        emit(
          0,
          pair.x,
          pair.y,
          pair.z,
          pair.groundY,
          pair.nx,
          pair.ny,
          pair.nz,
          pair.vx,
          pair.vy,
          pair.vz,
          pair.tangent,
          true,
        );
        emit(
          0,
          pair.x,
          pair.y,
          pair.z,
          pair.groundY,
          pair.nx,
          pair.ny,
          pair.nz,
          pair.vx,
          pair.vy,
          pair.vz,
          pair.tangent,
          true,
        );
        pair.nextAt = seconds + 0.07;
        grindCount++;
      }
    for (let kind = 0; kind < pools.length; kind++)
      for (const item of pools[kind]!.particles) {
        if (!item.active) continue;
        item.age += dt;
        if (item.age >= item.life) {
          item.active = false;
          continue;
        }
        item.velocity.y -= (kind === 0 ? 9 : 18) * dt;
        item.position.addScaledVector(item.velocity, dt);
        if (kind !== 0 && item.position.y < item.groundY) {
          item.position.y = item.groundY;
          item.velocity.y = Math.max(0, -item.velocity.y * 0.18);
          item.velocity.x *= 0.72;
          item.velocity.z *= 0.72;
        }
        item.angle.addScaledVector(item.spin, dt);
      }
  }

  function render(): void {
    for (let kind = 0; kind < pools.length; kind++) {
      const pool = pools[kind]!;
      let visible = 0;
      for (const item of pool.particles) {
        if (!item.active) continue;
        helper.position.copy(item.position);
        helper.rotation.set(item.angle.x, item.angle.y, item.angle.z);
        helper.scale
          .copy(item.size)
          .multiplyScalar(Math.min(1, (item.life - item.age) / 0.15));
        helper.updateMatrix();
        pool.mesh.setMatrixAt(visible, helper.matrix);
        if (kind === 1) {
          tint.setHex(item.paint);
          pool.mesh.setColorAt(visible, tint);
        }
        visible++;
      }
      pool.mesh.count = visible;
      if (visible) {
        pool.mesh.instanceMatrix.needsUpdate = true;
        if (pool.mesh.instanceColor) pool.mesh.instanceColor.needsUpdate = true;
      }
    }
  }

  return {
    noteContact,
    advance,
    render,
    get activeSparks() {
      return pools[0].particles.filter((item) => item.active).length;
    },
    get activeImpactSparks() {
      return pools[0].particles.filter((item) => item.active && !item.grind)
        .length;
    },
    get activeGrindSparks() {
      return pools[0].particles.filter((item) => item.active && item.grind)
        .length;
    },
    get activeMetal() {
      return pools[1].particles.filter((item) => item.active).length;
    },
    get activeGlass() {
      return pools[2].particles.filter((item) => item.active).length;
    },
    get burstCount() {
      return burstCount;
    },
    get grindCount() {
      return grindCount;
    },
    get dropped() {
      return dropped;
    },
    reset() {
      for (const pool of pools) {
        for (const item of pool.particles) item.active = false;
        pool.mesh.count = 0;
      }
      queued = 0;
      pairA.fill(-1);
      pairB.fill(-1);
      pairAt.fill(-Infinity);
      for (const pair of grinds) {
        pair.a = pair.b = -1;
        pair.lastAt = -Infinity;
      }
      seconds = 0;
      serial = 0;
      dropped = burstCount = grindCount = 0;
    },
    dispose() {
      for (const pool of pools) scene.remove(pool.mesh);
      geometry.dispose();
      sparkMaterial.dispose();
      metalMaterial.dispose();
      glassMaterial.dispose();
    },
  };
}
