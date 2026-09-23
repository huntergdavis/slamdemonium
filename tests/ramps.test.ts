import { Quaternion, Scene, Vector3 } from 'three';
import type { Material } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { SURFACE_IDS } from '../src/content/surfaces';
import type { IPhysicsWorld } from '../src/physics/adapter';
import {
  RAMP_LAYOUT,
  RAMP_THICKNESS,
  createRampVisual,
  installRamps,
  rampBodyDescriptor,
  rampFootprintRadius,
  rampForward,
  rampPitch,
  type RampSpec,
} from '../src/world/ramps';
import { createSurfaceRegistry } from '../src/world/surfaceRegistry';
import { createSurfacedBodies } from '../src/world/surfacedBodies';
import { createTrackSurfaceResolver } from '../src/world/trackSurfaces';

const spec: RampSpec = {
  x: 10,
  z: -40,
  heading: Math.PI / 6,
  length: 12,
  width: 6,
  rise: 1.6,
};

/** World position of a slab corner given local offsets in half-extents. */
function corner(s: RampSpec, right: number, up: number, forward: number) {
  const d = rampBodyDescriptor(s);
  const q = new Quaternion(
    d.rotation!.x,
    d.rotation!.y,
    d.rotation!.z,
    d.rotation!.w,
  );
  return new Vector3(
    right * d.halfExtents.x,
    up * d.halfExtents.y,
    forward * d.halfExtents.z,
  )
    .applyQuaternion(q)
    .add(new Vector3(d.center.x, d.center.y, d.center.z));
}

describe('ramp geometry', () => {
  it('puts the low edge flush with the ground, the lip at the authored rise, and the top face at the authored pitch', () => {
    // Forward for the slab is its local -Z, so the low edge is at +Z.
    const lowEdgeTop = corner(spec, 0, 1, 1);
    const lipTop = corner(spec, 0, 1, -1);
    expect(lowEdgeTop.y).toBeCloseTo(0, 6);
    expect(lipTop.y).toBeCloseTo(spec.rise, 6);
    const q = rampBodyDescriptor(spec).rotation!;
    const up = new Vector3(0, 1, 0).applyQuaternion(
      new Quaternion(q.x, q.y, q.z, q.w),
    );
    expect(Math.acos(up.y)).toBeCloseTo(rampPitch(spec), 6);
    // The low edge centre is where the spec says the ramp starts.
    const lowEdgeCentre = corner(spec, 0, 0, 1);
    expect(lowEdgeCentre.x).toBeCloseTo(spec.x, 6);
    expect(lowEdgeCentre.z).toBeCloseTo(spec.z, 6);
    // The lip lies `length` metres along the heading in the ground plane.
    const forward = rampForward(spec, { x: 0, y: 0, z: 0 });
    const lipCentre = corner(spec, 0, 0, -1);
    expect(lipCentre.x - lowEdgeCentre.x).toBeCloseTo(
      forward.x * spec.length,
      6,
    );
    expect(lipCentre.z - lowEdgeCentre.z).toBeCloseTo(
      forward.z * spec.length,
      6,
    );
    expect(RAMP_THICKNESS).toBeGreaterThan(0);
    expect(rampFootprintRadius(spec)).toBeCloseTo(Math.hypot(6, 3), 6);
  });

  it('authors every default ramp inside the barrier, aimed inward, and clear of the racing line', () => {
    for (const ramp of RAMP_LAYOUT) {
      const d = rampBodyDescriptor(ramp);
      const radius = Math.hypot(d.center.x, d.center.z);
      expect(radius).toBeLessThan(124); // Six metres inside the 130 m line.
      expect(radius).toBeGreaterThan(95); // But on the infield, not the centre.
      const forward = rampForward(ramp, { x: 0, y: 0, z: 0 });
      // Inward: launch direction points against the outward radial.
      const outward = { x: d.center.x / radius, z: d.center.z / radius };
      expect(forward.x * outward.x + forward.z * outward.z).toBeLessThan(0);
    }
  });
});

describe('ramps through the facade', () => {
  function fakeWorld() {
    let next = 500;
    return {
      createStaticBox: vi.fn(() => next++),
      createStaticBody: vi.fn(() => next++),
      destroyBody: vi.fn(),
    } as unknown as IPhysicsWorld;
  }
  const ground = {
    center: { x: 0, y: -0.5, z: 0 },
    halfExtents: { x: 200, y: 0.5, z: 200 },
    rotY: 0,
  };
  const hitOn = (bodyId: number) => ({
    distance: 0.3,
    point: { x: 10, y: 0.5, z: -45 },
    normal: { x: 0, y: Math.cos(0.13), z: Math.sin(0.13) },
    bodyId,
    surfaceId: 99,
  });

  it('gives an installed ramp asphalt grip, and shows the trap a direct adapter call would fall into', () => {
    const world = fakeWorld();
    const registry = createSurfaceRegistry();
    const groundId = world.createStaticBox(ground.center, ground.halfExtents);
    const resolve = createTrackSurfaceResolver({
      bodies: { ground: groundId, barriers: [] },
      groundSurfaceId: SURFACE_IDS.asphalt,
      ground,
      kerbFootprint: () => false,
      registry,
    });
    const bodies = createSurfacedBodies(world, registry);
    const [ramp] = installRamps(bodies, [spec]);
    expect(resolve(true, hitOn(ramp!))).toBe(SURFACE_IDS.asphalt);
    // The same descriptor straight into the adapter, bypassing the facade,
    // is exactly the body that would have suspension force and no tyre force.
    const bypass = world.createStaticBody(rampBodyDescriptor(spec));
    expect(resolve(true, hitOn(bypass))).toBeNull();
    expect(resolve.diagnostics.lastStatus).toBe('unknown-body');
  });

  it('builds one mesh per ramp from the same descriptor as the collider', () => {
    const scene = new Scene();
    const dispose = vi.fn();
    const material = { dispose } as unknown as Material;
    const visual = createRampVisual(scene, material, RAMP_LAYOUT);
    expect(visual.root.children).toHaveLength(RAMP_LAYOUT.length);
    RAMP_LAYOUT.forEach((ramp, index) => {
      const d = rampBodyDescriptor(ramp);
      const mesh = visual.root.children[index]!;
      expect(mesh.position.x).toBeCloseTo(d.center.x, 9);
      expect(mesh.position.y).toBeCloseTo(d.center.y, 9);
      expect(mesh.position.z).toBeCloseTo(d.center.z, 9);
      expect(mesh.quaternion.w).toBeCloseTo(d.rotation!.w, 9);
    });
    visual.dispose();
    expect(scene.children).toHaveLength(0);
    expect(dispose).not.toHaveBeenCalled(); // The track owns it.
  });
});
