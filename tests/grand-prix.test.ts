import { expect, it } from 'vitest';
import { createGrandPrix } from '../src/core/grandPrix';
import { MAPS } from '../src/world/maps';
import { createTestTrack } from '../src/world/track';
import { Scene } from 'three';
import { poseAt } from '../src/world/roadGenerator';

const ranks = [0, 1, 2, 3, 4, 5];
const times = [101, 102, 103, 104, 105, 106];

it('boots each Grand Prix road and its six-car grid', () => {
  for (const name of [
    'grand-prix-city',
    'grand-prix-coast',
    'grand-prix-highway',
  ] as const) {
    const map = MAPS[name];
    const track = createTestTrack(new Scene(), {
      maxAnisotropy: 1,
      config: map.track,
      spawn: map.spawn!,
    });
    expect(map.traffic!.filter((car) => car.raceEntrant)).toHaveLength(5);
    expect(map.runs![0]!.gates.length).toBeGreaterThanOrEqual(3);
    expect(track.spawn.position.x).toBeCloseTo(map.spawn!.x);
    track.dispose();
  }
});

it('places the open Coast start gate beyond all five grid cars', () => {
  const map = MAPS['grand-prix-coast'];
  const start = poseAt(map.path!, 80);
  expect(map.runs![0]!.gates[0]!.x).toBeCloseTo(start.x);
  expect(map.runs![0]!.gates[0]!.z).toBeCloseTo(start.z);
  expect(
    Math.max(
      ...map
        .traffic!.filter((car) => car.raceEntrant)
        .map((car) => car.station),
    ),
  ).toBeLessThan(70);
  expect(
    map
      .traffic!.filter((car) => !car.raceEntrant)
      .every((car) => car.laneOffset === 4.5),
  ).toBe(true);
});

it('awards each valid heat once, advances in order, and resets the run', () => {
  const gp = createGrandPrix();
  expect(gp.recordHeat(ranks, times)).toBe(true);
  expect(gp.recordHeat(ranks, times)).toBe(false);
  expect(gp.state.points).toEqual([10, 6, 4, 2, 1, 0]);
  expect(gp.medal()).toBe('none');
  expect(gp.nextHeat()).toBe(true);
  expect(gp.nextHeat()).toBe(false);
  expect(gp.state.heat).toBe(1);
  expect(gp.recordHeat([5, 4, 3, 2, 1, 0], times)).toBe(true);
  expect(gp.nextHeat()).toBe(true);
  expect(gp.recordHeat(ranks, times)).toBe(true);
  expect(gp.state.phase).toBe('finished');
  expect(gp.state.points).toEqual([20, 13, 10, 8, 8, 10]);
  expect(gp.medal()).toBe('gold');
  expect(gp.recordHeat(ranks, times)).toBe(false);
  gp.reset();
  expect(gp.state.heat).toBe(0);
  expect(gp.state.points).toEqual([0, 0, 0, 0, 0, 0]);
  expect(gp.medal()).toBe('none');
});

it('resolves a points tie by heat wins, final heat time, then stable slot', () => {
  const gp = createGrandPrix();
  gp.recordHeat([0, 1, 2, 3, 4, 5], times);
  gp.nextHeat();
  gp.recordHeat([1, 2, 0, 3, 4, 5], times);
  gp.nextHeat();
  gp.recordHeat([2, 0, 1, 3, 4, 5], [99, 98, 100, 101, 102, 103]);
  expect(gp.state.points[0]).toBe(20);
  expect(gp.state.points[1]).toBe(20);
  expect(gp.order.indexOf(1)).toBeLessThan(gp.order.indexOf(0));
  const restored = createGrandPrix(JSON.parse(JSON.stringify(gp.snapshot())));
  expect(restored.order).toEqual(gp.order);
  expect(restored.recordHeat(ranks, times)).toBe(false);

  const snapshot = gp.snapshot();
  const tied = createGrandPrix({
    ...snapshot,
    finalTimes: [99, 98, 100, 101, 102, 103],
  });
  expect(tied.order.slice(0, 2)).toEqual([1, 0]);
  const stable = createGrandPrix({
    ...snapshot,
    finalTimes: [99, 99, 100, 101, 102, 103],
  });
  expect(stable.order.slice(0, 2)).toEqual([0, 1]);
});

it('rejects corrupt storage, skipped heats, and duplicate entrant orders', () => {
  expect(createGrandPrix({ version: 1, phase: 'finished' }).state.phase).toBe(
    'racing',
  );
  const forged = createGrandPrix({
    version: 1,
    heat: 2,
    phase: 'finished',
    points: [10, 6, 4, 2, 1, 0],
    wins: [1, 0, 0, 0, 0, 0],
    finalTimes: times,
    lastOrder: ranks,
  });
  expect(forged.state.phase).toBe('racing');
  expect(forged.medal()).toBe('none');
  const gp = createGrandPrix();
  expect(gp.nextHeat()).toBe(false);
  expect(gp.recordHeat([0, 0, 2, 3, 4, 5], times)).toBe(false);
  expect(gp.recordHeat(ranks, [0, 1])).toBe(false);
  expect(gp.state.points).toEqual([0, 0, 0, 0, 0, 0]);
});
