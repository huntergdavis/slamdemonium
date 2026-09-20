import { describe, expect, it, vi } from 'vitest';
import {
  Color,
  InstancedMesh,
  LinearMipmapLinearFilter,
  Matrix4,
  RepeatWrapping,
  Mesh,
  RingGeometry,
  Scene,
  SRGBColorSpace,
  Vector3,
} from 'three';
import {
  createTestTrack,
  DEFAULT_TRACK_CONFIG,
  installTrackColliders,
  resolveTrackConfig,
} from '../src/world/track';
import { createTrackLayout } from '../src/world/trackLayout';
import type { TrackPhysicsPort } from '../src/world/trackPhysics';

describe('test track layout', () => {
  const config = resolveTrackConfig();
  const layout = createTrackLayout(config);
  it('paints 3 m dashes at 9 m intervals and exactly 36 ticks per edge', () => {
    expect(layout.dashes).toHaveLength(90);
    expect(layout.ticks).toHaveLength(72);
    for (let i = 0; i < layout.dashes.length; i++) {
      const dash = layout.dashes[i]!;
      expect(dash.size.z).toBe(3);
      expect(dash.rotY * 130).toBeCloseTo(i * 9 + 1.5, 10);
    }
    for (let i = 0; i < 36; i++)
      expect(layout.ticks[i]!.rotY).toBeCloseTo((i * Math.PI) / 18, 12);
  });
  it('places each post row at 12 m arc intervals and clips curb join segments', () => {
    for (const radius of [108, 151]) {
      const row = layout.posts.filter(
        (post) =>
          Math.abs(Math.hypot(post.center.x, post.center.z) - radius) < 1e-7,
      );
      expect(row).toHaveLength(Math.ceil((2 * Math.PI * radius) / 12));
      row.forEach((post, index) =>
        expect(post.rotY * radius).toBeCloseTo(index * 12, 10),
      );
      expect(row[0]!.color).not.toBe(row[1]!.color);
    }
    for (const radius of [109.6, 150.4]) {
      const row = layout.curbs.filter(
        (curb) =>
          Math.abs(Math.hypot(curb.center.x, curb.center.z) - radius) < 1e-7,
      );
      expect(row.reduce((length, curb) => length + curb.size.z, 0)).toBeCloseTo(
        2 * Math.PI * radius,
        8,
      );
      expect(row.at(-1)!.size.z).toBeGreaterThan(0);
      expect(row.every((curb) => curb.size.z <= 2)).toBe(true);
    }
  });
  it('covers every barrier joint, including the wrap, without a collision gap', () => {
    expect(layout.barrierBoxes).toHaveLength(128);
    for (let i = 0; i < 128; i++) {
      const theta = ((i + 0.5) * 2 * Math.PI) / 128;
      for (const radius of [152.1, 153, 153.9]) {
        const x = radius * Math.cos(theta),
          z = -radius * Math.sin(theta);
        const covered = layout.barrierBoxes.some((box) => {
          const dx = x - box.center.x,
            dz = z - box.center.z;
          const localX = Math.cos(box.rotY) * dx - Math.sin(box.rotY) * dz;
          const localZ = Math.sin(box.rotY) * dx + Math.cos(box.rotY) * dz;
          return (
            Math.abs(localX) <= box.halfExtents.x + 1e-8 &&
            Math.abs(localZ) <= box.halfExtents.z + 1e-8
          );
        });
        expect(covered).toBe(true);
      }
    }
  });
  it('rejects invalid radii and timing-independent geometry settings', () => {
    expect(() => resolveTrackConfig({ centerLineRadius: 160 })).toThrow(
      RangeError,
    );
    expect(() => resolveTrackConfig({ dashGap: 0 })).toThrow(RangeError);
    expect(() => resolveTrackConfig({ tickDegrees: 11 })).toThrow(RangeError);
    expect(() => resolveTrackConfig({ pavedRadius: NaN })).toThrow(RangeError);
    expect(DEFAULT_TRACK_CONFIG.pavedRadius).toBe(150);
  });
});

describe('track scene and physics seam', () => {
  it('installs one ground and 128 matching barrier boxes, never visual-only curbs/posts', () => {
    const config = resolveTrackConfig();
    const createStaticBox = vi.fn<TrackPhysicsPort['createStaticBox']>();
    createStaticBox.mockImplementation(() => createStaticBox.mock.calls.length);
    const scene = new Scene();
    const track = createTestTrack(scene, {
      maxAnisotropy: 8,
      asphalt: { size: 128 },
    });
    const surroundings = track.root.getObjectByName(
      'track.surroundings',
    ) as Mesh<RingGeometry>;
    expect(surroundings.geometry.parameters.innerRadius).toBe(
      config.pavedRadius,
    );
    expect(surroundings.geometry.parameters.outerRadius).toBe(
      config.groundExtent,
    );
    const ids = installTrackColliders(
      { createStaticBox },
      config,
      track.barrierBoxes,
    );
    expect(createStaticBox).toHaveBeenCalledTimes(129);
    expect(ids.barriers).toHaveLength(128);
    const ground = createStaticBox.mock.calls[0]!;
    expect(ground[0].y + ground[1].y).toBe(0);
    expect(ground[1].x).toBeGreaterThan(154);
    const visual = track.root.getObjectByName(
      'track.barriers',
    ) as InstancedMesh;
    const matrix = new Matrix4();
    const center = new Vector3();
    for (let i = 0; i < 128; i++) {
      const call = createStaticBox.mock.calls[i + 1]!;
      visual.getMatrixAt(i, matrix);
      center.setFromMatrixPosition(matrix);
      expect(
        center.distanceTo(new Vector3(call[0].x, call[0].y, call[0].z)),
      ).toBeLessThan(0.00002);
      expect(call[1].x).toBe(1);
      expect(call[1].y).toBe(0.5);
      expect(call[3]).toBe(0.05);
      expect(call[4]).toBe(0.25);
    }
    expect(track.materials.map.colorSpace).toBe(SRGBColorSpace);
    expect(track.materials.map.wrapS).toBe(RepeatWrapping);
    expect(track.materials.map.minFilter).toBe(LinearMipmapLinearFilter);
    expect(track.materials.map.generateMipmaps).toBe(true);
    expect(track.materials.map.anisotropy).toBe(8);
    expect(track.materials.map.repeat.x).toBe(37.5);
    expect(track.materials.asphalt.roughness).toBe(0.95);
    track.dispose();
  });
  it('respawns strictly below -50 m with the cached CCW spawn pose', () => {
    const track = createTestTrack(new Scene(), {
      maxAnisotropy: 1,
      asphalt: { size: 128 },
    });
    const respawn = vi.fn();
    expect(track.checkKillPlane({ x: 0, y: -50, z: 0 }, respawn)).toBe(false);
    expect(track.checkKillPlane({ x: 0, y: -50.01, z: 0 }, respawn)).toBe(true);
    expect(respawn).toHaveBeenCalledExactlyOnceWith(track.spawn);
    expect(track.spawn.position).toEqual({ x: 130, y: 0.86, z: 0 });
    expect(track.spawn.rotation).toEqual({ x: 0, y: 0, z: 0, w: 1 });
    track.dispose();
  });
  it('follows the car with the light and disposes resources once, restoring scene state', () => {
    const scene = new Scene();
    const previous = new Color(0x123456);
    scene.background = previous;
    const track = createTestTrack(scene, {
      maxAnisotropy: 1,
      asphalt: { size: 128 },
    });
    track.updateLighting({ x: 10, y: 2, z: -30 });
    expect(track.root.getObjectByName('track.sun')!.position.toArray()).toEqual(
      [70, 102, 10],
    );
    const disposed = vi.fn();
    track.materials.map.addEventListener('dispose', disposed);
    track.dispose();
    track.dispose();
    expect(disposed).toHaveBeenCalledOnce();
    expect(scene.children).toHaveLength(0);
    expect(scene.background).toBe(previous);
    expect(scene.fog).toBeNull();
  });
});
