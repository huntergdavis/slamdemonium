import { expect, it } from 'vitest';
import handbrakeTurn from '../src/input/examples/handbrake-turn.json';
import { scriptVehicleHarness } from './scriptVehicleHarness';

it('pause preserves replay determinism without input leakage or elapsed-time catch-up', async () => {
  const rig = await scriptVehicleHarness();
  try {
    rig.scripts.load(handbrakeTurn, { tuning: 'apply' });
    rig.loop.stepMany(270);
    while (
      rig.scripts.progress().completedSteps < 330 &&
      Math.abs(rig.vehicle.telemetry.beta) < 0.1
    )
      rig.loop.stepMany(1);
    expect(Math.abs(rig.vehicle.telemetry.beta)).toBeGreaterThanOrEqual(0.1);
    const before = rig.scripts.result();
    const time = rig.loop.simulationSeconds;
    rig.loop.setPaused(true);
    rig.setPad({
      throttle: 1,
      brake: 1,
      steer: -1,
      handbrake: true,
      boost: true,
      source: 'gamepad',
    });
    for (const timestamp of [60_000, 120_000, 300_000]) {
      rig.mapper.sampleActions();
      rig.loop.frame(timestamp);
    }
    expect(rig.scripts.result()).toEqual(before);
    expect(rig.loop.simulationSeconds).toBe(time);
    rig.loop.setPaused(false);
    rig.loop.frame(600_000);
    expect(rig.scripts.result()).toEqual(before);
    rig.loop.frame(600_000 + 1000 / 120);
    expect(rig.scripts.progress().completedSteps).toBe(
      before.completedSteps + 1,
    );
    expect(rig.loop.simulationSeconds - time).toBeCloseTo(1 / 120);
    rig.loop.stepMany(
      handbrakeTurn.durationSteps - rig.scripts.progress().completedSteps,
    );
    const interrupted = rig.scripts.result();
    rig.scripts.load(handbrakeTurn, { tuning: 'verify' });
    rig.loop.stepMany(handbrakeTurn.durationSteps);
    expect(interrupted.completedSteps).toBe(handbrakeTurn.durationSteps);
    expect(interrupted.allFinite).toBe(true);
    expect(interrupted).toEqual(rig.scripts.result());
  } finally {
    rig.dispose();
  }
}, 60_000);
