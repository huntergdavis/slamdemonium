import { describe, expect, it } from 'vitest';
import type { BreakableProps } from '../src/world/breakableProps';
import {
  createPropStreamRecords,
  createPropStreamer,
} from '../src/world/propStreaming';

function seamProps(count: number) {
  const active = new Uint8Array(count);
  const destroyed = new Uint8Array(count);
  const live = Array.from({ length: count }, () => ({ x: 0, y: 0, z: 0 }));
  const props = {
    activate(index: number) {
      if (
        index < 0 ||
        index >= count ||
        active[index] !== 0 ||
        destroyed[index] !== 0
      )
        return false;
      active[index] = 1;
      live[index]!.x = index * 10;
      return true;
    },
    deactivate(index: number) {
      if (index < 0 || index >= count || active[index] === 0) return false;
      active[index] = 0;
      return true;
    },
    isActive: (index: number) => active[index] !== 0,
    isDestroyed: (index: number) => destroyed[index] !== 0,
    getActivePropPosition(
      index: number,
      out: { x: number; y: number; z: number },
    ) {
      if (index < 0 || index >= count || active[index] === 0) return false;
      Object.assign(out, live[index]);
      return true;
    },
    reset() {
      active.fill(0);
      destroyed.fill(0);
    },
  } as unknown as BreakableProps;
  return { props, active, destroyed, live };
}

const records = createPropStreamRecords([
  { position: { x: 0, y: 0.5, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
  { position: { x: 500, y: 0.5, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
]);

describe('streaming seams', () => {
  it('promotes on approach and demotes only after the exit radius', () => {
    const { props, active } = seamProps(records.length);
    const car = { x: -100, y: 0, z: 0 };
    const stream = createPropStreamer({
      props,
      records,
      readVehiclePosition: (out) => Object.assign(out, car),
      enterRadius: 50,
      exitRadius: 100,
    });
    expect(active[0]).toBe(0);
    car.x = 40;
    stream.update();
    expect(active[0]).toBe(1);
    car.x = 90;
    stream.update();
    expect(active[0]).toBe(1);
    car.x = 101;
    stream.update();
    expect(active[0]).toBe(0);
  });

  it('keeps a moved body resident when its authored pose is outside the exit radius', () => {
    const { props, active, live } = seamProps(records.length);
    const car = { x: 0, y: 0, z: 0 };
    const stream = createPropStreamer({
      props,
      records,
      readVehiclePosition: (out) => Object.assign(out, car),
      enterRadius: 50,
      exitRadius: 100,
    });
    live[0]!.x = 140;
    car.x = 140;
    stream.update();
    expect(active[0]).toBe(1);
  });

  it('keeps destroyed records absent across a boundary and clears them only on reset', () => {
    const { props, active, destroyed } = seamProps(records.length);
    const car = { x: 0, y: 0, z: 0 };
    const stream = createPropStreamer({
      props,
      records,
      readVehiclePosition: (out) => Object.assign(out, car),
      enterRadius: 50,
      exitRadius: 100,
    });
    destroyed[0] = 1;
    active[0] = 0;
    car.x = 500;
    stream.update();
    expect(active[1]).toBe(1);
    car.x = 0;
    stream.update();
    expect(active[0]).toBe(0);
    expect(stream.isFarVisible(0)).toBe(false);
    stream.reset();
    expect(active[0]).toBe(1);
    expect(stream.isFarVisible(0)).toBe(false);
  });
});
