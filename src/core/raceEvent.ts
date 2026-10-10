import { runGateContains, type RunRouteSpec } from './timedRun';
import { eliminatorMedal, type EliminatorMedal } from './eliminator';
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
  readonly mode: 'race' | 'eliminator' | 'grand-prix';
  readonly phase: RacePhase;
  readonly countdown: number;
  readonly clock: number;
  readonly position: number;
  readonly fieldSize: number;
  readonly nextCheckpoint: number;
  readonly checkpointCount: number;
  readonly finishOrder: readonly number[];
  /** Stable grid slot (player zero, then authored rivals), across map reloads. */
  readonly finishTimes: readonly number[];
  readonly finishTime: number;
  readonly lap: number;
  readonly lapTarget: number;
  readonly remaining: number;
  readonly atRisk: boolean;
  readonly eliminated: boolean;
  readonly won: boolean;
  readonly cutCount: number;
  readonly lastCutId: number;
  readonly medal: EliminatorMedal;
}

interface Entry {
  readonly id: number;
  nextGate: number;
  inside: boolean;
  progress: number;
  finishTime: number;
  lap: number;
  eliminated: boolean;
  place: number;
}

export interface RaceOptions {
  /** The ordinary circuit race is one lap; Eliminator repeats the validated
   * gate sequence and cuts the last surviving entrant after each leader lap. */
  readonly mode?: 'race' | 'eliminator' | 'grand-prix';
  readonly laps?: number;
}

/** Shared one-lap and Eliminator standings. A nearest-station estimate can
 * order cars only within their validated lap and gate sector; it can never
 * award a skipped gate or an unearned elimination cut. */
export function createRaceEvent(
  route: RunRouteSpec,
  path: RoadPath,
  rivalIds: readonly number[],
  options: RaceOptions = {},
) {
  if (route.gates.length < 3 || rivalIds.length < 1)
    throw new RangeError(
      'A race needs a start, checkpoints, goal and at least one rival.',
    );
  const mode = options.mode ?? 'race';
  const lapTarget = mode === 'eliminator' ? (options.laps ?? 5) : 1;
  if (
    !Number.isInteger(lapTarget) ||
    (mode === 'eliminator' && lapTarget !== rivalIds.length)
  )
    throw new RangeError('Six-car Eliminator needs exactly five lap cuts.');
  const entries: Entry[] = [0, ...rivalIds].map((id) => ({
    id,
    nextGate: 0,
    inside: false,
    progress: -100,
    finishTime: Infinity,
    lap: 0,
    eliminated: false,
    place: 0,
  }));
  const ordered: number[] = [...rivalIds, 0];
  const finishOrder: number[] = [];
  const finishTimes: number[] = Array(entries.length).fill(Infinity);
  const slotById = new Map(entries.map((entry, slot) => [entry.id, slot]));
  let rankDelay = 0;
  let firstFinishTime = Infinity;
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
    lap: number;
    remaining: number;
    atRisk: boolean;
    eliminated: boolean;
    won: boolean;
    cutCount: number;
    lastCutId: number;
    medal: EliminatorMedal;
  } = {
    mode,
    phase: 'countdown',
    countdown: 3,
    clock: 0,
    position: entries.length,
    fieldSize: entries.length,
    nextCheckpoint: 1,
    checkpointCount: route.gates.length - 2,
    finishOrder,
    finishTimes,
    finishTime: Infinity,
    lap: 0,
    lapTarget,
    remaining: entries.length,
    atRisk: false,
    eliminated: false,
    won: false,
    cutCount: 0,
    lastCutId: -1,
    medal: 'none',
  };

  function reset(): void {
    values.phase = 'countdown';
    values.countdown = 3;
    values.clock = 0;
    values.position = entries.length;
    values.nextCheckpoint = 1;
    values.finishTime = Infinity;
    values.lap = 0;
    values.remaining = entries.length;
    values.atRisk = false;
    values.eliminated = false;
    values.won = false;
    values.cutCount = 0;
    values.lastCutId = -1;
    values.medal = 'none';
    finishOrder.length = 0;
    finishTimes.fill(Infinity);
    rankDelay = 0;
    firstFinishTime = Infinity;
    for (let index = 0; index < rivalIds.length; index++)
      ordered[index] = rivalIds[index]!;
    ordered[rivalIds.length] = 0;
    for (const entry of entries) {
      entry.nextGate = 0;
      entry.inside = false;
      entry.progress = -100;
      entry.finishTime = Infinity;
      entry.lap = 0;
      entry.eliminated = false;
      entry.place = 0;
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
      if (!car || entry.finishTime < Infinity || entry.eliminated) continue;
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
            entry.lap++;
            if (mode !== 'eliminator') {
              entry.finishTime = values.clock;
              finishOrder.push(entry.id);
              finishTimes[slotById.get(entry.id)!] = values.clock;
              firstFinishTime = Math.min(firstFinishTime, values.clock);
            } else entry.nextGate = 0;
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
      if (entry.eliminated) {
        entry.progress = -Infinity;
        continue;
      }
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
        entry.nextGate === 0 && entry.lap === 0
          ? Math.min(
              0,
              station > path.length - 150 ? station - path.length : -100,
            )
          : entry.lap * path.length +
            (entry.nextGate === 0
              ? Math.max(-30, station - path.length)
              : Math.max(passed, Math.min(next - 0.01, station)));
    }
    entries.sort((a, b) =>
      a.eliminated || b.eliminated
        ? Number(a.eliminated) - Number(b.eliminated) || a.place - b.place
        : a.finishTime < Infinity || b.finishTime < Infinity
          ? a.finishTime - b.finishTime
          : b.lap - a.lap ||
            b.nextGate - a.nextGate ||
            b.progress - a.progress ||
            (mode === 'eliminator'
              ? a.id - b.id
              : a.id === 0
                ? 1
                : b.id === 0
                  ? -1
                  : a.id - b.id),
    );
    if (mode === 'eliminator') {
      const leader = entries[0]!;
      if (leader.lap > values.cutCount && values.cutCount < lapTarget) {
        const last = entries[values.remaining - 1]!;
        last.eliminated = true;
        last.place = values.remaining;
        values.lastCutId = last.id;
        values.cutCount++;
        values.remaining--;
        finishOrder.unshift(last.id);
        if (last.id === 0 || values.cutCount === lapTarget) {
          values.phase = 'finished';
          values.finishTime = values.clock;
          values.eliminated = last.id === 0;
          values.won = !values.eliminated;
          if (values.won) finishOrder.unshift(leader.id);
        }
      }
    }
    for (let index = 0; index < entries.length; index++)
      ordered[index] = entries[index]!.id;
    values.position = ordered.indexOf(0) + 1;
    const player = entries.find((entry) => entry.id === 0)!;
    values.nextCheckpoint = Math.max(
      1,
      Math.min(player.nextGate, route.gates.length - 1),
    );
    values.lap = player.lap;
    if (mode === 'eliminator')
      values.medal = eliminatorMedal(
        player.eliminated ? entries.length - player.place : values.cutCount,
        values.won,
      );
    values.atRisk =
      mode === 'eliminator' &&
      !player.eliminated &&
      values.position === values.remaining;
    if (mode === 'race' && player.finishTime < Infinity) {
      values.phase = 'finished';
      values.finishTime = player.finishTime;
    }
    if (
      mode === 'grand-prix' &&
      (finishOrder.length === entries.length ||
        values.clock - firstFinishTime >= 30)
    ) {
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
    freeze(): void {
      values.phase = 'finished';
    },
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
