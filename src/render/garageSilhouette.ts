import { VEHICLE_GEOMETRY as G } from '../vehicle/constants';
import type { GarageClassId } from '../vehicle/garageClasses';

const smooth = (value: number) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};

/** Shape the upper shell only: the sill and four wheel arches stay aligned to Jolt. */
export function garageSilhouettePoint(
  kind: GarageClassId,
  x: number,
  y: number,
  z: number,
): [number, number, number] {
  if (kind === 'sports') return [x, y, z];
  const roof = smooth((y - 0.03) / 0.37);
  const rear = smooth((z + 0.2) / 1.65);
  const nose = smooth((-z - 0.4) / 1.3);
  switch (kind) {
    case 'compact':
      // High hatch and short bonnet, especially clear from the chase camera.
      return [x, y + roof * (0.08 + 0.13 * rear), z + roof * 0.1];
    case 'muscle':
      // Long, low bonnet with the short roof set back over the rear axle.
      return [x, y - roof * 0.12, z + roof * 0.25];
    case 'coupe':
      // Forward roof peak falling away into a fastback tail.
      return [x, y - roof * (0.08 + 0.12 * rear), z - roof * 0.13];
    case 'super':
      // Low tapered greenhouse and a descending wedge toward the nose.
      return [
        x * (1 - 0.12 * roof),
        y - roof * (0.19 + 0.08 * nose),
        z - roof * 0.1,
      ];
    case 'pickup':
      // The roof ends behind the cab; the separate bed rails mark the tail.
      return [x, y - smooth((y - 0.28) / 0.2) * rear * 0.48, z];
  }
}

export function farCabinProfile(kind: GarageClassId): {
  readonly height: number;
  readonly length: number;
  readonly z: number;
} {
  switch (kind) {
    case 'compact':
      return { height: G.height * 0.55, length: G.length * 0.55, z: 0.1 };
    case 'muscle':
      return { height: G.height * 0.34, length: G.length * 0.36, z: 0.32 };
    case 'coupe':
      return { height: G.height * 0.32, length: G.length * 0.51, z: -0.1 };
    case 'sports':
      return {
        height: G.height * 0.42,
        length: G.length * 0.46,
        z: G.length * 0.035,
      };
    case 'super':
      return { height: G.height * 0.23, length: G.length * 0.48, z: -0.16 };
    case 'pickup':
      return { height: G.height * 0.43, length: G.length * 0.32, z: -0.58 };
  }
}
