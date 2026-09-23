import type { BreakablePlacement } from './breakableProps';

const IDENTITY_ROTATION = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });
const BANK_OFFSETS = [-1.875, -0.625, 0.625, 1.875] as const;

/**
 * Four eight-prop banks occupy separated shoulders of the proving ground.
 * Each bank is a staggered four-by-two row. They stay outside the painted
 * runway lanes and are far enough apart that a car cannot pull two banks into
 * one contact island at once. This is authored data so moving a bank is a
 * data-only change.
 */
const BANK_CENTERS = [
  { x: -70, z: -260 },
  { x: 70, z: -260 },
  { x: -70, z: 180 },
  { x: 70, z: 180 },
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

/** Four banks of eight occupy separated proving-ground shoulders. */
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

/** Two eight-panel smash gates sit on runway-side smash alleys. Their nearest
 * panels remain at least five metres outside each 16 m runway lane. */
const GATE_PLACEMENTS = [
  ...createGate({ x: 26, z: 140 }, { x: 0, z: 1 }),
  ...createGate({ x: 140, z: 24 }, { x: 1, z: 0 }),
] as const;

/** Four banks (32) plus two eight-panel gates (16) fill the 48-prop pool. */
export const BREAKABLE_PROP_PLACEMENTS: readonly BreakablePlacement[] =
  Object.freeze([...BANK_CENTERS.flatMap(createBank), ...GATE_PLACEMENTS]);
