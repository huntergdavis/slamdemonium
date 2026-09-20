import { describe, expect, it } from 'vitest';
import { FogExp2, InstancedMesh, Scene } from 'three';
import { evaluateSpeedCues } from '../src/render/speedCues';
import { DEFAULT_VALUES, PARAM_BY_KEY } from '../src/tuning/schema';
import { TuningStore } from '../src/tuning/store';
import { encodeShareHash, decodeShareHash } from '../src/tuning/storage';
import { createTestTrack } from '../src/world/track';

describe('speed cue envelopes', () => {
  const levels = { speedRatio: 0, lineAlpha: 0, vignetteAlpha: 0 };
  const full = { speedLinesStrength: 1, vignetteStrength: 1 };
  it('starts streaks above 80%, responds to boost, and bounds both effects', () => {
    evaluateSpeedCues(
      { speed: 48, topSpeed: 60, boostEnvelope: 0 },
      full,
      levels,
    );
    expect(levels.lineAlpha).toBe(0);
    evaluateSpeedCues(
      { speed: 54, topSpeed: 60, boostEnvelope: 0 },
      full,
      levels,
    );
    expect(levels.lineAlpha).toBeCloseTo(0.15);
    evaluateSpeedCues(
      { speed: 10, topSpeed: 60, boostEnvelope: 0.5 },
      full,
      levels,
    );
    expect(levels.lineAlpha).toBe(0.15);
    evaluateSpeedCues(
      { speed: 85, topSpeed: 60, boostEnvelope: 1 },
      full,
      levels,
    );
    expect(levels.lineAlpha).toBe(0.3);
    expect(levels.vignetteAlpha).toBe(0.12);
  });
  it('disables either effect exactly at zero, independently and at full boost', () => {
    const state = { speed: 85, topSpeed: 60, boostEnvelope: 1 };
    evaluateSpeedCues(
      state,
      { speedLinesStrength: 0, vignetteStrength: 1 },
      levels,
    );
    expect(levels.lineAlpha).toBe(0);
    expect(levels.vignetteAlpha).toBe(0.12);
    evaluateSpeedCues(
      state,
      { speedLinesStrength: 1, vignetteStrength: 0 },
      levels,
    );
    expect(levels.lineAlpha).toBe(0.3);
    expect(levels.vignetteAlpha).toBe(0);
    evaluateSpeedCues(
      { speed: 0, topSpeed: 60, boostEnvelope: 0 },
      full,
      levels,
    );
    expect(levels.lineAlpha).toBe(0);
    expect(levels.vignetteAlpha).toBe(0);
  });
  it('fails closed for invalid values instead of painting NaNs', () => {
    evaluateSpeedCues(
      { speed: Infinity, topSpeed: 0, boostEnvelope: NaN },
      { speedLinesStrength: NaN, vignetteStrength: -1 },
      levels,
    );
    expect(levels).toEqual({ speedRatio: 0, lineAlpha: 0, vignetteAlpha: 0 });
  });
  it('uses the approved schema defaults and preserves both keys in store snapshots', () => {
    const store = new TuningStore();
    for (const key of ['speedLinesStrength', 'vignetteStrength'] as const) {
      expect(PARAM_BY_KEY[key]).toMatchObject({
        group: 'Camera',
        default: 0.5,
        min: 0,
        max: 1,
        step: 0.05,
      });
      expect(PARAM_BY_KEY[key].quick).not.toBe(true);
      expect(store.get(key)).toBe(0.5);
    }
    evaluateSpeedCues(
      { speed: 60, topSpeed: 60, boostEnvelope: 1 },
      DEFAULT_VALUES,
      levels,
    );
    expect(levels.lineAlpha).toBe(0.15);
    expect(levels.vignetteAlpha).toBe(0.06);
    store.set('speedLinesStrength', 0);
    store.set('vignetteStrength', 0.85);
    const decoded = decodeShareHash(encodeShareHash(store));
    expect(decoded.speedLinesStrength).toBe(0);
    expect(decoded.vignetteStrength).toBe(0.85);
  });
});

describe('existing WP3 world cues', () => {
  it('already batches both post rows once and supplies the specified exponential haze', () => {
    const scene = new Scene();
    const track = createTestTrack(scene, {
      maxAnisotropy: 4,
      asphalt: { size: 128 },
    });
    const posts = track.root.getObjectByName('track.posts') as InstancedMesh;
    expect(posts.isInstancedMesh).toBe(true);
    expect(posts.count).toBe(137);
    expect(posts.instanceColor?.count).toBe(137);
    expect(scene.fog).toBeInstanceOf(FogExp2);
    const density = (scene.fog as FogExp2).density;
    expect(density).toBe(0.0025);
    expect(Math.exp(-density * density * 100 * 100)).toBeCloseTo(0.9394, 4);
    expect(Math.exp(-density * density * 250 * 250)).toBeCloseTo(0.6766, 4);
    track.dispose();
  });
  it('accepts zero fog density and produces zero fog blend at all view depths', () => {
    const scene = new Scene();
    const track = createTestTrack(scene, {
      maxAnisotropy: 1,
      asphalt: { size: 128 },
      config: { fogDensity: 0 },
    });
    const density = (scene.fog as FogExp2).density;
    expect(density).toBe(0);
    // Same expression as Three.js fog_fragment.glsl.js; browser test also compares pixels.
    for (const depth of [0, 10, 100, 250, 1000])
      expect(1 - Math.exp(-density * density * depth * depth)).toBe(0);
    track.dispose();
  });
});
