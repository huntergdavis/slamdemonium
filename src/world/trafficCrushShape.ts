import type { V3 } from '../physics/adapter';
import { CAR_MODELS, type CarCrushState, type CarModelKind } from './carModels';

/** Four stable crush tiers keep the native shape cache finite. All changes
 * retract the outline; no new hull can overlap a neighbour or the road. */
export function trafficCrushShape(
  kind: CarModelKind,
  crush: Readonly<CarCrushState>,
): { key: string; vertices: readonly V3[]; halfExtents: V3 } | null {
  const tiers = [crush.front, crush.rear, crush.left, crush.right].map(
    (value) => Math.max(0, Math.min(4, Math.round(value * 4))),
  );
  if (tiers.every((tier) => tier === 0)) return null;
  const [front, rear, left, right] = tiers.map((tier) => tier / 4);
  const half = CAR_MODELS[kind].halfExtents;
  // The visible catalogue is rotated 180 degrees around Y to face travel.
  // Its +Z nose and +X right become the chassis's -Z and -X respectively.
  const x0 = -half.x + right! * half.x * 0.4;
  const x1 = half.x - left! * half.x * 0.4;
  const z0 = -half.z + front! * Math.min(2, half.z * 0.4);
  const z1 = half.z - rear! * Math.min(2, half.z * 0.4);
  const bottom = -half.y;
  const topFront =
    bottom + half.y * 2 * (1 - 0.55 * Math.max(front!, left!, right!));
  const topRear =
    bottom + half.y * 2 * (1 - 0.55 * Math.max(rear!, left!, right!));
  return {
    key: `${kind}:${tiers.join('')}`,
    halfExtents: half,
    vertices: [
      { x: x0, y: bottom, z: z0 },
      { x: x1, y: bottom, z: z0 },
      { x: x0, y: bottom, z: z1 },
      { x: x1, y: bottom, z: z1 },
      { x: x0, y: topFront, z: z0 },
      { x: x1, y: topFront, z: z0 },
      { x: x0, y: topRear, z: z1 },
      { x: x1, y: topRear, z: z1 },
    ],
  };
}
