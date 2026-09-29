import { describe, expect, it } from 'vitest';
import {
  createTimedRun,
  ROLLING_START_SPEED,
  RUN_COUNTDOWN_SECONDS,
  RUN_FINISH_LINGER_SECONDS,
  runGateContains,
  runGateCorners,
  type RunRouteSpec,
} from '../src/core/timedRun';

const NORTH = Math.PI;
const route: RunRouteSpec = {
  name: 'test',
  gates: [
    { kind: 'start', x: 0, z: -100, heading: NORTH, width: 20, length: 8 },
    { kind: 'checkpoint', x: 0, z: 0, heading: NORTH, width: 20, length: 8 },
    { kind: 'goal', x: 0, z: 100, heading: NORTH, width: 20, length: 8 },
  ],
};
const DT = 1 / 120;
function steps(
  run: ReturnType<typeof createTimedRun>,
  n: number,
  x: number,
  z: number,
  speed: number,
) {
  for (let i = 0; i < n; i++) run.update(DT, x, z, speed);
}

describe('run gates', () => {
  it('is a box along its heading, edges inclusive, with counter-clockwise corners', () => {
    const g = route.gates[0]!;
    expect(runGateContains(g, 0, -100)).toBe(true);
    expect(runGateContains(g, 10, -96)).toBe(true);
    expect(runGateContains(g, 10.01, -100)).toBe(false);
    expect(runGateContains(g, 0, -104.01)).toBe(false);
    const c = runGateCorners(g);
    expect(c).toHaveLength(4);
    // Shoelace area positive: counter-clockwise seen from above (x right, z toward the viewer).
    let area = 0;
    for (let i = 0; i < 4; i++) {
      const [x1, z1] = c[i]!;
      const [x2, z2] = c[(i + 1) % 4]!;
      area += x1 * z2 - x2 * z1;
    }
    expect(Math.abs(area) / 2).toBeCloseTo(20 * 8, 6);
  });
  it('rejects a route that does not start with a start and end with a goal', () => {
    expect(() =>
      createTimedRun({
        name: 'bad',
        gates: [route.gates[1]!, route.gates[2]!],
      }),
    ).toThrow(RangeError);
    expect(() =>
      createTimedRun({
        name: 'bad',
        gates: [route.gates[0]!, route.gates[2]!, route.gates[1]!],
      }),
    ).toThrow(RangeError);
  });
});

describe('the timed run', () => {
  it('is idle until the car arrives at the start, then counts down when pulled up and starts the clock at GO', () => {
    const run = createTimedRun(route);
    steps(run, 10, 0, -200, 0);
    expect(run.state.phase).toBe('idle');
    run.update(DT, 0, -100, 0);
    expect(run.state.phase).toBe('countdown');
    expect(run.state.changed).toBe(true);
    expect(run.state.countdown).toBe(RUN_COUNTDOWN_SECONDS); // The arrival step.
    steps(run, 120 * RUN_COUNTDOWN_SECONDS, 0, -100, 0);
    expect(run.state.phase).toBe('running');
    expect(run.state.clock).toBe(0); // GO: the clock starts from here.
    steps(run, 120, 0, -50, 40);
    expect(run.state.clock).toBeCloseTo(1, 6);
  });

  it('starts the clock as the car enters when it rolls in fast: time is measured from the line', () => {
    const run = createTimedRun(route);
    run.update(DT, 0, -200, 40);
    run.update(DT, 0, -103, ROLLING_START_SPEED);
    expect(run.state.phase).toBe('running');
    expect(run.state.countdown).toBe(0);
  });

  it('treats leaving the gate during the countdown as a jump start with no penalty', () => {
    const run = createTimedRun(route);
    run.update(DT, 0, -100, 0);
    steps(run, 60, 0, -100, 0);
    run.update(DT, 0, -90, 5);
    expect(run.state.phase).toBe('running');
    expect(run.state.clock).toBe(0);
  });

  it('needs the checkpoints in order before the goal counts, and the goal ends it with the time held', () => {
    const run = createTimedRun(route);
    run.update(DT, 0, -103, 40);
    steps(run, 120, 0, -50, 40);
    // Straight to the goal, skipping the checkpoint: nothing happens.
    steps(run, 10, 0, 100, 40);
    expect(run.state.phase).toBe('running');
    expect(run.state.gatesTaken).toBe(1);
    steps(run, 10, 0, 0, 40);
    expect(run.state.gatesTaken).toBe(2);
    steps(run, 10, 0, 100, 40);
    expect(run.state.phase).toBe('finished');
    expect(run.state.gatesTaken).toBe(3);
    const time = run.state.clock;
    // Every running step before and including the goal step counts; the
    // entry step does not (the clock starts from the line).
    expect(time).toBeCloseTo((120 + 10 + 10 + 1) * DT, 6);
    steps(run, 30, 0, 150, 40);
    expect(run.state.clock).toBe(time); // Held while finished.
    steps(run, 120 * RUN_FINISH_LINGER_SECONDS, 0, 150, 0);
    expect(run.state.phase).toBe('idle');
    expect(run.state.clock).toBe(0);
  });

  it('through the start line again mid-run is a new run, and a respawn abandons it', () => {
    const run = createTimedRun(route);
    run.update(DT, 0, -103, 40);
    steps(run, 240, 0, 0, 40);
    expect(run.state.gatesTaken).toBe(2);
    run.update(DT, 0, -100, 40); // Back through the start.
    expect(run.state.phase).toBe('running');
    expect(run.state.gatesTaken).toBe(1);
    expect(run.state.clock).toBe(0);
    run.abandon();
    expect(run.state.phase).toBe('idle');
    expect(run.state.changed).toBe(true);
    // Still standing on the line after a respawn onto it: not an arrival.
    run.update(DT, 0, -100, 0);
    expect(run.state.phase).toBe('idle');
  });

  it('retry places the car on the line and the next update is an arrival: countdown at once', () => {
    const run = createTimedRun(route);
    run.update(DT, 0, -103, 40);
    steps(run, 100, 0, 0, 40);
    run.reset();
    expect(run.state.phase).toBe('idle');
    run.update(DT, 0, -100, 0);
    expect(run.state.phase).toBe('countdown');
  });

  it('is inert without a route', () => {
    const run = createTimedRun(undefined);
    run.update(DT, 0, 0, 50);
    expect(run.state.phase).toBe('idle');
    expect(run.state.gateCount).toBe(0);
  });
});
