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

/** Four banks of eight occupy the original infield smash route. */
const GATE_SLAT_OFFSETS = [-2.5, -1.5, -0.5, 0.5, 1.5, 2.5] as const;

function createGate(
  center: Readonly<{ x: number; z: number }>,
  forward: Readonly<{ x: number; z: number }>,
): readonly BreakablePlacement[] {
  // Left = up x forward. Six one-metre slats cross the lane at hood height;
  // the two grounded edge pylons make the gate legible and breakable too.
  const left = { x: forward.z, z: -forward.x };
  const placements: BreakablePlacement[] = [];
  for (const offset of GATE_SLAT_OFFSETS)
    placements.push({
      position: Object.freeze({
        x: center.x + left.x * offset,
        y: 1,
        z: center.z + left.z * offset,
      }),
      rotation: IDENTITY_ROTATION,
    });
  for (const offset of [-4, 4])
    placements.push({
      position: Object.freeze({
        x: center.x + left.x * offset,
        y: 0.5,
        z: center.z + left.z * offset,
      }),
      rotation: IDENTITY_ROTATION,
    });
  return placements;
}

/** Two eight-panel smash gates follow the loop and sit on the north-east
 * infield spur. All panels are the same pooled breakable rule as the boxes. */
const GATE_PLACEMENTS = [
  ...createGate(
    { x: -77.8, z: 56.6 },
    { x: -Math.SQRT1_2, z: -Math.SQRT1_2 },
  ),
  ...createGate(
    { x: 54, z: 95 },
    { x: -0.87, z: 0.5 },
  ),
] as const;

/** Four banks (32) plus two eight-panel gates (16) fill the 48-prop pool. */
export const BREAKABLE_PROP_PLACEMENTS: readonly BreakablePlacement[] =
  Object.freeze([...BANK_CENTERS.flatMap(createBank), ...GATE_PLACEMENTS]);
