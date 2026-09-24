import type { BreakablePlacement } from './breakableProps';

const IDENTITY_ROTATION = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });
const CELL_X_OFFSETS = [-7, -2.35, 2.35, 7] as const;
const CELL_Z_OFFSETS = [-6, 0, 6] as const;

/** Twelve 12-prop encounter cells keep contact islands local on the large map.
 * They sit in the infield shoulders, away from every runway and target corridor;
 * moving a cell is a data-only edit shared by the streamer and far visual. */
const ENCOUNTER_CELLS = [
  { x: -120, z: -280 },
  { x: 120, z: -280 },
  { x: -180, z: -180 },
  { x: 180, z: -180 },
  { x: -120, z: 180 },
  { x: 120, z: 180 },
  { x: -180, z: 280 },
  { x: 180, z: 280 },
  { x: -280, z: -120 },
  { x: 280, z: -120 },
  { x: -280, z: 120 },
  { x: 280, z: 120 },
] as const;

function createEncounterCell(
  center: (typeof ENCOUNTER_CELLS)[number],
): readonly BreakablePlacement[] {
  const placements: BreakablePlacement[] = [];
  for (const zOffset of CELL_Z_OFFSETS)
    for (const xOffset of CELL_X_OFFSETS)
      placements.push({
        position: Object.freeze({
          x: center.x + xOffset,
          y: 0.5,
          z: center.z + zOffset,
        }),
        rotation: IDENTITY_ROTATION,
      });
  return placements;
}

const GATE_SLAT_OFFSETS = [-2.5, -1.5, -0.5, 0.5, 1.5, 2.5] as const;

function createGate(
  center: Readonly<{ x: number; z: number }>,
  forward: Readonly<{ x: number; z: number }>,
): readonly BreakablePlacement[] {
  // Six bumper/hood-height slats and two grounded edge pylons. The gates sit
  // beside, never inside, the painted runways and each keeps a clear bypass.
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

/** Six isolated targets on the long straights and loop approaches. */
const GATE_PLACEMENTS = [
  ...createGate({ x: 26, z: -220 }, { x: 0, z: 1 }),
  ...createGate({ x: -26, z: 230 }, { x: 0, z: 1 }),
  ...createGate({ x: 90, z: 110 }, { x: 0, z: 1 }),
  ...createGate({ x: -86, z: 110 }, { x: 0, z: 1 }),
  ...createGate({ x: 140, z: 24 }, { x: 1, z: 0 }),
  ...createGate({ x: -140, z: -24 }, { x: -1, z: 0 }),
] as const;

/**
 * Phase-one proving-ground density: 12 cells x 12 scenery props (144) plus
 * six eight-piece gates (48) exactly fill the 192 promotion slots. No cell
 * exceeds the 24–32 touching-body rule, and cells are separated so an 80 m/s
 * car cannot drag two encounter islands into one contact cluster.
 */
export const BREAKABLE_PROP_PLACEMENTS: readonly BreakablePlacement[] =
  Object.freeze([
    ...ENCOUNTER_CELLS.flatMap(createEncounterCell),
    ...GATE_PLACEMENTS,
  ]);
