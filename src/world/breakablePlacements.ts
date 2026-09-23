import type { BreakablePlacement } from './breakableProps';

const IDENTITY_ROTATION = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });
const BANK_OFFSETS = [-1.875, -0.625, 0.625, 1.875] as const;

/**
 * Four eight-prop banks on the infield ahead of the spawn. Each bank is a
 * staggered four-by-two row; the diagonal centers keep every outer footprint
 * inside the 110 m inner paint boundary while the ring racing line stays at
 * 130 m. This is authored data so moving a bank is a data-only change.
 */
const BANK_CENTERS = [
  { x: 98, z: -20 },
  { x: 90, z: -42 },
  { x: 77, z: -62 },
  { x: 60, z: -78 },
] as const;

function createBank(
  center: (typeof BANK_CENTERS)[number],
): readonly BreakablePlacement[] {
  const placements: BreakablePlacement[] = [];
  for (const zOffset of [-1.25, 1.25]) {
    for (const xOffset of BANK_OFFSETS) {
      placements.push({
        position: Object.freeze({
          x: center.x + xOffset,
          y: 0.5,
          z: center.z + zOffset,
        }),
        rotation: IDENTITY_ROTATION,
      });
    }
  }
  return placements;
}

/** Four banks of eight consume the complete 32-prop authored pool. */
export const BREAKABLE_PROP_PLACEMENTS: readonly BreakablePlacement[] =
  Object.freeze(BANK_CENTERS.flatMap(createBank));
