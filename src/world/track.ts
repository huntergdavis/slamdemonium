import {
  BoxGeometry,
  CircleGeometry,
  Color,
  DirectionalLight,
  FogExp2,
  Group,
  HemisphereLight,
  InstancedMesh,
  Mesh,
  Object3D,
  PlaneGeometry,
  RingGeometry,
} from 'three';
import type { BufferGeometry, Material, Scene } from 'three';
import type { AsphaltOptions } from '../../assets/procedural/asphalt';
import { createTrackMaterials, WORLD_COLORS } from './materials';
import { resolveTrackConfig } from './trackConfig';
import type { TrackConfig } from './trackConfig';
import { createTrackLayout } from './trackLayout';
import type { TrackInstance } from './trackLayout';
import { createGroundDescriptor } from './trackPhysics';
import type { WorldPoint, InstalledTrackBodies } from './trackPhysics';
import { createKerbFootprintQuery } from './kerbFootprint';
import { createTrackSurfaceResolver } from './trackSurfaces';
import type { SurfaceRegistry } from './surfaceRegistry';
import type { SurfaceResolver } from '../content/surfaces';
import { getSurfaceDefinition, SURFACE_IDS } from '../content/surfaces';
export { DEFAULT_TRACK_CONFIG, resolveTrackConfig } from './trackConfig';
export { installTrackColliders } from './trackPhysics';

export interface TrackOptions {
  /** Pass renderer.capabilities.getMaxAnisotropy(), not a guessed hardware limit. */
  maxAnisotropy: number;
  config?: Partial<TrackConfig>;
  asphalt?: AsphaltOptions;
}
export interface TrackSpawn {
  position: Readonly<WorldPoint>;
  rotation: Readonly<{ x: number; y: number; z: number; w: number }>;
}

/** Creates visuals only. WP1 integration installs colliders via the exported seam. */
export function createTestTrack(scene: Scene, options: TrackOptions) {
  const config = resolveTrackConfig(options.config);
  const layout = createTrackLayout(config);
  const kerbFootprint = createKerbFootprintQuery(layout.curbs);
  const materials = createTrackMaterials(
    config,
    options.maxAnisotropy,
    options.asphalt,
  );
  const root = new Group();
  root.name = 'test-track';
  const geometries = new Set<BufferGeometry>();
  const batches: InstancedMesh[] = [];
  function mesh(
    name: string,
    geometry: BufferGeometry,
    material: Material,
    y: number,
  ): Mesh {
    geometries.add(geometry);
    const object = new Mesh(geometry, material);
    object.name = name;
    object.position.y = y;
    object.receiveShadow = true;
    root.add(object);
    return object;
  }
  function batch(
    name: string,
    geometry: BufferGeometry,
    material: Material,
    instances: readonly TrackInstance[],
    shadows: boolean,
  ): InstancedMesh {
    geometries.add(geometry);
    const object = new InstancedMesh(geometry, material, instances.length);
    object.name = name;
    const transform = new Object3D();
    const color = new Color();
    instances.forEach((instance, index) => {
      transform.position.set(
        instance.center.x,
        instance.center.y,
        instance.center.z,
      );
      transform.rotation.set(0, instance.rotY, 0);
      transform.scale.set(instance.size.x, instance.size.y, instance.size.z);
      transform.updateMatrix();
      object.setMatrixAt(index, transform.matrix);
      if (instance.color !== undefined)
        object.setColorAt(index, color.setHex(instance.color));
    });
    object.instanceMatrix.needsUpdate = true;
    if (object.instanceColor) object.instanceColor.needsUpdate = true;
    object.computeBoundingSphere();
    object.castShadow = shadows;
    object.receiveShadow = shadows;
    batches.push(object);
    root.add(object);
    return object;
  }
  const horizontalQuad = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const unitBox = new BoxGeometry(1, 1, 1);
  mesh(
    'track.surroundings',
    new RingGeometry(
      config.pavedRadius,
      config.groundExtent,
      config.circleSegments,
    ).rotateX(-Math.PI / 2),
    materials.ground,
    0,
  );
  // A single disc includes both ring and infield, so their UVs cannot diverge.
  mesh(
    'track.pavement',
    new CircleGeometry(config.pavedRadius, config.circleSegments).rotateX(
      -Math.PI / 2,
    ),
    materials.forSurface(getSurfaceDefinition(config.surfaceId).id),
    0,
  );
  for (const radius of [config.ringInnerRadius, config.pavedRadius]) {
    mesh(
      'track.edge.' + radius,
      new RingGeometry(
        radius - config.edgeWidth / 2,
        radius + config.edgeWidth / 2,
        config.circleSegments,
      ).rotateX(-Math.PI / 2),
      materials.paint,
      config.paintHeight,
    );
  }
  for (const radius of config.skidpadRadii) {
    mesh(
      'track.skidpad.' + radius,
      new RingGeometry(
        radius - config.skidpadWidth / 2,
        radius + config.skidpadWidth / 2,
        config.circleSegments,
      ).rotateX(-Math.PI / 2),
      materials.skidpad,
      config.paintHeight,
    );
  }
  batch('track.dashes', horizontalQuad, materials.paint, layout.dashes, false);
  batch('track.ticks', horizontalQuad, materials.paint, layout.ticks, false);
  batch(
    'track.curbs',
    unitBox,
    materials.forSurface(SURFACE_IDS.kerb),
    layout.curbs,
    true,
  );
  batch('track.posts', unitBox, materials.post, layout.posts, true);
  batch(
    'track.barriers',
    unitBox,
    materials.forSurface(SURFACE_IDS.concrete),
    layout.barriers,
    true,
  );

  const previousFog = scene.fog,
    previousBackground = scene.background;
  const fog = new FogExp2(WORLD_COLORS.fog, config.fogDensity);
  const background = new Color(WORLD_COLORS.fog);
  scene.fog = fog;
  scene.background = background;
  const ambient = new HemisphereLight(0xe5f1f5, 0x73716a, 1.2);
  ambient.name = 'track.hemisphere';
  const sun = new DirectionalLight(0xfff1da, 2.2);
  sun.name = 'track.sun';
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -35;
  sun.shadow.camera.right = sun.shadow.camera.top = 35;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 200;
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 0.02;
  sun.shadow.camera.updateProjectionMatrix();
  root.add(ambient, sun, sun.target);
  scene.add(root);
  const spawn: Readonly<TrackSpawn> = Object.freeze({
    position: Object.freeze({
      x: config.centerLineRadius,
      y: config.spawnHeight,
      z: 0,
    }),
    rotation: Object.freeze({ x: 0, y: 0, z: 0, w: 1 }),
  });
  let disposed = false;
  const surfaceResolvers = new Set<SurfaceResolver>();
  /** Bind only bodies installed from this track/config in the current physics world. */
  function createSurfaceResolver(
    bodies: InstalledTrackBodies,
    registry?: SurfaceRegistry,
  ): SurfaceResolver {
    if (disposed)
      throw new Error('Cannot create a surface resolver for a disposed track');
    if (bodies.barriers.length !== config.barrierSegments)
      throw new RangeError(
        'Surface registry must include every installed track barrier',
      );
    const resolver = createTrackSurfaceResolver({
      bodies,
      groundSurfaceId: config.surfaceId,
      ground: createGroundDescriptor(config),
      kerbFootprint,
      ...(registry ? { registry } : {}),
    });
    surfaceResolvers.add(resolver);
    return resolver;
  }
  /** World X/Z metres; visual footprint only, independent of contact/grip. */
  function isOnKerb(x: number, z: number): boolean {
    return !disposed && kerbFootprint(x, z);
  }
  /** Allocation-free; follow the interpolated car position once per render. */
  function updateLighting(position: Readonly<WorldPoint>): void {
    if (disposed) return;
    sun.position.set(position.x + 60, position.y + 100, position.z + 40);
    sun.target.position.set(position.x, position.y, position.z);
  }
  /** Call after a physics step. Callback must respawn with zero velocities. */
  function checkKillPlane(
    position: Readonly<WorldPoint>,
    respawn: (pose: Readonly<TrackSpawn>) => void,
  ): boolean {
    if (disposed || position.y >= config.killY || Number.isNaN(position.y))
      return false;
    respawn(spawn);
    return true;
  }
  updateLighting(spawn.position);
  return {
    root,
    config,
    spawn,
    isOnKerb,
    createSurfaceResolver,
    barrierBoxes: layout.barrierBoxes,
    materials,
    updateLighting,
    checkKillPlane,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const resolver of surfaceResolvers) resolver.dispose();
      surfaceResolvers.clear();
      root.removeFromParent();
      for (const object of batches) object.dispose();
      for (const geometry of geometries) geometry.dispose();
      materials.dispose();
      sun.shadow.dispose();
      root.clear();
      if (scene.fog === fog) scene.fog = previousFog;
      if (scene.background === background)
        scene.background = previousBackground;
    },
  };
}
