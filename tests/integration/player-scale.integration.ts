import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { frame, HZ, scenario, SETTLE } from './scenarios';
import { runScript } from './runner';

/** The same scripted flat-road drive on main and on the larger player car. */
it('keeps the player car acceleration and both speed ceilings in the approved band', async () => {
  const profile = async (boost: boolean) => {
    const script = scenario(
      boost ? 'Player scale: sustained boost' : 'Player scale: unboosted',
      SETTLE + 30 * HZ,
      [frame(0), frame(SETTLE, { throttle: 1, boost })],
    );
    let to30: number | undefined;
    let ceiling = 0;
    await runScript(script, (vehicle, step) => {
      // Test-only full meter isolates the boosted drivetrain ceiling from
      // the unrelated question of how a lap earns boost.
      if (boost) vehicle.setDriftMeter(1);
      if (step <= SETTLE) return;
      const speed = vehicle.telemetry.speed;
      if (!to30 && speed >= 30) to30 = (step - SETTLE) / HZ;
      if (step > SETTLE + 25 * HZ) ceiling = Math.max(ceiling, speed);
    });
    expect(to30).toBeDefined();
    return { to30: to30!, ceiling };
  };
  const normal = await profile(false);
  const boosted = await profile(true);
  const measurement = { normal, boosted };
  mkdirSync('scratch', { recursive: true });
  writeFileSync(
    'scratch/a0p-player-profile.json',
    JSON.stringify(measurement, null, 2) + '\n',
  );
  // Measured on main at gravity 20 before scaling the player car.
  const mainTo30 = 2.408333333333333;
  const mainNormalCeiling = 59.999523;
  const mainBoostCeiling = 84.999161;
  expect(normal.to30).toBeGreaterThanOrEqual(mainTo30 * 0.95);
  expect(normal.to30).toBeLessThanOrEqual(mainTo30 * 1.05);
  expect(normal.ceiling).toBeGreaterThanOrEqual(mainNormalCeiling - 2);
  expect(normal.ceiling).toBeLessThanOrEqual(mainNormalCeiling + 2);
  expect(boosted.ceiling).toBeGreaterThanOrEqual(mainBoostCeiling - 2);
  expect(boosted.ceiling).toBeLessThanOrEqual(mainBoostCeiling + 2);
});
