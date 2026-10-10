import { describe, expect, it } from 'vitest';
import {
  CRASH_BEST_KEY,
  CrashMode,
  crashMedal,
  crashVehicleValue,
} from '../src/core/crashMode';
import {
  CRASH_JUNCTION,
  crashJunctionTraffic,
  createCrashJunctionMap,
} from '../src/world/crashJunction';
import { CITY_CROSS_PATH, createCityMap } from '../src/world/cityCourse';
import { poseAt } from '../src/world/roadGenerator';

describe('Crash Junction', () => {
  it('opens two 180 m launch approaches to one protected intersection', () => {
    const south = createCrashJunctionMap('south');
    const west = createCrashJunctionMap('west');
    expect(CRASH_JUNCTION).toEqual({ x: 275, z: 0, reservedForCrash: true });
    expect(south.spawn).toMatchObject({ x: 280, z: -180 });
    expect(west.spawn).toMatchObject({ x: 95, z: -5 });
    expect(-Math.cos(south.spawn!.heading)).toBeCloseTo(1);
    expect(-Math.sin(west.spawn!.heading)).toBeCloseTo(1);
    for (const map of [south, west]) {
      expect(map.roadDecks).toEqual(createCityMap().roadDecks);
      expect(map.shuntWalls).toHaveLength(8);
      expect(map.traffic).toHaveLength(12);
      expect(map.runs).toEqual([]);
      expect(Math.hypot(map.spawn!.x - 275, map.spawn!.z)).toBeGreaterThan(170);
    }
  });

  it('starts 12 authored cars in four distinct streams, outside the open throat', () => {
    const path = createCityMap().path!;
    const records = crashJunctionTraffic(path, 'south');
    const positions = records.map((car) =>
      poseAt(car.path ?? path, car.station),
    );
    expect(records.filter((car) => car.path === CITY_CROSS_PATH)).toHaveLength(
      6,
    );
    expect(records.filter((car) => car.path === path)).toHaveLength(6);
    for (const car of positions)
      expect(Math.hypot(car.x - 275, car.z)).toBeGreaterThan(60);
    for (let a = 0; a < positions.length; a++)
      for (let b = a + 1; b < positions.length; b++)
        expect(
          Math.hypot(
            positions[a]!.x - positions[b]!.x,
            positions[a]!.z - positions[b]!.z,
          ),
        ).toBeGreaterThan(7);
  });

  it('scores direct and transitive wrecks once by encounter, never ambient wrecks', () => {
    const game = new CrashMode();
    game.step(3);
    game.notePlayerContact(1);
    game.noteCarContact(1, 2);
    game.noteCarContact(2, 3);
    expect(game.noteWreck({ id: 1, modelKind: 'sedan' })).toBe(500);
    expect(game.noteWreck({ id: 2, modelKind: 'van' })).toBe(750);
    expect(game.noteWreck({ id: 3, modelKind: 'boxTruck' })).toBe(1000);
    expect(game.noteWreck({ id: 3, modelKind: 'boxTruck' })).toBe(0);
    expect(game.noteWreck({ id: 4, modelKind: 'bus' })).toBe(0);
    expect(game.state.damage).toBe(2250);
    expect(game.awards.map((award) => award.cause)).toEqual([
      'player',
      'chain',
      'chain',
      'ambient',
    ]);
    expect(game.state.wrecks).toBe(3);
    expect(game.notePropBreak(9, true)).toBe(100);
    expect(game.notePropBreak(9, true)).toBe(0);
  });

  it('ends after two quiet seconds or a 15-second wall cap and saves a versioned best', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
    const game = new CrashMode(storage);
    game.step(3);
    game.notePlayerContact(1);
    game.noteWreck({ id: 1, modelKind: 'bus' });
    game.notePlayerWreck();
    game.step(2.5, true);
    expect(game.state.phase).toBe('settling');
    game.step(1.99);
    expect(game.state.phase).toBe('settling');
    game.step(0.02);
    expect(game.state.phase).toBe('finished');
    expect(values.get(CRASH_BEST_KEY)).toBe('1000');
    game.reset();
    game.step(3);
    game.notePlayerWreck();
    game.advanceWall(15);
    expect(game.state.phase).toBe('finished');
    expect(game.state.best).toBe(1000);
  });

  it('keeps the published vehicle values and medal boundaries', () => {
    expect(crashVehicleValue('hatch')).toBe(500);
    expect(crashVehicleValue('pickup')).toBe(750);
    expect(crashVehicleValue('bus')).toBe(1000);
    expect([1999, 2000, 4000, 8000].map(crashMedal)).toEqual([
      'none',
      'bronze',
      'silver',
      'gold',
    ]);
  });
});
