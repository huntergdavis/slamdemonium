import { describe, expect, it } from 'vitest';
import { createAwakeBudget } from '../src/world/awakeBudget';

/** A fake world of props on a line along +x from the car at the origin. */
function rig(
  positions: { x: number; y?: number; speed?: number }[],
  fragments = 0,
) {
  const awake = new Set<number>(positions.map((_, i) => i + 1));
  const slept: number[] = [];
  const physics = {
    awakeBodyCount: () => awake.size + 1, // + the car
    isBodyAwake: (id: number) => awake.has(id),
    sleepBody: (id: number) => {
      awake.delete(id);
      slept.push(id);
    },
    getTransform: (id: number, out: { x: number; y: number; z: number }) => {
      const p = positions[id - 1]!;
      out.x = p.x;
      out.y = p.y ?? 0.5;
      out.z = 0;
    },
    getLinearVelocity: (
      id: number,
      out: { x: number; y: number; z: number },
    ) => {
      out.x = positions[id - 1]!.speed ?? 0;
      out.y = 0;
      out.z = 0;
    },
  };
  const propCount = positions.length - fragments;
  const props = {
    propCapacity: 64,
    fragmentCapacity: 64,
    propHalfExtents: { x: 0.5, y: 0.5, z: 0.5 },
    fragmentHalfExtents: { x: 0.2, y: 0.2, z: 0.2 },
    copyActivePropIds(out: Float64Array) {
      for (let i = 0; i < propCount; i++) out[i] = i + 1;
      return propCount;
    },
    copyActiveFragmentIds(out: Float64Array) {
      for (let i = 0; i < fragments; i++) out[i] = propCount + i + 1;
      return fragments;
    },
  };
  const budget = createAwakeBudget({
    physics,
    props,
    readVehiclePosition: (out) => Object.assign(out, { x: 0, y: 0.86, z: 0 }),
  });
  return { budget, slept, awake };
}

describe('the awake-body budget', () => {
  it('does nothing while under budget, and never counts the car', () => {
    const { budget, slept } = rig([{ x: 5 }, { x: 10 }, { x: 15 }]);
    expect(budget.update(3, 30)).toBe(0);
    expect(budget.awake).toBe(3);
    expect(slept).toEqual([]);
  });

  it('over budget, sleeps every grounded body beyond the keep radius as one block, and nothing inside it', () => {
    const { budget, slept, awake } = rig([
      { x: 5 },
      { x: 60 },
      { x: 40 },
      { x: 90 },
      { x: 35 },
      { x: 29 },
    ]);
    expect(budget.update(2, 30)).toBe(4);
    expect(new Set(slept)).toEqual(new Set([2, 3, 4, 5])); // 60, 40, 90, 35 m
    expect(awake.size).toBe(2); // 5 m and 29 m stay: the crash in front plays out.
    expect(budget.slept).toBe(4);
    expect(budget.nearestSleptDistance).toBe(35);
  });

  it('is the block, not the excess: one over budget still freezes the whole far group, because a thin shell does not stick', () => {
    const { budget, slept } = rig([{ x: 5 }, { x: 40 }, { x: 45 }, { x: 50 }]);
    expect(budget.update(3, 30)).toBe(3);
    expect(slept).toHaveLength(3);
  });

  it('cannot bound a crash that is all inside the keep radius, and says so through awake', () => {
    const { budget, slept } = rig([{ x: 5 }, { x: 12 }, { x: 20 }, { x: 25 }]);
    expect(budget.update(1, 30)).toBe(0);
    expect(slept).toEqual([]);
    expect(budget.awake).toBe(4);
  });

  it('leaves bodies still moving hard awake, and treats a box resting on a box as still', () => {
    const { budget, slept } = rig([
      { x: 5 },
      { x: 100, y: 3, speed: 12 }, // In flight: not frozen.
      { x: 50, y: 1.5 }, // On top of another box, at rest: sleeps with the block.
      { x: 45 },
    ]);
    expect(budget.update(1, 30)).toBe(2);
    expect(new Set(slept)).toEqual(new Set([3, 4]));
  });

  it('counts fragments with the props', () => {
    const { budget, slept } = rig([{ x: 5 }, { x: 40 }, { x: 70, y: 0.2 }], 1);
    expect(budget.update(1, 30)).toBe(2);
    expect(new Set(slept)).toEqual(new Set([2, 3]));
  });
});
