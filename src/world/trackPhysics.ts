import type { TrackConfig } from './trackConfig';

export interface WorldPoint {
  x: number;
  y: number;
  z: number;
}
export interface StaticBoxDescriptor {
  center: WorldPoint;
  halfExtents: WorldPoint;
  rotY: number;
}
/** Structural subset of WP1 IPhysicsWorld, confirmed with its owner.
 * Replace proof-scene ground/wall setup with installTrackColliders(world, config).
 * No engine imports; IPhysicsWorld is assignable to this port once WP1 lands.
 */
export interface TrackPhysicsPort {
  createStaticBox(
    center: WorldPoint,
    halfExtents: WorldPoint,
    rotY?: number,
    friction?: number,
    restitution?: number,
    surfaceId?: number,
  ): number;
}

export function createBarrierDescriptors(
  config: Readonly<TrackConfig>,
): readonly StaticBoxDescriptor[] {
  const radius = config.barrierInnerRadius + config.barrierThickness / 2;
  // Outer corners meet; inner corners overlap. Chord-length boxes would leave gaps.
  const halfLength =
    (config.barrierInnerRadius + config.barrierThickness) *
    Math.tan(Math.PI / config.barrierSegments);
  return Array.from({ length: config.barrierSegments }, (_, index) => {
    const theta = (index * Math.PI * 2) / config.barrierSegments;
    return {
      center: {
        x: radius * Math.cos(theta),
        y: config.barrierHeight / 2,
        z: -radius * Math.sin(theta),
      },
      halfExtents: {
        x: config.barrierThickness / 2,
        y: config.barrierHeight / 2,
        z: halfLength,
      },
      rotY: theta,
    };
  });
}

/** Call once per physics world. Caller owns body lifetime through its adapter. */
export function installTrackColliders(
  world: TrackPhysicsPort,
  config: Readonly<TrackConfig>,
  barriers = createBarrierDescriptors(config),
): { ground: number; barriers: number[] } {
  // Covers the paved disc and wall footprint, including polygon corners.
  const extent =
    (config.barrierInnerRadius + config.barrierThickness) /
    Math.cos(Math.PI / config.barrierSegments);
  const ground = world.createStaticBox(
    { x: 0, y: -config.groundThickness / 2, z: 0 },
    { x: extent, y: config.groundThickness / 2, z: extent },
    0,
    0.5,
    0,
    config.surfaceId,
  );
  const ids = barriers.map((box) =>
    world.createStaticBox(
      box.center,
      box.halfExtents,
      box.rotY,
      config.wallFriction,
      config.restitution,
      config.surfaceId,
    ),
  );
  return { ground, barriers: ids };
}
