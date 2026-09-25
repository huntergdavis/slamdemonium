import { Mesh, Scene } from 'three';
import type { BufferGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import {
  BOOST_PAD_COLOR,
  boostPadContains,
  boostPadCorners,
  createBoostPadTracker,
  createBoostPadVisual,
  type BoostPadSpec,
} from '../src/world/boostPads';
import { PROVING_GROUND_MAP } from '../src/world/maps';
import { runwayLaneClearance } from '../src/world/runways';

const pad: BoostPadSpec = {
  x: 0,
  z: -100,
  heading: Math.PI,
  length: 12,
  width: 6,
};

describe('accelerator triangles', () => {
  it('is a triangle with its base across the heading and its apex a length along it', () => {
    const [left, right, apex] = boostPadCorners(pad);
    expect(left).toEqual([3, -100]); // Left of +Z travel is +X.
    expect(right).toEqual([-3, -100]);
    expect(apex[0]).toBeCloseTo(0, 9);
    expect(apex[1]).toBeCloseTo(-88, 9);
    expect(boostPadContains(pad, 0, -95)).toBe(true);
    expect(boostPadContains(pad, 2.9, -100)).toBe(true); // On the base.
    expect(boostPadContains(pad, 0, -101)).toBe(false); // Behind the base.
    expect(boostPadContains(pad, 2, -90)).toBe(false); // Beside the apex.
    expect(boostPadContains(pad, 0, -87)).toBe(false); // Past the apex.
  });

  it('fires once on entry, not while sitting on the pad, and re-arms after leaving', () => {
    const tracker = createBoostPadTracker([pad, { ...pad, z: -50 }]);
    expect(tracker.update(0, -120)).toBe(0);
    expect(tracker.update(0, -98)).toBe(1); // Entered the first.
    expect(tracker.update(0, -95)).toBe(0); // Still on it.
    expect(tracker.update(0, -93)).toBe(0);
    expect(tracker.update(0, -80)).toBe(0); // Left it.
    expect(tracker.update(0, -48)).toBe(1); // Entered the second.
    expect(tracker.update(0, -98)).toBe(1); // Back onto the first: re-armed.
    tracker.reset();
    expect(tracker.inside[0]).toBe(0);
    expect(tracker.update(0, -95)).toBe(1); // A respawn re-arms everything.
  });

  it('draws every pad as one self-lit mesh at paint height', () => {
    const scene = new Scene();
    const visual = createBoostPadVisual(scene, [pad, { ...pad, x: 20 }], 0.005);
    const mesh = scene.getObjectByName('boost-pads.paint') as Mesh;
    const geometry = mesh.geometry as BufferGeometry;
    expect(geometry.getAttribute('position').count).toBe(6);
    expect(geometry.getAttribute('position').getY(0)).toBeCloseTo(0.005, 9);
    expect(
      (
        mesh.material as unknown as { color: { getHex(): number } }
      ).color.getHex(),
    ).toBe(BOOST_PAD_COLOR);
    visual.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it('places the proving ground pads beside the runway centrelines, not on them, so each is a line choice', () => {
    const pads = PROVING_GROUND_MAP.boostPads;
    expect(pads.length).toBeGreaterThanOrEqual(3);
    for (const p of pads) {
      // Inside a painted lane, but off its centreline by more than half a lane.
      const lane = PROVING_GROUND_MAP.runways.find(
        (r) => runwayLaneClearance(r, p.x, p.z) < 4,
      );
      expect(lane, `pad at (${p.x}, ${p.z}) sits by a lane`).toBeDefined();
      // In the outer half of its lane: a deliberate lane change, not the default line.
      expect(Math.abs(p.x - lane!.x)).toBeGreaterThanOrEqual(lane!.width / 4);
      expect(p.heading).toBe(lane!.heading);
    }
  });
});
