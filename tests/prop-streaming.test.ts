import { describe, expect, it } from 'vitest';
import type { BreakableProps } from '../src/world/breakableProps';
import {
  createPropStreamRecords,
  createPropStreamer,
} from '../src/world/propStreaming';

function fakeProps(count: number) {
  const active = new Uint8Array(count);
  const destroyed = new Uint8Array(count);
  const live = Array.from({ length: count }, () => ({ x: 0, y: 0, z: 0 }));
  let activateCalls = 0;
  const props = {
    activate(index: number) {
      activateCalls++;
      if (index < 0 || index >= count || destroyed[index] || active[index])
        return false;
      active[index] = 1;
      live[index]!.x = index * 10;
      return true;
    },
    deactivate(index: number) {
      if (!active[index]) return false;
      active[index] = 0;
      return true;
    },
    isActive: (index: number) => active[index] !== 0,
    isDestroyed: (index: number) => destroyed[index] !== 0,
    getActivePropPosition(
      index: number,
      out: { x: number; y: number; z: number },
    ) {
      if (!active[index]) return false;
      const value = live[index]!;
      out.x = value.x;
      out.y = value.y;
      out.z = value.z;
      return true;
    },
    reset() {
      active.fill(0);
      destroyed.fill(0);
    },
  } as unknown as BreakableProps;
  return {
    props,
    active,
    destroyed,
    live,
    getActivateCalls: () => activateCalls,
  };
}

describe('phase-one prop streaming', () => {
  it('uses one authored record shape and promotes/demotes with hysteresis', () => {
    const records = createPropStreamRecords([
      {
        position: { x: 0, y: 0.5, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
      },
      {
        position: { x: 500, y: 0.5, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
      },
    ]);
    const { props, active } = fakeProps(records.length);
    const car = { x: 0, y: 0, z: 0 };
    const stream = createPropStreamer({
      props,
      records,
      readVehiclePosition: (out) => Object.assign(out, car),
      enterRadius: 10,
      exitRadius: 20,
    });
    expect(records[0]!.id).toBe('prop-0');
    expect(records[0]!.cellId).toBe(0);
    expect(stream.cells).toHaveLength(2);
    expect(active[0]).toBe(1);
    expect(active[1]).toBe(0);
    car.x = 30;
    stream.update();
    expect(active[0]).toBe(0);
    expect(stream.isFarVisible(0)).toBe(true);
  });

  it('keeps a moved active body promoted while the car remains near its live pose', () => {
    const records = createPropStreamRecords([
      {
        position: { x: 0, y: 0.5, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
      },
    ]);
    const { props, active, live } = fakeProps(records.length);
    const car = { x: 0, y: 0, z: 0 };
    const stream = createPropStreamer({
      props,
      records,
      readVehiclePosition: (out) => Object.assign(out, car),
      enterRadius: 10,
      exitRadius: 20,
    });
    live[0]!.x = 25;
    car.x = 25;
    stream.update();
    expect(active[0]).toBe(1);
  });

  it('does not resurrect a destroyed stable record at a boundary', () => {
    const records = createPropStreamRecords([
      {
        position: { x: 0, y: 0.5, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
      },
    ]);
    const { props, active, destroyed } = fakeProps(records.length);
    const car = { x: 0, y: 0, z: 0 };
    const stream = createPropStreamer({
      props,
      records,
      readVehiclePosition: (out) => Object.assign(out, car),
      enterRadius: 10,
      exitRadius: 20,
    });
    destroyed[0] = 1;
    active[0] = 0;
    car.x = 100;
    stream.update();
    expect(stream.isFarVisible(0)).toBe(false);
    car.x = 0;
    stream.update();
    expect(active[0]).toBe(0);
  });

  it('indexes sparse records by nearby cells instead of scanning the record set', () => {
    const records = createPropStreamRecords(
      Array.from({ length: 1000 }, (_, index) => ({
        position: { x: index * 1000, y: 0.5, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
      })),
      64,
    );
    const { props, active, getActivateCalls } = fakeProps(records.length);
    const car = { x: 0, y: 0, z: 0 };
    const stream = createPropStreamer({
      props,
      records,
      readVehiclePosition: (out) => Object.assign(out, car),
      enterRadius: 20,
      exitRadius: 40,
    });
    expect(active[0]).toBe(1);
    expect(getActivateCalls()).toBe(1);
    car.x = 500000;
    stream.update();
    expect(active[0]).toBe(0);
    expect(active[500]).toBe(1);
    expect(getActivateCalls()).toBe(2);
  });
});
