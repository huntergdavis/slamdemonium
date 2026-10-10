import { describe, expect, it } from 'vitest';
import { createRaceEvent, type RaceCar } from '../src/core/raceEvent';
import { createCircuitMap } from '../src/world/circuit';
import { poseAt } from '../src/world/roadGenerator';

const circuit = createCircuitMap();
const route = circuit.runs![0]!;
const forward = (station: number, id: number, speed = 30): RaceCar => {
  const pose = poseAt(circuit.path, station);
  return {
    id,
    x: pose.x,
    z: pose.z,
    vx: -Math.sin(pose.heading) * speed,
    vz: -Math.cos(pose.heading) * speed,
  };
};

describe('six-car circuit race', () => {
  it('starts at GO and requires forward crossings of every gate before a finish', () => {
    const race = createRaceEvent(route, circuit.path, [1, 2, 3, 4, 5]);
    const cars = [0, 1, 2, 3, 4, 5].map((id) =>
      forward(circuit.path.length - 50, id, 0),
    );
    race.update(2, cars);
    expect(race.state.phase).toBe('countdown');
    race.update(1, cars);
    expect(race.state.phase).toBe('running');
    expect(race.state.clock).toBe(0);

    const step = (id: number, station: number, speed = 30) => {
      cars[id] = forward(station, id, speed);
      race.update(1 / 120, cars);
    };
    step(0, 0);
    expect(race.state.nextCheckpoint).toBe(1);
    step(0, 5000); // Checkpoint 2 without checkpoint 1.
    expect(race.state.nextCheckpoint).toBe(1);
    step(1, 0);
    step(1, 2500);
    expect(race.validatedStation(1)).toBeCloseTo(2500, -1);
    expect(race.order.indexOf(1)).toBeLessThan(race.order.indexOf(0));
    step(2, 0);
    step(2, 2500);
    step(2, 2510);
    step(1, 2460); // A penalized re-entry behind its last valid gate.
    race.update(0.11, cars); // Standings refresh at 10 Hz between crossings.
    expect(race.order.indexOf(2)).toBeLessThan(race.order.indexOf(1));
    step(0, 2500);
    step(0, 5000);
    step(0, 7500);
    const goal = circuit.path.length - 20;
    step(0, goal, -30);
    expect(race.state.phase).toBe('running');
    step(0, goal - 20);
    step(0, goal);
    expect(race.state.phase).toBe('finished');
    expect(race.state.position).toBe(1);
    expect(race.state.finishOrder).toEqual([0]);
    const finishTime = race.state.finishTime;
    race.update(1, cars);
    expect(race.state.finishTime).toBe(finishTime);

    race.reset();
    expect(race.state.phase).toBe('countdown');
    expect(race.state.clock).toBe(0);
    expect(race.state.finishOrder).toEqual([]);
  });
});

describe('two-car Face Off', () => {
  it('starts P2/2, requires a valid lap, and resets to the same grid', () => {
    const race = createRaceEvent(route, circuit.path, [7]);
    const cars = [
      forward(circuit.path.length - 65, 0, 0),
      forward(circuit.path.length - 35, 7, 0),
    ];
    expect(race.state.position).toBe(2);
    expect(race.state.fieldSize).toBe(2);
    race.update(3, cars);
    const step = (id: number, station: number, speed = 30) => {
      cars[id === 0 ? 0 : 1] = forward(station, id, speed);
      race.update(1 / 120, cars);
    };
    step(7, 0);
    step(7, 2500);
    step(7, 5000);
    step(7, 7500);
    step(7, circuit.path.length - 20);
    step(0, 0);
    step(0, circuit.path.length - 20); // Skipped the checkpoints.
    expect(race.state.phase).toBe('running');
    step(0, 2500);
    step(0, 5000);
    step(0, 7500);
    step(0, circuit.path.length - 40);
    step(0, circuit.path.length - 20);
    expect(race.state.phase).toBe('finished');
    expect(race.state.position).toBe(2); // Opponent won; no prize.
    for (let retry = 0; retry < 10; retry++) {
      race.reset();
      expect(race.state.phase).toBe('countdown');
      expect(race.state.position).toBe(2);
      expect(race.state.finishOrder).toEqual([]);
      expect(race.order).toEqual([7, 0]);
    }
  });
});
