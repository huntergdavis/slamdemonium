import { Group, PlaneGeometry } from 'three';
import type { Material, Scene } from 'three';
import type { TrackConfig } from './trackConfig';
import type { TrackInstance } from './trackLayout';
import { createInstancedBatch } from './instances';

/** A painted straight on the paved infield: edge lines, centre dashes and a
 * crossbar every `markerMeters` so a driver can read the approach. `x`/`z`
 * is the centre of the strip; `heading` follows the ramp convention
 * (radians, 0 = -Z, positive turns left). Paint and data only: the infield
 * is already one asphalt collider, so a runway adds no bodies. */
export interface RunwaySpec {
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  readonly length: number;
  readonly width: number;
  readonly markerMeters: number;
}

export const RUNWAY_CROSSBAR_WIDTH = 0.4;

export function runwayForward(spec: Readonly<RunwaySpec>): {
  x: number;
  z: number;
} {
  return { x: -Math.sin(spec.heading), z: -Math.cos(spec.heading) };
}

/** Distance from a ground point to the lane rectangle, zero inside it. */
export function runwayLaneClearance(
  spec: Readonly<RunwaySpec>,
  x: number,
  z: number,
): number {
  const f = runwayForward(spec);
  const dx = x - spec.x;
  const dz = z - spec.z;
  const along = dx * f.x + dz * f.z;
  const across = dx * f.z - dz * f.x; // Along left = (f.z, -f.x).
  const du = Math.max(Math.abs(along) - spec.length / 2, 0);
  const dv = Math.max(Math.abs(across) - spec.width / 2, 0);
  return Math.hypot(du, dv);
}

/** Placement data for the paint quads, in the track's instance format. */
export function runwayInstances(
  specs: readonly RunwaySpec[],
  config: Readonly<
    Pick<
      TrackConfig,
      'edgeWidth' | 'centerLineWidth' | 'dashLength' | 'dashGap' | 'paintHeight'
    >
  >,
): TrackInstance[] {
  const out: TrackInstance[] = [];
  for (const spec of specs) {
    const f = runwayForward(spec);
    const left = { x: f.z, z: -f.x };
    const place = (
      along: number,
      across: number,
      sizeAcross: number,
      sizeAlong: number,
    ): void => {
      out.push({
        center: {
          x: spec.x + f.x * along + left.x * across,
          y: config.paintHeight,
          z: spec.z + f.z * along + left.z * across,
        },
        size: { x: sizeAcross, y: 1, z: sizeAlong },
        rotY: spec.heading,
      });
    };
    const half = spec.length / 2;
    for (const side of [-1, 1])
      place(0, side * (spec.width / 2), config.edgeWidth, spec.length);
    const period = config.dashLength + config.dashGap;
    const dashes = Math.floor(spec.length / period);
    for (let i = 0; i < dashes; i++)
      place(
        -half + i * period + config.dashLength / 2,
        0,
        config.centerLineWidth,
        config.dashLength,
      );
    if (spec.markerMeters > 0) {
      const inner = spec.width - 2 * config.edgeWidth;
      for (
        let along = -half + spec.markerMeters;
        along < half - 1e-9;
        along += spec.markerMeters
      )
        place(along, 0, inner, RUNWAY_CROSSBAR_WIDTH);
    }
  }
  return out;
}

export interface RunwayVisual {
  readonly root: Group;
  dispose(): void;
}

/** All runway paint in one instanced draw, sharing the track's paint material. */
export function createRunwayVisual(
  scene: Scene,
  material: Material,
  specs: readonly RunwaySpec[],
  config: Readonly<TrackConfig>,
): RunwayVisual {
  const root = new Group();
  root.name = 'runways';
  const geometry = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const batch = createInstancedBatch(
    'runways.paint',
    geometry,
    material,
    runwayInstances(specs, config),
    false,
  );
  root.add(batch);
  scene.add(root);
  return {
    root,
    dispose() {
      root.removeFromParent();
      batch.dispose();
      geometry.dispose();
    },
  };
}
