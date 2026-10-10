import { runGateContains, type RunRouteSpec } from './timedRun';
import type { RoadPath } from '../world/roadGenerator';

export type RacePhase = 'countdown' | 'running' | 'finished';

export interface RaceCar {
  readonly id: number;
  readonly x: number;
  readonly z: number;
  readonly vx: number;
  readonly vz: number;
}

export interface RaceState {
  readonly phase: RacePhase;
  readonly countdown: number;
  readonly clock: number;
  readonly position: number;
  readonly fieldSize: number;
  readonly nextCheckpoint: number;
  readonly checkpointCount: number;
  readonly finishOrder: readonly number[];
  readonly finishTime: number;
}

interface Entry {
  readonly id: number;
  nextGate: number;
  inside: boolean;
  progress: number;
  finishTime: number;
}

/** One-lap standings. A nearest-station estimate can order cars only within
 * their currently validated gate sector; it can never award a skipped gate. */
export function createRaceEvent(
  route: RunRouteSpec,
  path: RoadPath,
  rivalIds: readonly number[],
) {
  if (route.gates.length < 3 || rivalIds.length < 1)
    throw new RangeError(
      'A race needs a start, checkpoints, goal and at least one rival.',
    );
  const entries: Entry[] = [0, ...rivalIds].map((id) => ({
    id,
    nextGate: 0,
    inside: false,
    progress: -100,
    finishTime: Infinity,
  }));
  const ordered: number[] = [...rivalIds, 0];
  const finishOrder: number[] = [];
  let rankDelay = 0;
  // The authored circuit gates are stations 0, 2500, 5000, 7500 and L-20.
  // Project them once so the same state object can serve other closed routes.
  const gateStations = route.gates.map((gate, index) =>
    index === 0 ? 0 : nearestStation(path, gate.x, gate.z),
  );
  const values: RaceState & {
    phase: RacePhase;
    countdown: number;
    clock: number;
    position: number;
    nextCheckpoint: number;
    finishTime: number;
  } = {
    phase: 'countdown',
    countdown: 3,
    clock: 0,
    position: entries.length,
    fieldSize: entries.length,
    nextCheckpoint: 1,
    checkpointCount: route.gates.length - 2,
    finishOrder,
    finishTime: Infinity,
  };

  function reset(): void {
    values.phase = 'countdown';
    values.countdown = 3;
    values.clock = 0;
    values.position = entries.length;
    values.nextCheckpoint = 1;
    values.finishTime = Infinity;
    finishOrder.length = 0;
    rankDelay = 0;
    for (let index = 0; index < rivalIds.length; index++)
      ordered[index] = rivalIds[index]!;
    ordered[rivalIds.length] = 0;
    for (const entry of entries) {
      entry.nextGate = 0;
      entry.inside = false;
      entry.progress = -100;
      entry.finishTime = Infinity;
    }
  }

  function update(dt: number, cars: readonly RaceCar[]): void {
    if (values.phase === 'finished') return;
    const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    if (values.phase === 'countdown') {
      values.countdown = Math.max(0, values.countdown - step);
      if (values.countdown > 1e-8) return;
      values.countdown = 0;
      values.phase = 'running';
      return;
    }
    values.clock += step;
    let crossedAny = false;
    for (const entry of entries) {
      const car = cars.find((candidate) => candidate.id === entry.id);
      if (!car || entry.finishTime < Infinity) continue;
      const gate = route.gates[entry.nextGate];
      if (gate) {
        const inside = runGateContains(gate, car.x, car.z);
        const forwardX = -Math.sin(gate.heading);
        const forwardZ = -Math.cos(gate.heading);
        const crossed =
          inside && !entry.inside && car.vx * forwardX + car.vz * forwardZ > 1;
        if (crossed) {
          crossedAny = true;
          entry.nextGate++;
          if (entry.nextGate === route.gates.length) {
            entry.finishTime = values.clock;
            finishOrder.push(entry.id);
          }
        }
        entry.inside = crossed ? false : inside;
      }
    }
    rankDelay += step;
    if (rankDelay < 0.1 && !crossedAny) return;
    rankDelay = 0;
    for (const entry of entries) {
      const car = cars.find((candidate) => candidate.id === entry.id);
      if (!car) continue;
      if (entry.finishTime < Infinity) {
        entry.progress = path.length;
        continue;
      }
      const station = nearestStation(path, car.x, car.z);
      const passed =
        entry.nextGate > 0 ? gateStations[entry.nextGate - 1]! : -100;
      const next = gateStations[entry.nextGate] ?? path.length;
      // Before start, a station near the end of the closed path is behind
      // the grid, not one lap ahead. Within a sector, clamp shortcuts to its
      // far edge until the correct physical gate is crossed.
      entry.progress =
        entry.nextGate === 0
          ? Math.min(
              0,
              station > path.length - 150 ? station - path.length : -100,
            )
          : entry.nextGate === 1 && station > path.length - 150
            ? 0
            : Math.max(passed, Math.min(next - 0.01, station));
    }
    entries.sort((a, b) =>
      a.finishTime < Infinity || b.finishTime < Infinity
        ? a.finishTime - b.finishTime
        : b.nextGate - a.nextGate ||
          b.progress - a.progress ||
          (a.id === 0 ? 1 : b.id === 0 ? -1 : a.id - b.id),
    );
    for (let index = 0; index < entries.length; index++)
      ordered[index] = entries[index]!.id;
    values.position = ordered.indexOf(0) + 1;
    const player = entries.find((entry) => entry.id === 0)!;
    values.nextCheckpoint = Math.max(
      1,
      Math.min(player.nextGate, route.gates.length - 1),
    );
    if (player.finishTime < Infinity) {
      values.phase = 'finished';
      values.finishTime = player.finishTime;
    }
  }

  return {
    state: values as Readonly<RaceState>,
    order: ordered as readonly number[],
    /** Re-entry anchor; race position is still awarded only by gate crossing. */
    validatedStation(id: number): number {
      const entry = entries.find((candidate) => candidate.id === id);
      if (!entry || entry.nextGate <= 1) return 0;
      return gateStations[
        Math.min(entry.nextGate - 1, gateStations.length - 1)
      ]!;
    },
    update,
    reset,
  };
}

function nearestStation(path: RoadPath, x: number, z: number): number {
  let best = Infinity;
  let station = 0;
  for (const sample of path.samples) {
    const dx = sample.x - x;
    const dz = sample.z - z;
    const distance = dx * dx + dz * dz;
    if (distance < best) {
      best = distance;
      station = sample.s;
    }
  }
  return station;
}
