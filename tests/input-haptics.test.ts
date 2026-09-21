import { describe, expect, it, vi } from 'vitest';
import { ControllerHaptics } from '../src/input/haptics';
import { VehicleTelemetry } from '../src/vehicle/telemetry';
import { makePad } from './input-helpers';
import { Scene } from 'three';
import { SURFACE_IDS } from '../src/content/surfaces';
import { createTestTrack, resolveTrackConfig } from '../src/world/track';
import { createTrackLayout } from '../src/world/trackLayout';

function setup() {
  const telemetry = new VehicleTelemetry();
  const play = vi.fn<GamepadHapticActuator['playEffect']>(
    async () => 'complete',
  );
  const stop = vi.fn<GamepadHapticActuator['reset']>(async () => 'complete');
  const actuator = {
    ...makePad().vibrationActuator,
    playEffect: play,
    reset: stop,
  };
  const state = {
    intensity: 0.35,
    paused: false,
    actuator: actuator as GamepadHapticActuator | null,
  };
  const haptics = new ControllerHaptics({
    readTelemetry: () => telemetry,
    readActuator: () => state.actuator,
    readIntensity: () => state.intensity,
    readPaused: () => state.paused,
  });
  return { telemetry, play, stop, state, haptics };
}

describe('controller feedback stays outside physics', () => {
  it('uses only grounded wheel contacts for kerbs, supports wheelspin, and rate limits browser calls', () => {
    const r = setup();
    r.telemetry.speed = 20;
    r.telemetry.wheels[0].surfaceId = SURFACE_IDS.kerb;
    r.haptics.afterStep(1 / 120);
    r.haptics.update(0);
    expect(r.play).not.toHaveBeenCalled();
    r.telemetry.wheels[0].grounded = true;
    r.haptics.afterStep(1 / 120);
    expect(r.play).not.toHaveBeenCalled();
    r.haptics.update(10);
    expect(r.play).toHaveBeenCalledTimes(1);
    const first = { ...r.play.mock.calls[0]?.[1] };
    expect(first).toMatchObject({
      duration: 80,
      startDelay: 0,
      strongMagnitude: 0,
    });
    expect(first.weakMagnitude).toBeGreaterThan(0);
    expect(first.weakMagnitude).toBeLessThanOrEqual(0.35);
    r.haptics.update(30);
    expect(r.play).toHaveBeenCalledTimes(1);
    r.telemetry.wheels[0].surfaceId = SURFACE_IDS.asphalt;
    r.telemetry.wheels[0].spinning = true;
    r.haptics.afterStep(1 / 120);
    r.haptics.update(60);
    expect(r.play).toHaveBeenCalledTimes(2);
    expect(r.play.mock.calls[1]?.[1]?.weakMagnitude).toBeCloseTo(0.105);
  });

  it('zero intensity, pause, disconnect and disposal cancel vibration and prevent further effects', () => {
    const r = setup();
    r.telemetry.velocity.set(0, 0, -20);
    const start = (now: number) => {
      r.haptics.onImpact(null, { x: 0, y: 0, z: 1 }, 1300);
      r.haptics.update(now);
    };
    start(0);
    expect(r.play).toHaveBeenCalledTimes(1);
    r.state.intensity = 0;
    r.haptics.update(60);
    expect(r.stop).toHaveBeenCalledTimes(1);
    expect(r.haptics.state.status).toBe('off');
    r.haptics.update(120);
    expect(r.play).toHaveBeenCalledTimes(1);
    r.state.intensity = 0.35;
    start(180);
    r.state.paused = true;
    r.haptics.update(240);
    expect(r.stop).toHaveBeenCalledTimes(2);
    r.state.paused = false;
    start(300);
    r.state.actuator = null;
    r.haptics.update(360);
    expect(r.stop).toHaveBeenCalledTimes(3);
    expect(r.haptics.state.status).toBe('unavailable');
    r.state.actuator = makePad().vibrationActuator;
    r.haptics.dispose();
    start(420);
    expect(r.play).toHaveBeenCalledTimes(3);
  });

  it('estimates approach only toward the oriented contact normal and copies no borrowed normal', () => {
    const r = setup();
    r.telemetry.velocity.set(0, 0, 20);
    const normal = { x: 0, y: 0, z: 1 };
    r.haptics.onImpact(null, normal, 1300);
    r.haptics.update(0);
    expect(r.play).not.toHaveBeenCalled(); // moving away
    normal.z = -1;
    r.haptics.onImpact(null, normal, 1300);
    normal.z = 1;
    r.telemetry.velocity.set(0, 0, 0);
    r.haptics.update(60);
    expect(r.play.mock.calls[0]?.[1]?.strongMagnitude).toBeCloseTo(0.35);
    r.haptics.reset();
    r.haptics.update(120);
    expect(r.stop).toHaveBeenCalledTimes(1);
  });

  it('handles rejected/unsupported hardware without unhandled rejections or retry floods', async () => {
    const r = setup();
    r.play.mockRejectedValue(new Error('Unsupported'));
    r.telemetry.velocity.z = -20;
    r.haptics.onImpact(null, { x: 0, y: 0, z: 1 }, 1300);
    r.haptics.update(0);
    await Promise.resolve();
    expect(r.haptics.state.status).toBe('error');
    r.haptics.update(100);
    expect(r.play).toHaveBeenCalledTimes(1);
    r.state.actuator = null;
    r.haptics.update(200);
    expect(r.haptics.state.status).toBe('unavailable');
  });
});

describe('F0 preserves shipped kerb haptics on the current ground', () => {
  it('matches the old footprint and pulse at every rendered segment, inclusive corner, seam and just-outside edge', () => {
    const r = setup();
    const config = resolveTrackConfig();
    const track = createTestTrack(new Scene(), {
      maxAnisotropy: 1,
      asphalt: { size: 128 },
    });
    const resolver = track.createSurfaceResolver({
      ground: 11,
      barriers: Array.from(
        { length: config.barrierSegments },
        (_, index) => index + 12,
      ),
    });
    const wheel = r.telemetry.wheels[0];
    const hit = {
      bodyId: 11,
      surfaceId: 0,
      distance: 1,
      point: { x: 0, y: 0, z: 0 },
      normal: { x: 0, y: 1, z: 0 },
    };
    r.telemetry.speed = 20;
    wheel.grounded = true;
    const dt = 1 / 120;
    const previousPulse =
      (0.25 + 0.2 * Math.sin(dt * 24 * Math.PI * 2) ** 2) * 0.35;
    let checked = 0;
    for (const box of createTrackLayout(config).curbs) {
      for (const [dx, dz] of [
        [0, 0],
        [-box.size.x / 2, -box.size.z / 2],
        [box.size.x / 2, box.size.z / 2],
        [box.size.x / 2 + 0.001, 0],
        [0, box.size.z / 2 + 0.001],
      ]) {
        hit.point.x =
          box.center.x + Math.cos(box.rotY) * dx! + Math.sin(box.rotY) * dz!;
        hit.point.z =
          box.center.z - Math.sin(box.rotY) * dx! + Math.cos(box.rotY) * dz!;
        const legacyKerb = track.isOnKerb(hit.point.x, hit.point.z);
        wheel.surfaceId = resolver(true, hit);
        r.haptics.reset();
        r.play.mockClear();
        r.haptics.afterStep(dt);
        r.haptics.update(0);
        expect(r.play.mock.calls.length > 0).toBe(legacyKerb);
        if (legacyKerb)
          expect(r.play.mock.calls[0]![1].weakMagnitude).toBeCloseTo(
            previousPulse,
            12,
          );
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(4000);
    track.dispose();
  });

  it('never turns stale, unknown or contact-only canonical IDs into kerb feedback', () => {
    const r = setup();
    r.telemetry.speed = 20;
    const wheel = r.telemetry.wheels[0];
    wheel.grounded = false;
    wheel.surfaceId = SURFACE_IDS.kerb;
    r.haptics.afterStep(1 / 120);
    r.haptics.update(0);
    expect(r.play).not.toHaveBeenCalled();
    wheel.grounded = true;
    for (const surfaceId of [null, SURFACE_IDS.concrete, SURFACE_IDS.asphalt]) {
      wheel.surfaceId = surfaceId;
      r.haptics.afterStep(1 / 120);
      r.haptics.update(60);
      expect(r.play).not.toHaveBeenCalled();
    }
    wheel.surfaceId = SURFACE_IDS.kerb;
    r.telemetry.speed = 0.5;
    r.haptics.afterStep(1 / 120);
    r.haptics.update(120);
    expect(r.play).not.toHaveBeenCalled();
  });
});
