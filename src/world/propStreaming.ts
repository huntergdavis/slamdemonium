import type { Quat, V3 } from '../physics/adapter';
import type { BreakablePlacement, BreakableProps } from './breakableProps';

/** One record is both authored map data and the streamer's source of truth. */
export interface PropStreamRecord {
  readonly id: string;
  readonly cellId: number;
  readonly cellSize: number;
  readonly placementIndex: number;
  readonly position: Readonly<V3>;
  readonly rotation: Readonly<Quat>;
}

export interface PropStreamCell {
  readonly id: number;
  readonly records: readonly PropStreamRecord[];
}

export interface PropStreamer {
  readonly records: readonly PropStreamRecord[];
  readonly cells: readonly PropStreamCell[];
  update(): void;
  reset(): void;
  isPromoted(index: number): boolean;
  isFarVisible(index: number): boolean;
  /** Copies far-visibility transitions into a caller-owned buffer. */
  copyFarVisibilityChanges(out: Int32Array): number;
  dispose(): void;
}

export const PROP_STREAM_ENTER_RADIUS = 220;
export const PROP_STREAM_EXIT_RADIUS = 300;

/** Converts existing placements to the editor-ready record shape at boot. */
export function createPropStreamRecords(
  placements: readonly BreakablePlacement[],
  cellSize = 160,
): readonly PropStreamRecord[] {
  const cells = new Map<number, PropStreamRecord[]>();
  const records: PropStreamRecord[] = [];
  for (let index = 0; index < placements.length; index++) {
    const placement = placements[index];
    if (!placement) continue;
    const cellX = Math.floor(placement.position.x / cellSize);
    const cellZ = Math.floor(placement.position.z / cellSize);
    const cellId = cellX * 100000 + cellZ;
    const record: PropStreamRecord = Object.freeze({
      id: `prop-${index}`,
      cellId,
      cellSize,
      placementIndex: index,
      position: placement.position,
      rotation: placement.rotation,
    });
    records.push(record);
    const cell = cells.get(cellId);
    if (cell) cell.push(record);
    else cells.set(cellId, [record]);
  }
  return Object.freeze(records);
}

export function createPropStreamer(options: {
  readonly props: BreakableProps;
  readonly records: readonly PropStreamRecord[];
  readonly readVehiclePosition: (out: V3) => void;
  /** Maximum simultaneous promotions; full pools skip far candidate scans. */
  readonly maxPromoted?: number;
  readonly enterRadius?: number;
  readonly exitRadius?: number;
}): PropStreamer {
  const enterRadius = options.enterRadius ?? PROP_STREAM_ENTER_RADIUS;
  const exitRadius = options.exitRadius ?? PROP_STREAM_EXIT_RADIUS;
  const maxPromoted = options.maxPromoted ?? options.records.length;
  if (!Number.isSafeInteger(maxPromoted) || maxPromoted <= 0)
    throw new RangeError(
      'Maximum streamed promotions must be a positive integer.',
    );
  if (!(exitRadius > enterRadius))
    throw new RangeError('Prop stream exit radius must exceed entry radius.');
  const enterSquared = enterRadius * enterRadius;
  const exitSquared = exitRadius * exitRadius;
  const promoted = new Uint8Array(options.records.length);
  const promotedSlots = new Int32Array(options.records.length);
  promotedSlots.fill(-1);
  const promotedIndices = new Int32Array(options.records.length);
  const farChanged = new Uint8Array(options.records.length);
  const farChanges = new Int32Array(options.records.length);
  let farChangeCount = 0;
  let promotedCount = 0;
  const vehiclePosition: V3 = { x: 0, y: 0, z: 0 };
  const bodyPosition: V3 = { x: 0, y: 0, z: 0 };
  const cellsById = new Map<number, PropStreamRecord[]>();
  const cellIndicesById = new Map<number, number[]>();
  for (let index = 0; index < options.records.length; index++) {
    const record = options.records[index];
    if (!record) continue;
    const cell = cellsById.get(record.cellId);
    if (cell) cell.push(record);
    else cellsById.set(record.cellId, [record]);
    const indices = cellIndicesById.get(record.cellId);
    if (indices) indices.push(index);
    else cellIndicesById.set(record.cellId, [index]);
  }
  const cells = Object.freeze(
    [...cellsById].map(([id, records]) =>
      Object.freeze({ id, records: Object.freeze(records) }),
    ),
  );
  const candidateIndices = new Int32Array(options.records.length);
  const candidateMarks = new Uint32Array(options.records.length);
  const cellSize = options.records[0]?.cellSize ?? 160;
  let candidateMark = 0;
  let disposed = false;

  function queueFarChange(index: number): void {
    if (farChanged[index] !== 0 || farChangeCount >= farChanges.length) return;
    farChanged[index] = 1;
    farChanges[farChangeCount++] = index;
  }

  function addPromoted(index: number): void {
    const slot = promotedSlots[index];
    if (
      slot === undefined ||
      slot >= 0 ||
      promotedCount >= maxPromoted ||
      promotedCount >= promotedIndices.length
    )
      return;
    promotedSlots[index] = promotedCount;
    promotedIndices[promotedCount++] = index;
  }

  function removePromoted(index: number): void {
    const slot = promotedSlots[index];
    if (slot === undefined || slot < 0 || promotedCount <= 0) return;
    const lastSlot = promotedCount - 1;
    const lastIndex = promotedIndices[lastSlot];
    if (lastIndex === undefined) return;
    promotedCount = lastSlot;
    promotedIndices[slot] = lastIndex;
    promotedSlots[lastIndex] = slot;
    promotedSlots[index] = -1;
  }

  function markCell(cellId: number): void {
    if (candidateCount >= maxPromoted) return;
    const indices = cellIndicesById.get(cellId);
    if (!indices) return;
    for (const index of indices) {
      if (candidateCount >= maxPromoted) return;
      if (candidateMarks[index] === candidateMark) continue;
      candidateMarks[index] = candidateMark;
      if (promoted[index] !== 0) continue;
      const record = options.records[index];
      if (!record) continue;
      const dx = record.position.x - vehiclePosition.x;
      const dz = record.position.z - vehiclePosition.z;
      if (dx * dx + dz * dz > enterSquared) continue;
      candidateIndices[candidateCount++] = index;
    }
  }

  let candidateCount = 0;

  function process(index: number): void {
    const record = options.records[index];
    if (!record) return;
    const dx = record.position.x - vehiclePosition.x;
    const dz = record.position.z - vehiclePosition.z;
    const authoredDistanceSquared = dx * dx + dz * dz;
    if (promoted[index] === 0) {
      if (
        authoredDistanceSquared <= enterSquared &&
        options.props.activate(record.placementIndex)
      ) {
        promoted[index] = 1;
        addPromoted(index);
        queueFarChange(index);
      }
      return;
    }
    if (!options.props.isActive(record.placementIndex)) {
      promoted[index] = 0;
      removePromoted(index);
      queueFarChange(index);
      return;
    }
    if (authoredDistanceSquared <= exitSquared) return;
    // Check the live pose before releasing. This prevents a pushed body (and
    // especially a body supporting the car) from being unloaded by its old
    // authored cell location.
    if (
      options.props.getActivePropPosition(record.placementIndex, bodyPosition)
    ) {
      const liveDx = bodyPosition.x - vehiclePosition.x;
      const liveDz = bodyPosition.z - vehiclePosition.z;
      if (liveDx * liveDx + liveDz * liveDz <= exitSquared) return;
    }
    if (options.props.deactivate(record.placementIndex)) {
      promoted[index] = 0;
      removePromoted(index);
      queueFarChange(index);
    }
  }

  function update(): void {
    if (disposed) return;
    options.readVehiclePosition(vehiclePosition);
    // Demote active records first. Once the promotion cap is full, the active
    // list is the only set that can change; skipping candidate cells avoids
    // repeatedly walking thousands of far authored records.
    for (let i = 0; i < promotedCount;) {
      const index = promotedIndices[i]!;
      const before = promotedCount;
      process(index);
      if (promotedCount === before) i++;
    }
    if (promotedCount >= maxPromoted) return;
    candidateMark++;
    if (candidateMark === 0) {
      candidateMarks.fill(0);
      candidateMark = 1;
    }
    candidateCount = 0;
    const minCellX = Math.floor((vehiclePosition.x - exitRadius) / cellSize);
    const maxCellX = Math.floor((vehiclePosition.x + exitRadius) / cellSize);
    const minCellZ = Math.floor((vehiclePosition.z - exitRadius) / cellSize);
    const maxCellZ = Math.floor((vehiclePosition.z + exitRadius) / cellSize);
    for (let cellX = minCellX; cellX <= maxCellX; cellX++)
      for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++)
        markCell(cellX * 100000 + cellZ);
    for (let i = 0; i < candidateCount; i++) process(candidateIndices[i]!);
  }

  function reset(): void {
    if (disposed) return;
    options.props.reset();
    promoted.fill(0);
    promotedSlots.fill(-1);
    promotedCount = 0;
    farChangeCount = 0;
    farChanged.fill(0);
    for (let index = 0; index < options.records.length; index++)
      queueFarChange(index);
    update();
  }

  update();
  return {
    records: options.records,
    cells,
    update,
    reset,
    isPromoted(index: number): boolean {
      return index >= 0 && index < promoted.length && promoted[index] !== 0;
    },
    isFarVisible(index: number): boolean {
      return (
        index >= 0 &&
        index < promoted.length &&
        promoted[index] === 0 &&
        !options.props.isDestroyed(options.records[index]?.placementIndex ?? -1)
      );
    },
    copyFarVisibilityChanges(out: Int32Array): number {
      const count = Math.min(out.length, farChangeCount);
      for (let index = 0; index < count; index++) {
        const recordIndex = farChanges[index]!;
        out[index] = recordIndex;
        farChanged[recordIndex] = 0;
      }
      if (count === farChangeCount) farChangeCount = 0;
      else {
        farChanges.copyWithin(0, count, farChangeCount);
        farChangeCount -= count;
      }
      return count;
    },
    dispose(): void {
      disposed = true;
      promoted.fill(0);
    },
  };
}
