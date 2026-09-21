import { describe, expect, it, vi } from 'vitest';
import { ControllerHaptics } from '../src/input/haptics';
import { VehicleTelemetry } from '../src/vehicle/telemetry';
import { makePad } from './input-helpers';

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
  const query = vi.fn((x: number, z: number) => x === 42 && z === 17);
  const haptics = new ControllerHaptics({
    readTelemetry: () => telemetry,
    readActuator: () => state.actuator,
    readIntensity: () => state.intensity,
    readPaused: () => state.paused,
    isOnKerb: query,
  });
  return { telemetry, play, stop, state, query, haptics };
}

describe('controller feedback stays outside physics', () => {
  it('uses only grounded wheel contacts for kerbs, supports wheelspin, and rate limits browser calls', () => {
    const r = setup();
    r.telemetry.speed = 20;
    r.telemetry.wheels[0].contactPoint.set(42, 0, 17);
    r.haptics.afterStep(1 / 120);
    r.haptics.update(0);
    expect(r.query).not.toHaveBeenCalled();
    expect(r.play).not.toHaveBeenCalled();
    r.telemetry.wheels[0].grounded = true;
    r.haptics.afterStep(1 / 120);
    expect(r.play).not.toHaveBeenCalled();
    r.haptics.update(10);
    expect(r.play).toHaveBeenCalledTimes(1);
    expect(r.query).toHaveBeenCalledWith(42, 17);
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
    r.telemetry.wheels[0].contactPoint.set(0, 0, 0);
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
