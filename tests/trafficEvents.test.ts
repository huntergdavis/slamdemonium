import { describe, expect, it } from 'vitest';
import {
  EVENT_LABEL_SECONDS,
  PLAYER_HALF_WIDTH,
  createTrafficEvents,
  type PlayerView,
  type TrafficCarView,
} from '../src/core/trafficEvents';
import { carHalfWidth } from '../src/world/carModels';

const DT = 1 / 120;
const TUNING = {
  nearMissGap: 1.5,
  nearMissClosing: 12,
  nearMissBoost: 0.1,
  wrongSideReach: 60,
  wrongSideRate: 0.08,
  slamBoost: 0.35,
};
/** A player heading north (+z) at `speed`, from z = 0. */
const player = (z: number, speed: number, x = 0): PlayerView => ({
  position: { x, z },
  forward: { x: 0, z: 1 },
  velocity: { x: 0, z: speed },
  speed,
});
const car = (
  id: number,
  x: number,
  z: number,
  vz: number,
  wrecked = false,
): TrafficCarView => ({
  id,
  bodyId: 100 + id,
  position: { x, z },
  forward: { x: 0, z: Math.sign(vz) || 1 },
  velocity: { x: 0, z: vz },
  wrecked,
});

/** Drives the player north at `speed` past a car at lateral offset `x`
 * moving at `vz`, for `seconds`; returns the bar granted in total. */
function pass(
  events = createTrafficEvents(),
  { x = 3, vz = 20, speed = 40, seconds = 6, wrecked = false } = {},
) {
  let total = 0;
  for (let step = 0; step < seconds * 120; step++) {
    const t = step * DT;
    total += events.update(
      DT,
      player(-60 + speed * t, speed),
      [car(1, x, 20 + vz * t, vz, wrecked)],
      TUNING,
    );
  }
  return { events, total };
}

describe('traffic events', () => {
  it('pays one near miss for a close, fast pass and nothing for a wide or slow one', () => {
    const close = pass(); // Centre gap 3 m: edge gap about 1 m at 20 m/s closing.
    expect(close.events.state.nearMisses).toBe(1);
    expect(close.total).toBeCloseTo(TUNING.nearMissBoost, 9);
    expect(close.events.state.lastEvent).toBe('near-miss');
    const wide = pass(undefined, {
      x: PLAYER_HALF_WIDTH + carHalfWidth('sedan') + 1.6,
    });
    expect(wide.events.state.nearMisses).toBe(0);
    expect(wide.total).toBe(0);
    const slow = pass(undefined, { speed: 30, vz: 20 }); // 10 m/s closing.
    expect(slow.events.state.nearMisses).toBe(0);
    const wreck = pass(undefined, { wrecked: true });
    expect(wreck.events.state.nearMisses).toBe(0);
    // A bus is wider than a sedan: the same centre distance is a near miss
    // for the bus and not for the sedan.
    const line = PLAYER_HALF_WIDTH + carHalfWidth('sedan') + 1.6;
    const sedanWide = pass(undefined, { x: line });
    expect(sedanWide.events.state.nearMisses).toBe(0);
    const bus = createTrafficEvents();
    for (let step = 0; step < 6 * 120; step++) {
      const t = step * DT;
      bus.update(
        DT,
        player(-60 + 40 * t, 40),
        [{ ...car(1, line, 20 + 20 * t, 20), modelKind: 'bus' }],
        TUNING,
      );
    }
    expect(bus.state.nearMisses).toBe(1);
  });
  it('re-arms a near miss only once the car is far away again, and the label fades', () => {
    const events = createTrafficEvents();
    const first = pass(events);
    expect(first.events.state.nearMisses).toBe(1);
    expect(events.state.labelSeconds).toBeLessThan(EVENT_LABEL_SECONDS);
    // Same car, second pass from far away: a new pass.
    for (let step = 0; step < 240; step++)
      events.update(DT, player(1000, 40), [car(1, 3, 0, 0)], TUNING);
    expect(events.state.labelSeconds).toBe(0);
    pass(events);
    expect(events.state.nearMisses).toBe(2);
  });
  it('voids the near miss when the player touched the car, and pays the slam once per episode by severity', () => {
    const events = createTrafficEvents();
    let total = 0;
    for (let step = 0; step < 6 * 120; step++) {
      const t = step * DT;
      const p = player(-60 + 40 * t, 40);
      const c = car(1, 3, 20 + 20 * t, 20);
      if (Math.abs(p.position.z - c.position.z) < 2) {
        events.noteContact(c.bodyId, 0.6);
        events.noteContact(c.bodyId, 0.8); // The same step keeps the harder reading.
      }
      total += events.update(DT, p, [c], TUNING);
    }
    expect(events.state.nearMisses).toBe(0);
    expect(events.state.slams).toBe(1);
    expect(total).toBeCloseTo(TUNING.slamBoost * 0.8, 9);
    expect(events.state.lastEvent).toBe('slam');
    // A second contact episode after a quiet second pays again.
    for (let step = 0; step < 150; step++)
      events.update(DT, player(500, 40), [car(1, 3, 0, 0)], TUNING);
    events.noteContact(101, 1);
    expect(
      events.update(DT, player(500, 40), [car(1, 3, 0, 0)], TUNING),
    ).toBeCloseTo(TUNING.slamBoost, 9);
    expect(events.state.slams).toBe(2);
  });
  it('pays the hit that wrecks a car, and ignores a car that was already a wreck or is not listed', () => {
    const events = createTrafficEvents();
    events.noteContact(999, 1);
    expect(events.update(DT, player(0, 40), [], TUNING)).toBe(0);
    // Driving one step, then the hit wrecks it in the same step: a slam.
    events.update(DT, player(0, 40), [car(1, 3, 10, 20)], TUNING);
    events.noteContact(101, 1);
    expect(
      events.update(DT, player(0, 40), [car(1, 3, 10, 0, true)], TUNING),
    ).toBeCloseTo(TUNING.slamBoost, 9);
    expect(events.state.slams).toBe(1);
    // A second later it is scenery: hitting it again pays nothing.
    for (let step = 0; step < 150; step++)
      events.update(DT, player(0, 40), [car(1, 3, 10, 0, true)], TUNING);
    events.noteContact(101, 1);
    expect(
      events.update(DT, player(0, 40), [car(1, 3, 10, 0, true)], TUNING),
    ).toBe(0);
    expect(events.state.slams).toBe(1);
    // A car first seen as a wreck never pays.
    events.noteContact(102, 1);
    expect(
      events.update(DT, player(0, 40), [car(2, 3, 10, 0, true)], TUNING),
    ).toBe(0);
    expect(events.state.slams).toBe(1);
  });
  it('pays wrong-side driving per second only with an oncoming car ahead in the lane line, at speed', () => {
    const events = createTrafficEvents();
    const oncoming = car(2, 0, 50, -20); // 50 m ahead, heading south.
    let total = 0;
    for (let step = 0; step < 120; step++)
      total += events.update(DT, player(0, 30), [oncoming], TUNING);
    expect(events.state.oncoming).toBe(true);
    expect(events.state.wrongSideSeconds).toBeCloseTo(1, 6);
    expect(total).toBeCloseTo(TUNING.wrongSideRate, 6);
    expect(events.state.lastEvent).toBe('oncoming');
    // Too slow, too far, beside the line, or going the same way: nothing.
    expect(events.update(DT, player(0, 10), [oncoming], TUNING)).toBe(0);
    expect(events.update(DT, player(0, 30), [car(2, 0, 80, -20)], TUNING)).toBe(
      0,
    );
    expect(events.update(DT, player(0, 30), [car(2, 6, 50, -20)], TUNING)).toBe(
      0,
    );
    expect(events.update(DT, player(0, 30), [car(2, 0, 50, 20)], TUNING)).toBe(
      0,
    );
    expect(events.state.oncoming).toBe(false);
  });
  it('pays no near miss to a parked player, however close and fast the traffic passes', () => {
    const events = createTrafficEvents();
    let total = 0;
    for (let step = 0; step < 4 * 120; step++) {
      const t = step * DT;
      // The player sits still; a car streams past 2.5 m away at 24 m/s.
      total += events.update(
        DT,
        player(0, 0),
        [car(1, 2.5, -40 + 24 * t, 24)],
        TUNING,
      );
    }
    expect(total).toBe(0);
    expect(events.state.nearMisses).toBe(0);
    // Rolling slowly is still parked for this purpose; at speed it counts.
    for (let step = 0; step < 4 * 120; step++) {
      const t = step * DT;
      total += events.update(
        DT,
        player(0, 10),
        [car(2, 2.5, -40 + 24 * t, 24)],
        TUNING,
      );
    }
    expect(events.state.nearMisses).toBe(0);
    for (let step = 0; step < 4 * 120; step++) {
      const t = step * DT;
      total += events.update(
        DT,
        player(0, 20),
        [car(3, 2.5, -60 + 24 * t, 24)],
        TUNING,
      );
    }
    expect(events.state.nearMisses).toBe(0); // Same direction, closing 4 m/s: no.
    for (let step = 0; step < 4 * 120; step++) {
      const t = step * DT;
      total += events.update(
        DT,
        player(0, 20),
        [car(4, 2.5, 60 - 24 * t, -24)],
        TUNING,
      );
    }
    expect(events.state.nearMisses).toBe(1); // Oncoming at 44 m/s closing, moving: yes.
    // Being rammed while parked pays nothing either.
    const parked = createTrafficEvents();
    parked.update(DT, player(0, 0), [car(5, 0, -5, 24)], TUNING);
    parked.noteContact(105, 1);
    expect(parked.update(DT, player(0, 0), [car(5, 0, -1, 24)], TUNING)).toBe(
      0,
    );
    expect(parked.state.slams).toBe(0);
  });
  it('keeps a near miss on the label through continuous oncoming traffic', () => {
    const events = createTrafficEvents();
    let firedAt = -1;
    // Oncoming car ahead in the lane line the whole time; a second car
    // passes close at speed.
    for (let step = 0; step < 480; step++) {
      const t = step * DT;
      events.update(
        DT,
        player(0, 30),
        [car(2, 0, 50, -20), car(3, 2.5, 20 - 24 * t, -24)],
        TUNING,
      );
      if (events.state.nearMisses === 1 && firedAt < 0) firedAt = t;
      if (firedAt >= 0 && t - firedAt < 1.1)
        expect(events.state.lastEvent).toBe('near-miss');
    }
    expect(events.state.nearMisses).toBe(1);
    expect(events.state.lastEvent).toBe('oncoming'); // After the hold, oncoming again.
  });
  it('reset clears everything', () => {
    const { events } = pass();
    events.reset();
    expect(events.state).toMatchObject({
      nearMisses: 0,
      slams: 0,
      wrongSideSeconds: 0,
      lastEvent: null,
      grant: 0,
    });
  });
});
