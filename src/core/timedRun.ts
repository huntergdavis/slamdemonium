/** The timed run (NS3), as pure state so it is testable without a world.
 *
 * The CTO's shape: he pulls up to a start line in the world and that kicks
 * it off, "like open world racing games"; the clock runs; reaching the goal
 * ends it; Enter is the instant retry. No menu, no key to start, no timer
 * that expires, no results screen. The clock is the point: the crash score
 * keeps accumulating but is not the objective.
 *
 * Gates are boxes painted on the ground (start, checkpoints in order, goal)
 * and the trigger is forgiving about arrival: entering the start gate at
 * any speed or angle starts a run. Pulled up (under ROLLING_START_SPEED) it
 * counts down 3, 2, 1, GO and the clock starts at GO; leaving the gate
 * before GO is a jump start and the clock starts then, no penalty. Rolling
 * in faster than that, the clock starts as the car enters: the time is
 * always measured from the line. Checkpoints must be taken in order or the
 * goal does not count; wandering off, reversing or never arriving simply
 * leaves the clock running, and the ways out are the goal, the start line
 * again, or Enter. Re-entering the start gate mid-run restarts the run
 * (the line always works); a respawn abandons it. */
export const RUN_COUNTDOWN_SECONDS = 3;
export const ROLLING_START_SPEED = 3;
/** How long the finish time stays on screen before the readout fades. */
export const RUN_FINISH_LINGER_SECONDS = 6;

export type RunGateKind = 'start' | 'checkpoint' | 'goal';
export interface RunGateSpec {
  readonly kind: RunGateKind;
  /** Centre of the painted box; `heading` is the ramp convention (0 faces -Z,
   * positive turns left), `length` along it, `width` across. */
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  readonly width: number;
  readonly length: number;
}
export interface RunRouteSpec {
  readonly name: string;
  /** Start first, goal last, checkpoints between, in order. */
  readonly gates: readonly RunGateSpec[];
}

export type RunPhase = 'idle' | 'countdown' | 'running' | 'finished';
export interface TimedRunState {
  readonly phase: RunPhase;
  /** Seconds left in the countdown, 0 otherwise. */
  readonly countdown: number;
  /** The clock: elapsed seconds while running, the finish time once finished, 0 idle. */
  readonly clock: number;
  /** Gates taken this run, including the start. */
  readonly gatesTaken: number;
  readonly gateCount: number;
  /** Seconds since the finish while finished, 0 otherwise. */
  readonly sinceFinish: number;
  /** True when the phase changed this update: the readout re-announces. */
  readonly changed: boolean;
}

export interface TimedRun {
  readonly state: TimedRunState;
  readonly route: RunRouteSpec | undefined;
  /** Once per physics step, after it, with the car's ground position and speed. */
  update(dt: number, x: number, z: number, speed: number): void;
  /** The car was put back on the start line (retry): idle, and the next
   * update treats the car as arriving at the gate. */
  reset(): void;
  /** A respawn elsewhere: the run is abandoned, nothing shown. */
  abandon(): void;
}

function forward(gate: Readonly<RunGateSpec>): { x: number; z: number } {
  return { x: -Math.sin(gate.heading), z: -Math.cos(gate.heading) };
}

/** Axis-of-heading box test: inside when within half the length along the
 * heading and half the width across it. Edges inclusive. */
export function runGateContains(
  gate: Readonly<RunGateSpec>,
  x: number,
  z: number,
): boolean {
  const f = forward(gate);
  const dx = x - gate.x;
  const dz = z - gate.z;
  const along = dx * f.x + dz * f.z;
  const across = dx * f.z - dz * f.x;
  return (
    Math.abs(along) <= gate.length / 2 && Math.abs(across) <= gate.width / 2
  );
}

/** The four ground corners, counter-clockwise seen from above. */
export function runGateCorners(
  gate: Readonly<RunGateSpec>,
): readonly [x: number, z: number][] {
  const f = forward(gate);
  const l = { x: f.z, z: -f.x };
  const hl = gate.length / 2;
  const hw = gate.width / 2;
  return [
    [gate.x + l.x * hw - f.x * hl, gate.z + l.z * hw - f.z * hl],
    [gate.x - l.x * hw - f.x * hl, gate.z - l.z * hw - f.z * hl],
    [gate.x - l.x * hw + f.x * hl, gate.z - l.z * hw + f.z * hl],
    [gate.x + l.x * hw + f.x * hl, gate.z + l.z * hw + f.z * hl],
  ];
}

export function createTimedRun(route: RunRouteSpec | undefined): TimedRun {
  if (route) {
    const kinds = route.gates.map((g) => g.kind);
    if (
      kinds[0] !== 'start' ||
      kinds[kinds.length - 1] !== 'goal' ||
      kinds.slice(1, -1).some((k) => k !== 'checkpoint')
    )
      throw new RangeError(
        'A run route is a start gate, checkpoints in order, then a goal gate.',
      );
  }
  const gates = route?.gates ?? [];
  const values = {
    phase: 'idle' as RunPhase,
    countdown: 0,
    clock: 0,
    gatesTaken: 0,
    gateCount: gates.length,
    sinceFinish: 0,
    changed: false,
  };
  let insideStart = false;
  let previousPhase: RunPhase = 'idle';

  function begin(rolling: boolean): void {
    values.gatesTaken = 1;
    values.clock = 0;
    values.sinceFinish = 0;
    if (rolling) {
      values.phase = 'running';
      values.countdown = 0;
    } else {
      values.phase = 'countdown';
      values.countdown = RUN_COUNTDOWN_SECONDS;
    }
  }

  return {
    state: values,
    route,
    update(dt, x, z, speed) {
      previousPhase = values.phase;
      values.changed = false;
      if (gates.length === 0) return;
      const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
      const start = gates[0]!;
      const nowInsideStart = runGateContains(start, x, z);
      const entered = nowInsideStart && !insideStart;
      const left = !nowInsideStart && insideStart;
      insideStart = nowInsideStart;
      switch (values.phase) {
        case 'idle':
        case 'finished':
          if (values.phase === 'finished') {
            values.sinceFinish += step;
            if (values.sinceFinish >= RUN_FINISH_LINGER_SECONDS) {
              values.phase = 'idle';
              values.sinceFinish = 0;
              values.clock = 0;
              values.gatesTaken = 0;
            }
          }
          if (entered) begin(speed >= ROLLING_START_SPEED);
          break;
        case 'countdown':
          values.countdown = Math.max(0, values.countdown - step);
          if (values.countdown < 1e-9) values.countdown = 0; // 360 steps of 1/120 must reach GO.
          if (left || values.countdown === 0) {
            values.phase = 'running';
            values.countdown = 0;
          }
          break;
        case 'running': {
          values.clock += step;
          if (entered) {
            // The line always works: through the start again is a new run.
            begin(speed >= ROLLING_START_SPEED);
            break;
          }
          const next = gates[values.gatesTaken];
          if (next && runGateContains(next, x, z)) {
            values.gatesTaken++;
            if (next.kind === 'goal') {
              values.phase = 'finished';
              values.sinceFinish = 0;
            }
          }
          break;
        }
      }
      values.changed = values.phase !== previousPhase;
    },
    reset() {
      values.phase = 'idle';
      values.countdown = 0;
      values.clock = 0;
      values.gatesTaken = 0;
      values.sinceFinish = 0;
      values.changed = previousPhase !== 'idle';
      insideStart = false; // Placed on the line: the next update is an arrival.
    },
    abandon() {
      const was = values.phase;
      values.phase = 'idle';
      values.countdown = 0;
      values.clock = 0;
      values.gatesTaken = 0;
      values.sinceFinish = 0;
      values.changed = was !== 'idle';
      insideStart = true; // Not an arrival until the car has left and come back.
    },
  };
}
