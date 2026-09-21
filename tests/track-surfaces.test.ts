import { describe, expect, it, vi } from 'vitest';
import { Scene } from 'three';
import type { SurfaceHit } from '../src/content/surfaces';
import { getSurfaceDefinition } from '../src/content/surfaces';
import {
  createTestTrack,
  installTrackColliders,
  resolveTrackConfig,
} from '../src/world/track';
import { createTrackLayout } from '../src/world/trackLayout';
import { createGroundDescriptor } from '../src/world/trackPhysics';
import type { TrackPhysicsPort } from '../src/world/trackPhysics';
import { createKerbFootprintQuery } from '../src/world/kerbFootprint';
import {
  createTrackSurfaceResolver,
  GROUND_HIT_EPSILON,
} from '../src/world/trackSurfaces';

const config = resolveTrackConfig();
const layout = createTrackLayout(config);
const bodies = { ground: 0, barriers: [5, 6] };
function hit(x = 130, z = 0, bodyId = 0) {
  return {
    distance: 0.5,
    bodyId,
    surfaceId: 999,
    point: { x, y: 0, z },
    normal: { x: 0, y: 1, z: 0 },
  };
}
function makeResolver(kerb = createKerbFootprintQuery(layout.curbs)) {
  return createTrackSurfaceResolver({
    bodies,
    groundSurfaceId: 0,
    ground: createGroundDescriptor(config),
    kerbFootprint: kerb,
  });
}

describe('registered world surface resolution', () => {
  it('resolves impact materials from the same registry with independent context diagnostics', () => {
    const resolve = makeResolver();
    expect(resolve.diagnostics.lastContactStatus).toBeNull();
    expect(resolve(true, hit())).toBe(0);
    expect(resolve.resolveContactSurface(5)).toBe(getSurfaceDefinition(2));
    expect(resolve.diagnostics.lastContactStatus).toBe('resolved');
    expect(resolve.resolveContactSurface(0)).toBeNull();
    expect(resolve.diagnostics.lastContactStatus).toBe('not-contact');
    expect(resolve.diagnostics.unknownBodySeen).toBe(false);
    expect(resolve.resolveContactSurface(987)).toBeNull();
    expect(resolve.diagnostics.lastContactStatus).toBe('unknown-body');
    expect(resolve.diagnostics.lastStatus).toBe('resolved');
    expect(resolve(true, hit(0, 0, 999))).toBeNull();
    expect(resolve.diagnostics.firstUnknownBodyId).toBe(987);
    expect(resolve.resolveContactSurface(NaN)).toBeNull();
    expect(resolve.diagnostics.lastContactStatus).toBe('invalid-hit');
    expect(resolve.diagnostics.lastStatus).toBe('unknown-body');
    resolve.dispose();
    expect(resolve.diagnostics.lastStatus).toBe('disposed');
    expect(resolve.diagnostics.lastContactStatus).toBe('disposed');
    expect(resolve.resolveContactSurface(5)).toBeNull();
    expect(resolve.diagnostics.lastContactStatus).toBe('disposed');
  });
  it('uses authored kerb geometry for both colours/seams, keeps paint on its substrate, and leaves RayHit raw', () => {
    const resolve = makeResolver();
    const ray = hit();
    expect(resolve(true, ray)).toBe(0);
    for (const box of layout.curbs) {
      ray.point.x = box.center.x;
      ray.point.z = box.center.z;
      expect(resolve(true, ray)).toBe(1);
      expect(ray.surfaceId).toBe(999);
    }
    for (const mark of [...layout.dashes, ...layout.ticks])
      expect(resolve(true, hit(mark.center.x, mark.center.z))).toBe(0);
    for (const radius of [15, 30, config.ringInnerRadius, config.pavedRadius])
      expect(resolve(true, hit(radius, 0))).toBe(0);
  });

  it('never projects a barrier or unknown body onto a kerb, regardless of forged raw surface IDs', () => {
    const query = vi.fn(() => true);
    const resolve = makeResolver(query);
    const box = layout.curbs[0]!;
    const ray = hit(box.center.x, box.center.z, 5);
    expect(resolve(true, ray)).toBe(2);
    ray.surfaceId = NaN;
    expect(resolve(true, ray)).toBe(2);
    ray.bodyId = 123;
    expect(resolve(true, ray)).toBeNull();
    expect(query).not.toHaveBeenCalled();
    expect(resolve.diagnostics).toMatchObject({
      lastStatus: 'unknown-body',
      unknownBodySeen: true,
      firstUnknownBodyId: 123,
    });
    ray.bodyId = 456;
    expect(resolve(true, ray)).toBeNull();
    expect(resolve.diagnostics.firstUnknownBodyId).toBe(123);
    expect(resolve(true, hit())).toBe(1);
    expect(resolve.diagnostics.lastStatus).toBe('resolved');
    expect(resolve.diagnostics.unknownBodySeen).toBe(true);
  });

  it('does not read airborne/disposed borrowed hits, and rebuilds diagnostics rather than reusing stale flags', () => {
    const resolve = makeResolver();
    const poison = new Proxy({} as SurfaceHit, {
      get() {
        throw new Error('stale ray read');
      },
    });
    expect(resolve(false, poison)).toBeNull();
    expect(resolve.diagnostics.lastStatus).toBe('airborne');
    resolve(true, hit(0, 0, 999));
    const record = resolve.diagnostics;
    resolve.dispose();
    expect(record.lastStatus).toBe('disposed');
    expect(resolve(true, poison)).toBeNull();
    expect(resolve(false, poison)).toBeNull();
    expect(record.lastStatus).toBe('disposed');
    const rebuilt = makeResolver();
    expect(rebuilt.diagnostics).not.toBe(record);
    expect(rebuilt.diagnostics.unknownBodySeen).toBe(false);
    expect(rebuilt.diagnostics.firstUnknownBodyId).toBeNull();
  });

  it('validates finite ray data and actual ground bounds without throwing in the query path', () => {
    const resolve = makeResolver(() => true);
    for (const value of [NaN, Infinity, -Infinity]) {
      const ray = hit();
      ray.point.x = value;
      expect(resolve(true, ray)).toBeNull();
      expect(resolve.diagnostics.lastStatus).toBe('invalid-hit');
    }
    for (const mutate of [
      (ray: ReturnType<typeof hit>) => {
        ray.distance = -1;
      },
      (ray: ReturnType<typeof hit>) => {
        ray.normal.y = 0;
      },
      (ray: ReturnType<typeof hit>) => {
        ray.bodyId = 0.1;
      },
      (ray: ReturnType<typeof hit>) => {
        ray.point.z = 1000;
      },
      (ray: ReturnType<typeof hit>) => {
        ray.point.y = GROUND_HIT_EPSILON * 2;
      },
    ]) {
      const ray = hit();
      mutate(ray);
      expect(resolve(true, ray)).toBeNull();
    }
    expect(resolve.diagnostics.invalidHitSeen).toBe(true);
    const ray = hit();
    ray.point.y = GROUND_HIT_EPSILON / 2;
    expect(resolve(true, ray)).toBe(1);
    ray.point.y = -config.groundThickness;
    ray.normal.y = -1;
    expect(resolve(true, ray)).toBe(0);
    ray.point.y = -0.5;
    ray.normal.y = 0;
    ray.normal.x = 1;
    expect(resolve(true, ray)).toBe(0);
  });

  it('rejects invalid authored IDs and geometry at setup and snapshots registrations', () => {
    const options = {
      bodies: { ground: 0, barriers: [5, 6] },
      groundSurfaceId: 0,
      ground: createGroundDescriptor(config),
      kerbFootprint: () => false,
    };
    for (const bad of [-1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
      expect(() =>
        createTrackSurfaceResolver({
          ...options,
          bodies: { ground: bad, barriers: [] },
        }),
      ).toThrow(RangeError);
    for (const barriers of [[0], [5, 5], [NaN]])
      expect(() =>
        createTrackSurfaceResolver({
          ...options,
          bodies: { ground: 0, barriers },
        }),
      ).toThrow(RangeError);
    for (const groundSurfaceId of [2, 99, NaN])
      expect(() =>
        createTrackSurfaceResolver({ ...options, groundSurfaceId }),
      ).toThrow(RangeError);
    expect(() =>
      createTrackSurfaceResolver({
        ...options,
        ground: { ...options.ground, rotY: 1 },
      }),
    ).toThrow(RangeError);
    const resolve = createTrackSurfaceResolver(options);
    options.bodies.ground = 55;
    options.bodies.barriers[0] = 88;
    options.ground.halfExtents.x = 1;
    expect(resolve(true, hit())).toBe(0);
    expect(resolve(true, hit(0, 0, 5))).toBe(2);
    expect(resolve(true, hit(0, 0, 88))).toBeNull();
  });

  it('installs material IDs and immediately disposes every issued track resolver', () => {
    const track = createTestTrack(new Scene(), {
      maxAnisotropy: 1,
      asphalt: { size: 128 },
    });
    let nextId = 0;
    const createStaticBox = vi.fn<TrackPhysicsPort['createStaticBox']>(
      () => nextId++,
    );
    const installed = installTrackColliders(
      { createStaticBox },
      track.config,
      track.barrierBoxes,
    );
    expect(createStaticBox).toHaveBeenCalledTimes(129);
    expect(createStaticBox.mock.calls[0]?.[5]).toBe(0);
    for (const call of createStaticBox.mock.calls.slice(1))
      expect(call[5]).toBe(2);
    const a = track.createSurfaceResolver(installed),
      b = track.createSurfaceResolver(installed);
    a(true, hit(0, 0, 999));
    track.dispose();
    expect(a.diagnostics.lastStatus).toBe('disposed');
    expect(b.diagnostics.lastStatus).toBe('disposed');
    expect(() => track.createSurfaceResolver(installed)).toThrow(/disposed/);
  });
});
