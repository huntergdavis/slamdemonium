import type { BreakablePlacement } from './breakableProps';

const IDENTITY_ROTATION = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });
const PHASE_TWO_RECORD_COUNT = 256;
const FAR_FIELD_LIMIT = 350;
const FAR_FIELD_STEP = 4;
const CLUSTER_X_OFFSETS = [-7, -2.35, 2.35, 7] as const;
const CLUSTER_Z_OFFSETS = [-6, 0, 6] as const;
// Route-side scatter gives the driver several light contacts to pick off
// without turning the whole shoulder into one collision island.
const SCATTER_X_OFFSETS = [-8, -2.7, 2.7, 8] as const;
const SCATTER_Z_OFFSETS = [-5, 0, 5] as const;

/** Twelve 12-prop encounter cells keep contact islands local on the large map.
 * They sit in the infield shoulders, away from every runway and target corridor;
 * moving a cell is a data-only edit shared by the streamer and far visual. */
const SCATTER_CELLS = [
  { x: -120, z: -280 },
  { x: 120, z: -280 },
  { x: -180, z: -180 },
  { x: 180, z: -180 },
  { x: -180, z: -80 },
  { x: 180, z: -80 },
] as const;

const CLUSTER_CELLS = [
  { x: -100, z: 140 },
  { x: 100, z: 140 },
  { x: -100, z: 260 },
  { x: 100, z: 260 },
  { x: -320, z: 30 },
  { x: -250, z: -30 },
] as const;

function createEncounterCell(
  center: (typeof SCATTER_CELLS)[number] | (typeof CLUSTER_CELLS)[number],
  scatter: boolean,
): readonly BreakablePlacement[] {
  const placements: BreakablePlacement[] = [];
  const xOffsets = scatter ? SCATTER_X_OFFSETS : CLUSTER_X_OFFSETS;
  const zOffsets = scatter ? SCATTER_Z_OFFSETS : CLUSTER_Z_OFFSETS;
  for (const zOffset of zOffsets)
    for (const xOffset of xOffsets)
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

/** True for positions reserved for runways, targets, and the racing line. */
function isRouteExcluded(x: number, z: number): boolean {
  if (Math.abs(x) <= 13 && z >= -370 && z <= 370) return true;
  if (Math.abs(z) <= 13 && x >= -370 && x <= 370) return true;
  if (x >= -52 && x <= -20 && z >= -220 && z <= 60) return true;
  if (x >= 18 && x <= 54 && z >= -220 && z <= 60) return true;
  if (x >= 43 && x <= 85 && z >= 48 && z <= 370) return true;
  if (Math.abs(x) <= 20 && z >= 25 && z <= 455) return true;
  if (x >= -62 && x <= -20 && z >= 12 && z <= 68) return true;
  if (x >= 20 && x <= 62 && z >= 12 && z <= 68) return true;
  return false;
}

function yawRotation(
  yaw: number,
): Readonly<{ x: number; y: number; z: number; w: number }> {
  return Object.freeze({
    x: 0,
    y: Math.sin(yaw * 0.5),
    z: 0,
    w: Math.cos(yaw * 0.5),
  });
}

function hashUnit(index: number): number {
  const value = Math.sin(index * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function createFarFieldPopulation(
  authored: readonly BreakablePlacement[],
): readonly BreakablePlacement[] {
  const placements = [...authored];
  let candidate = 0;
  for (
    let z = -FAR_FIELD_LIMIT;
    z <= FAR_FIELD_LIMIT && placements.length < PHASE_TWO_RECORD_COUNT;
    z += FAR_FIELD_STEP
  ) {
    for (
      let x = -FAR_FIELD_LIMIT;
      x <= FAR_FIELD_LIMIT && placements.length < PHASE_TWO_RECORD_COUNT;
      x += FAR_FIELD_STEP
    ) {
      const jitterX = (hashUnit(candidate++) - 0.5) * 0.8;
      const jitterZ = (hashUnit(candidate++) - 0.5) * 0.8;
      const px = x + jitterX;
      const pz = z + jitterZ;
      if (Math.hypot(px, pz) >= FAR_FIELD_LIMIT || isRouteExcluded(px, pz))
        continue;
      placements.push({
        position: Object.freeze({ x: px, y: 0.5, z: pz }),
        rotation: yawRotation((hashUnit(candidate++) - 0.5) * Math.PI * 2),
      });
    }
  }
  if (placements.length !== PHASE_TWO_RECORD_COUNT)
    throw new Error(
      `Phase-two population generated ${placements.length} records.`,
    );
  return Object.freeze(placements);
}

/**
 * Phase-two proving-ground content: the original 192 route targets remain the
 * deliberate smash encounters (scatter cells, tighter clusters, and six tall
 * gates). The remaining records form a varied far-field lattice inside the
 * infield. Every lattice gap is wider than a one-metre collider, so dormant
 * scenery does not become a touching island; only the nearby promotion window
 * can spend dynamic-body budget. Runway and target corridors stay empty.
 */
export const BREAKABLE_PROP_PLACEMENTS: readonly BreakablePlacement[] =
  createFarFieldPopulation([
    ...SCATTER_CELLS.flatMap((center) => createEncounterCell(center, true)),
    ...CLUSTER_CELLS.flatMap((center) => createEncounterCell(center, false)),
    ...GATE_PLACEMENTS,
  ]);
