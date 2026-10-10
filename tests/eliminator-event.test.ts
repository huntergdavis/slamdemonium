import { expect, it } from 'vitest';
import { createRaceEvent, type RaceCar } from '../src/core/raceEvent';
import { eliminatorMedal } from '../src/core/eliminator';
import { ELIMINATOR_MAP, ELIMINATOR_PATH } from '../src/world/eliminatorCourse';
import { poseAt } from '../src/world/roadGenerator';

const route = ELIMINATOR_MAP.runs![0]!;
const pose = (id: number, station: number, speed = 50): RaceCar => {
  const road = poseAt(ELIMINATOR_PATH, station);
  return {
    id,
    x: road.x,
    z: road.z,
    vx: -Math.sin(road.heading) * speed,
    vz: -Math.cos(road.heading) * speed,
  };
};

it('awards bronze for two survived cuts, silver for the final two, and gold for a win', () => {
  expect([0, 1, 2, 3, 4].map((cuts) => eliminatorMedal(cuts, false))).toEqual([
    'none',
    'none',
    'bronze',
    'bronze',
    'silver',
  ]);
  expect(eliminatorMedal(4, true)).toBe('gold');
});

it('closes a 2–3 km physical loop with five rivals on a clear standing grid', () => {
  expect(ELIMINATOR_PATH.closed).toBe(true);
  expect(ELIMINATOR_PATH.length).toBeGreaterThan(2000);
  expect(ELIMINATOR_PATH.length).toBeLessThan(3000);
  expect(ELIMINATOR_MAP.runways.length).toBeGreaterThan(100);
  expect(ELIMINATOR_MAP.traffic).toHaveLength(5);
  expect(ELIMINATOR_MAP.traffic!.every((car) => car.raceEntrant)).toBe(true);
});

it('cuts exactly one last entrant per validated leader lap, then freezes a win', () => {
  const race = createRaceEvent(route, ELIMINATOR_PATH, [1, 2, 3, 4, 5], {
    mode: 'eliminator',
    laps: 5,
  });
  const cars = [0, 1, 2, 3, 4, 5].map((id) =>
    pose(id, ELIMINATOR_PATH.length - 80, 0),
  );
  race.update(3, cars);
  expect(race.state.phase).toBe('running');
  const drive = (station: number, speed = 50) => {
    cars[0] = pose(0, station, speed);
    race.update(1 / 120, cars);
  };
  drive(0);
  drive(ELIMINATOR_PATH.length / 2); // Skipped checkpoint one.
  drive(ELIMINATOR_PATH.length - 20);
  expect(race.state.cutCount).toBe(0);
  for (let lap = 1; lap <= 5; lap++) {
    drive(ELIMINATOR_PATH.length / 4);
    drive(ELIMINATOR_PATH.length / 2);
    drive((ELIMINATOR_PATH.length * 3) / 4);
    drive(ELIMINATOR_PATH.length - 20);
    expect(race.state.cutCount).toBe(lap);
    expect(race.state.lastCutId).toBe(6 - lap);
    expect(race.state.remaining).toBe(6 - lap);
    if (lap < 5) drive(0);
  }
  expect(race.state.phase).toBe('finished');
  expect(race.state.won).toBe(true);
  expect(race.state.medal).toBe('gold');
  expect(race.state.eliminated).toBe(false);
  expect(race.state.finishOrder).toEqual([0, 1, 2, 3, 4, 5]);
  const clock = race.state.clock;
  race.update(1, cars);
  expect(race.state.clock).toBe(clock);
  race.reset();
  expect(race.state.phase).toBe('countdown');
  expect(race.state.cutCount).toBe(0);
  expect(race.state.remaining).toBe(6);
});

it('eliminates a trailing player on the first cut and ignores wrong-way gates', () => {
  const race = createRaceEvent(route, ELIMINATOR_PATH, [1, 2, 3, 4, 5], {
    mode: 'eliminator',
    laps: 5,
  });
  const cars = [0, 1, 2, 3, 4, 5].map((id) =>
    pose(id, ELIMINATOR_PATH.length - (id === 0 ? 100 : 70), 0),
  );
  race.update(3, cars);
  const drive = (station: number, speed = 50) => {
    cars[1] = pose(1, station, speed);
    race.update(1 / 120, cars);
  };
  drive(0);
  drive(ELIMINATOR_PATH.length / 4);
  drive(ELIMINATOR_PATH.length / 2);
  drive((ELIMINATOR_PATH.length * 3) / 4);
  drive(ELIMINATOR_PATH.length - 20, -50);
  expect(race.state.cutCount).toBe(0);
  drive(ELIMINATOR_PATH.length - 40);
  drive(ELIMINATOR_PATH.length - 20);
  expect(race.state.lastCutId).toBe(0);
  expect(race.state.phase).toBe('finished');
  expect(race.state.eliminated).toBe(true);
  expect(race.state.won).toBe(false);
  expect(race.state.medal).toBe('none');
});
