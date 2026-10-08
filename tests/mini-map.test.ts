import { describe, expect, it } from 'vitest';
import { MiniMap } from '../src/ui/miniMap';
import { VehicleTelemetry } from '../src/vehicle/telemetry';

/** A fake document: elements are plain records, the canvas hands back a 2D
 * context that records the path points the map draws. No DOM package here. */
function fakeDocument() {
  const calls: { op: string; x: number; y: number }[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get(_t, prop: string) {
      if (prop === 'moveTo' || prop === 'lineTo' || prop === 'arc')
        return (x: number, y: number) => calls.push({ op: prop, x, y });
      if (prop === 'fillText')
        return (_s: string, x: number, y: number) =>
          calls.push({ op: 'text', x, y });
      return () => undefined;
    },
    set() {
      return true;
    },
  });
  const element = (tag: string) => ({
    tag,
    className: '',
    dataset: {} as Record<string, string>,
    textContent: '',
    width: 0,
    height: 0,
    children: [] as unknown[],
    setAttribute() {},
    append(...nodes: unknown[]) {
      this.children.push(...nodes);
    },
    remove() {},
    getContext: () => ctx,
  });
  const doc = { createElement: element };
  const host = { ...element('div'), ownerDocument: doc };
  return { calls, host };
}

function mount(
  landmarks: { x: number; z: number }[] = [],
  route?: { x: number; z: number }[],
  rivals?: {
    position: { x: number; z: number };
    rival: boolean;
    wrecked: boolean;
  }[],
  options: {
    halfSize?: number;
    followPlayer?: boolean;
    headingUp?: boolean;
  } = {},
) {
  const { calls, host } = fakeDocument();
  const map = new MiniMap({
    host: host as unknown as HTMLElement,
    landmarks: landmarks.map((l) => ({ ...l, label: 'X', color: '#fff' })),
    halfSize: options.halfSize ?? 100,
    followPlayer: options.followPlayer ?? false,
    headingUp: options.headingUp ?? false,
    ...(route ? { route } : {}),
    ...(rivals ? { readRivals: () => rivals } : {}),
  });
  const canvas = host.children[0] as { children: { width: number }[] };
  return { map, calls, canvas: canvas.children[1]! };
}

describe('the mini-map axes', () => {
  it('scrolls a zoomed road under a fixed heading-up arrow while rivals hold a gap', () => {
    const rivals = [{ position: { x: 0, z: 40 }, rival: true, wrecked: false }];
    const route = [
      { x: 0, z: 0 },
      { x: 0, z: 100 },
      { x: 50, z: 100 },
    ];
    const { map, calls } = mount([], route, rivals, {
      halfSize: 200,
      followPlayer: true,
      headingUp: true,
    });
    const telemetry = new VehicleTelemetry();
    Object.assign(telemetry.rotation, { x: 0, y: 1, z: 0, w: 0 });
    const draw = () => {
      calls.length = 0;
      map.update(telemetry);
      const rival = calls.find((call) => call.op === 'arc')!;
      const bend = calls.find(
        (call) => call.op === 'lineTo' && Math.abs(call.x - 70) < 0.01,
      )!;
      const arrow = calls.filter((call) => call.op === 'moveTo').at(-1)!;
      return { rival, bend, arrow };
    };
    const before = draw();
    expect(before.rival.y).toBeCloseTo(74, 3);
    expect(before.arrow.y).toBeLessThan(90);
    telemetry.position.z = 20;
    rivals[0]!.position.z = 60; // Rubber-banded rival holds its gap.
    const after = draw();
    expect(after.rival.y).toBeCloseTo(before.rival.y, 3);
    expect(after.bend.y).toBeCloseTo(before.bend.y + 8, 3);
    expect(after.arrow.y).toBeCloseTo(before.arrow.y, 3);
  });

  it('moves rival dots across a fixed course overview as cars advance', () => {
    const rivals = [{ position: { x: 0, z: 20 }, rival: true, wrecked: false }];
    const { map, calls } = mount([], undefined, rivals);
    const telemetry = new VehicleTelemetry();
    map.update(telemetry);
    const before = calls.find((call) => call.op === 'arc')!;
    calls.length = 0;
    telemetry.position.z = 20;
    rivals[0]!.position.z = 40;
    map.update(telemetry);
    const after = calls.find((call) => call.op === 'arc')!;
    expect(after.y).toBeCloseTo(before.y - 16, 3);
  });

  // The world is y-up, right-handed, north is +z: a driver facing north has
  // +x on the LEFT. North up on the map therefore puts -x on the right. The
  // map once drew +x on the right and was mirrored for two days of builds.
  it('draws north up and the driver-facing-north left (+x) on the left', () => {
    const { map, calls, canvas } = mount([
      { x: 50, z: 0 },
      { x: 0, z: 50 },
    ]);
    map.update(undefined);
    const centre = canvas.width / 2;
    const arcs = calls.filter((c) => c.op === 'arc');
    expect(arcs[0]!.x).toBeLessThan(centre); // +x: left of centre.
    expect(arcs[0]!.y).toBeCloseTo(centre, 6);
    expect(arcs[1]!.y).toBeLessThan(centre); // +z (north): above centre.
    expect(arcs[1]!.x).toBeCloseTo(centre, 6);
  });

  it('moves the marker right when the car moves toward -x, and points the arrow the way the car faces', () => {
    const { map, calls, canvas } = mount();
    const centre = canvas.width / 2;
    const telemetry = new VehicleTelemetry();
    const marker = () => {
      calls.length = 0;
      map.update(telemetry);
      const tri = calls
        .filter((c) => c.op === 'moveTo' || c.op === 'lineTo')
        .slice(-3);
      const tip = tri[0]!;
      const base = {
        x: (tri[1]!.x + tri[2]!.x) / 2,
        y: (tri[1]!.y + tri[2]!.y) / 2,
      };
      return {
        tip,
        base,
        centre: { x: (tip.x + base.x) / 2, y: (tip.y + base.y) / 2 },
      };
    };
    // Facing north (+z): rotation y = 1 (heading pi about y), at the origin.
    Object.assign(telemetry.rotation, { x: 0, y: 1, z: 0, w: 0 });
    Object.assign(telemetry.position, { x: 0, y: 0.86, z: 0 });
    let m = marker();
    expect(m.centre.x).toBeCloseTo(centre, 3);
    expect(m.tip.y).toBeLessThan(m.base.y); // Arrow points up.
    // Turned right from north: facing -x. Heading pi/2 -> y = sin(pi/4), w = cos(pi/4).
    Object.assign(telemetry.rotation, {
      x: 0,
      y: Math.SQRT1_2,
      z: 0,
      w: Math.SQRT1_2,
    });
    m = marker();
    expect(m.tip.x).toBeGreaterThan(m.base.x); // Arrow points right.
    // And driving that way moves the marker right.
    Object.assign(telemetry.position, { x: -30, y: 0.86, z: 0 });
    const moved = marker();
    expect(moved.centre.x).toBeGreaterThan(m.centre.x);
    // Facing south (+z behind): identity rotation faces -z.
    Object.assign(telemetry.rotation, { x: 0, y: 0, z: 0, w: 1 });
    m = marker();
    expect(m.tip.y).toBeGreaterThan(m.base.y); // Arrow points down.
    // Facing +x (the driver's left when north): heading -pi/2.
    Object.assign(telemetry.rotation, {
      x: 0,
      y: -Math.SQRT1_2,
      z: 0,
      w: Math.SQRT1_2,
    });
    m = marker();
    expect(m.tip.x).toBeLessThan(m.base.x); // Arrow points left.
  });
});
