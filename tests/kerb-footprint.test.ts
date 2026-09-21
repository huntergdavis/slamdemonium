import { describe, expect, it } from 'vitest';
import { Box3, Matrix4, Scene, Vector3 } from 'three';
import { createKerbFootprintQuery } from '../src/world/kerbFootprint';
import {
  createTrackLayout,
  type TrackInstance,
} from '../src/world/trackLayout';
import { createTestTrack, resolveTrackConfig } from '../src/world/track';

function transform(box: TrackInstance): Matrix4 {
  return new Matrix4()
    .makeRotationY(box.rotY)
    .setPosition(box.center.x, 0, box.center.z);
}

describe('visual kerb footprint', () => {
  for (const overrides of [
    {},
    {
      ringInnerRadius: 73,
      centerLineRadius: 93,
      pavedRadius: 111,
      barrierInnerRadius: 115,
      curbLength: 3.7,
      curbWidth: 1.1,
      curbClearance: 0.4,
    },
  ]) {
    it(
      'matches the box union, including all corners and clipped seam pieces: ' +
        JSON.stringify(overrides),
      () => {
        const config = resolveTrackConfig(overrides);
        const { curbs } = createTrackLayout(config);
        const query = createKerbFootprintQuery(curbs);
        const point = new Vector3();
        const reference = curbs.map((box) => {
          const matrix = transform(box);
          expect(query(box.center.x, box.center.z)).toBe(true);
          for (const x of [-1, 1])
            for (const z of [-1, 1]) {
              point
                .set((x * box.size.x) / 2, 0, (z * box.size.z) / 2)
                .applyMatrix4(matrix);
              expect(query(point.x, point.z)).toBe(true);
            }
          return {
            inverse: matrix.clone().invert(),
            bounds: new Box3(
              new Vector3(-box.size.x / 2, -1, -box.size.z / 2),
              new Vector3(box.size.x / 2, 1, box.size.z / 2),
            ),
          };
        });
        expect(curbs.some((box) => box.size.z < config.curbLength)).toBe(true);
        for (let i = 0; i < 480; i++) {
          const angle = i * 2.399963229728653;
          const ring = i % 2 ? config.pavedRadius : config.ringInnerRadius;
          const offset = config.curbClearance + config.curbWidth / 2;
          const radius =
            ring +
            (i % 2 ? offset : -offset) +
            (((i % 13) - 6) * config.curbWidth) / 7;
          const x = radius * Math.cos(angle),
            z = radius * Math.sin(angle);
          const expected = reference.some(({ inverse, bounds }) =>
            bounds.containsPoint(point.set(x, 0, z).applyMatrix4(inverse)),
          );
          expect(query(x, z)).toBe(expected);
        }
        expect(query(0, 0)).toBe(false);
        expect(query(config.centerLineRadius, 0)).toBe(false);
        expect(query(config.barrierInnerRadius, 0)).toBe(false);
      },
    );
  }

  it('uses inclusive oriented boxes rather than treating a partial footprint as an annulus', () => {
    const box = {
      center: { x: -5, y: 99, z: 0 },
      size: { x: 2, y: 1, z: 4 },
      rotY: 0,
    };
    const query = createKerbFootprintQuery([box]);
    expect(query(-6, 2)).toBe(true);
    expect(query(-6, -2)).toBe(true);
    expect(query(-6 - 1e-6, 2)).toBe(false);
    expect(query(0, 5)).toBe(false);
    box.center.x = 50;
    expect(query(-5, 0)).toBe(true); // Construction snapshot, like InstancedMesh.
    expect(query(50, 0)).toBe(false);
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(query(bad, 0)).toBe(false);
      expect(query(0, bad)).toBe(false);
    }
    expect(createKerbFootprintQuery([])(0, 0)).toBe(false);
  });

  it('handles a footprint crossing the origin without missing angular buckets', () => {
    const query = createKerbFootprintQuery([
      {
        center: { x: 0, y: 0, z: 0 },
        size: { x: 2, y: 1, z: 8 },
        rotY: Math.PI / 4,
      },
    ]);
    for (let i = 0; i < 256; i++) {
      const angle = (i * Math.PI) / 128;
      expect(query(0.5 * Math.cos(angle), 0.5 * Math.sin(angle))).toBe(true);
    }
    expect(query(9, 0)).toBe(false);
  });

  it('exposes the shared query on the track and returns false after disposal', () => {
    const track = createTestTrack(new Scene(), {
      maxAnisotropy: 1,
      asphalt: { size: 128 },
    });
    const box = createTrackLayout(track.config).curbs[0]!;
    expect(track.isOnKerb(box.center.x, box.center.z)).toBe(true);
    track.dispose();
    expect(track.isOnKerb(box.center.x, box.center.z)).toBe(false);
  });
});
