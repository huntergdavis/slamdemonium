import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
} from 'three';
import type { Scene } from 'three';

/** An accelerator triangle painted on the ground. Driving over it gives a
 * speed kick along its heading and charges boost; with drift charge made
 * much slower, pads are the main way to earn boost, so routing through one
 * is a line choice. `x`/`z` is the base centre of the triangle, `heading`
 * the ramp convention (0 = -Z, positive turns left), the apex `length`
 * metres along the heading, the base `width` across. Paint and data only:
 * no physics body, the infield asphalt is the collider. */
export interface BoostPadSpec {
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  readonly length: number;
  readonly width: number;
}

export const BOOST_PAD_COLOR = 0x4fe0ff;

function forward(spec: Readonly<BoostPadSpec>): { x: number; z: number } {
  return { x: -Math.sin(spec.heading), z: -Math.cos(spec.heading) };
}

/** The three ground corners: base left, base right, apex (along the heading). */
export type GroundPoint = readonly [x: number, z: number];
export function boostPadCorners(
  spec: Readonly<BoostPadSpec>,
): readonly [GroundPoint, GroundPoint, GroundPoint] {
  const f = forward(spec);
  const l = { x: f.z, z: -f.x }; // Left of the heading in the ground plane.
  const h = spec.width / 2;
  return [
    [spec.x + l.x * h, spec.z + l.z * h],
    [spec.x - l.x * h, spec.z - l.z * h],
    [spec.x + f.x * spec.length, spec.z + f.z * spec.length],
  ];
}

/** Point-in-triangle on the ground plane, edges inclusive. */
export function boostPadContains(
  spec: Readonly<BoostPadSpec>,
  x: number,
  z: number,
): boolean {
  const [a, b, c] = boostPadCorners(spec);
  const sign = (p: GroundPoint, q: GroundPoint) =>
    (x - q[0]) * (p[1] - q[1]) - (p[0] - q[0]) * (z - q[1]);
  const d1 = sign(a, b),
    d2 = sign(b, c),
    d3 = sign(c, a);
  const negative = d1 < 0 || d2 < 0 || d3 < 0;
  const positive = d1 > 0 || d2 > 0 || d3 > 0;
  return !(negative && positive);
}

export interface BoostPadTracker {
  /** Call once per physics step with the car's ground position; returns
   * how many pads were entered this step (each fires once per visit). */
  update(x: number, z: number): number;
  reset(): void;
  readonly inside: Readonly<Uint8Array>;
}

/** Edge-triggered: a pad fires the step the car enters it and re-arms when
 * the car leaves, so sitting on one or crossing it slowly cannot farm it. */
export function createBoostPadTracker(
  specs: readonly BoostPadSpec[],
): BoostPadTracker {
  const inside = new Uint8Array(specs.length);
  return {
    inside,
    update(x, z) {
      let entered = 0;
      for (let i = 0; i < specs.length; i++) {
        const now = boostPadContains(specs[i]!, x, z) ? 1 : 0;
        if (now && !inside[i]) entered++;
        inside[i] = now;
      }
      return entered;
    },
    reset() {
      inside.fill(0);
    },
  };
}

export interface BoostPadVisual {
  readonly root: Group;
  dispose(): void;
}

/** All pads as one flat mesh at paint height, self-lit so they read from
 * far down the runway. */
export function createBoostPadVisual(
  scene: Scene,
  specs: readonly BoostPadSpec[],
  paintHeight: number,
): BoostPadVisual {
  const root = new Group();
  root.name = 'boost-pads';
  const positions = new Float32Array(specs.length * 9);
  specs.forEach((spec, i) => {
    const [a, b, c] = boostPadCorners(spec);
    // Counter-clockwise seen from above so the face points up.
    positions.set(
      [
        a[0],
        paintHeight,
        a[1],
        c[0],
        paintHeight,
        c[1],
        b[0],
        paintHeight,
        b[1],
      ],
      i * 9,
    );
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  const material = new MeshBasicMaterial({
    color: BOOST_PAD_COLOR,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = 'boost-pads.paint';
  root.add(mesh);
  scene.add(root);
  return {
    root,
    dispose() {
      root.removeFromParent();
      geometry.dispose();
      material.dispose();
    },
  };
}
