import type { Quat, V3 } from '../physics/adapter';
import type { BreakablePlacement, BreakableProps } from './breakableProps';

/** One record is both authored map data and the streamer's source of truth. */
export interface PropStreamRecord {
  readonly id: string;
  readonly cellId: number;
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
  readonly enterRadius?: number;
  readonly exitRadius?: number;
}): PropStreamer {
  const enterRadius = options.enterRadius ?? PROP_STREAM_ENTER_RADIUS;
  const exitRadius = options.exitRadius ?? PROP_STREAM_EXIT_RADIUS;
  if (!(exitRadius > enterRadius))
    throw new RangeError('Prop stream exit radius must exceed entry radius.');
  const enterSquared = enterRadius * enterRadius;
  const exitSquared = exitRadius * exitRadius;
  const promoted = new Uint8Array(options.records.length);
  const vehiclePosition: V3 = { x: 0, y: 0, z: 0 };
  const bodyPosition: V3 = { x: 0, y: 0, z: 0 };
  const cellsById = new Map<number, PropStreamRecord[]>();
  for (const record of options.records) {
    const cell = cellsById.get(record.cellId);
    if (cell) cell.push(record);
    else cellsById.set(record.cellId, [record]);
  }
  const cells = Object.freeze(
    [...cellsById].map(([id, records]) =>
      Object.freeze({ id, records: Object.freeze(records) }),
    ),
  );
  let disposed = false;

  function update(): void {
    if (disposed) return;
    options.readVehiclePosition(vehiclePosition);
    for (let index = 0; index < options.records.length; index++) {
      const record = options.records[index];
      if (!record) continue;
      const dx = record.position.x - vehiclePosition.x;
      const dz = record.position.z - vehiclePosition.z;
      const authoredDistanceSquared = dx * dx + dz * dz;
      if (promoted[index] === 0) {
        if (
          authoredDistanceSquared <= enterSquared &&
          options.props.activate(record.placementIndex)
        )
          promoted[index] = 1;
        continue;
      }
      if (!options.props.isActive(record.placementIndex)) {
        promoted[index] = 0;
        continue;
      }
      if (authoredDistanceSquared <= exitSquared) continue;
      // Check the live pose before releasing. This prevents a pushed body (and
      // especially a body supporting the car) from being unloaded by its old
      // authored cell location.
      if (
        options.props.getActivePropPosition(record.placementIndex, bodyPosition)
      ) {
        const liveDx = bodyPosition.x - vehiclePosition.x;
        const liveDz = bodyPosition.z - vehiclePosition.z;
        if (liveDx * liveDx + liveDz * liveDz <= exitSquared) continue;
      }
      if (options.props.deactivate(record.placementIndex)) promoted[index] = 0;
    }
  }

  function reset(): void {
    if (disposed) return;
    options.props.reset();
    promoted.fill(0);
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
    dispose(): void {
      disposed = true;
      promoted.fill(0);
    },
  };
}
