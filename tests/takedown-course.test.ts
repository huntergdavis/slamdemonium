import { describe, expect, it } from 'vitest';
import { MAPS, isMapName } from '../src/world/maps';
import { rivalLineTarget, approachRivalLine } from '../src/world/rivals';
import {
  createTakedownMap,
  TAKEDOWN_ROAD_WIDTH,
} from '../src/world/takedownCourse';

describe('takedown course', () => {
  it('is a selectable, wide and sparse closed road with four rivals and shunt points', () => {
    const map = createTakedownMap();
    expect(isMapName('takedown')).toBe(true);
    expect(MAPS.takedown.name).toBe('takedown');
    expect(map.path?.closed).toBe(true);
    expect(map.path!.length).toBeGreaterThan(7000);
    expect(map.path!.length).toBeLessThan(7300);
    expect(
      map.runways.every((lane) => lane.width === TAKEDOWN_ROAD_WIDTH),
    ).toBe(true);
    expect(map.runways.every((lane) => lane.laneStripes?.length === 2)).toBe(
      true,
    );
    expect(map.traffic?.filter((car) => car.rival)).toHaveLength(4);
    expect(map.traffic!.length).toBeGreaterThan(40);
    expect(map.traffic!.length).toBeLessThan(65);
    expect(map.shuntWalls).toHaveLength(8);
    expect(map.placements!.length).toBeGreaterThan(400);
    expect(map.placements!.length).toBeLessThan(800);
    for (const wall of map.shuntWalls!) {
      expect(wall.halfExtents.z * 2).toBeGreaterThanOrEqual(70);
      expect(wall.center.y - wall.halfExtents.y).toBeCloseTo(0);
    }
  });

  it('aims a bounded nudge toward an alongside player and eases back', () => {
    const car = { x: -3.5, y: 1, z: 100 };
    const north = { x: 0, y: 0, z: 1 };
    const target = rivalLineTarget(car, north, { x: -10, y: 1, z: 104 });
    expect(target).toBe(-4.2);
    expect(rivalLineTarget(car, north, { x: -10, y: 1, z: 140 })).toBe(0);
    expect(approachRivalLine(0, target, 1 / 120)).toBeCloseTo(-6 / 120);
    expect(approachRivalLine(-4.2, 0, 1)).toBe(0);
  });
});
