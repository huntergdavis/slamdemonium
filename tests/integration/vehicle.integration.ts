import { afterAll, expect, it } from 'vitest';
import { HZ, SETTLE, frame, scenario, randomScenario } from './scenarios';
import {
  measurements,
  runScript,
  StateHash,
  writeMeasurements,
} from './runner';

afterAll(writeMeasurements);

it('turns left under handbrake, lowers rear grip, and recovers grip after release', async () => {
  const turnStep = SETTLE + 3 * HZ,
    releaseStep = turnStep + HZ / 2;
  const script = scenario('Handbrake turn', releaseStep + 2 * HZ, [
    frame(0),
    frame(SETTLE, { throttle: 1 }),
    frame(turnStep, { throttle: 0.3, steer: 0.6, handbrake: true }),
    frame(releaseStep, { throttle: 0.3, steer: 0.6 }),
  ]);
  let lockedSteps = 0,
    minimumRearGrip = 1,
    finalRearGrip = 0;
  const run = await runScript(script, (vehicle, step) => {
    if (step > turnStep && step <= releaseStep) {
      minimumRearGrip = Math.min(minimumRearGrip, vehicle.controls.rearGrip);
      if (
        vehicle.telemetry.wheels[2].locked &&
        vehicle.telemetry.wheels[3].locked
      )
        lockedSteps++;
    }
    finalRearGrip = vehicle.controls.rearGrip;
  });
  measurements.handbrake = {
    ...run,
    lockedSteps,
    minimumRearGrip,
    finalRearGrip,
  };
  expect(minimumRearGrip).toBeCloseTo(script.tuning.handbrakeRearGrip, 8);
  expect(finalRearGrip).toBeCloseTo(1, 8);
  expect(lockedSteps).toBeGreaterThan(HZ / 4);
  expect(run.result.peakAbsSlideAngle).toBeGreaterThan(0.2);
  expect(run.result.finalPose.position.x).toBeLessThan(-1);
});

it('hashes every completed state identically for the same seeded script', async () => {
  const script = randomScenario(30, 0x51a7);
  const hashes: string[] = [],
    runs = [];
  for (let run = 0; run < 2; run++) {
    const hash = new StateHash();
    runs.push(
      await runScript(script, (vehicle, step) => hash.record(vehicle, step)),
    );
    hashes.push(hash.digest());
  }
  const changed = new StateHash();
  await runScript(randomScenario(30, 0x51a8), (vehicle, step) =>
    changed.record(vehicle, step),
  );
  const differentSeedHash = changed.digest();
  measurements.determinism = {
    seed: script.seed,
    stepsPerRun: script.durationSteps,
    hashes,
    differentSeedHash,
    runs,
  };
  expect(hashes[0]).toMatch(/^[0-9a-f]{64}$/);
  expect(hashes[0]).toBe(hashes[1]);
  expect(differentSeedHash).not.toBe(hashes[0]);
});

it('survives 300 simulated seconds of seeded input with finite bounded state', async () => {
  // Design 13.2: exactly 300 simulated seconds, not a wall-clock soak.
  const script = randomScenario(300, 0x51a7);
  let observedSteps = 0;
  const run = await runScript(script, () => {
    observedSteps++;
  });
  measurements.soak = {
    ...run,
    seed: script.seed,
    simulatedSeconds: script.durationSteps / HZ,
    observedSteps,
  };
  expect(observedSteps).toBe(300 * HZ);
  expect(run.result.allFinite).toBe(true);
  expect(run.result.peakSpeed).toBeGreaterThan(5); // A motionless replay cannot satisfy the soak.
});

it('never gains speed while coasting with the filtered throttle fully released', async () => {
  const coastStep = SETTLE + 5 * HZ;
  const script = scenario('Flat-ground coast energy', coastStep + 10 * HZ, [
    frame(0),
    frame(SETTLE, { throttle: 1 }),
    frame(coastStep),
  ]);
  let previousSpeed: number | undefined,
    startSpeed = 0,
    endSpeed = 0,
    worstIncrease = -Infinity,
    samples = 0;
  const run = await runScript(script, (vehicle, step) => {
    // Raw pedal zero is not yet zero engine force: honor the documented throttleFallTime ramp.
    if (step <= coastStep || vehicle.controls.throttle !== 0) return;
    const speed = vehicle.telemetry.speed;
    if (previousSpeed === undefined) startSpeed = speed;
    else {
      worstIncrease = Math.max(worstIncrease, speed - previousSpeed);
      samples++;
    }
    previousSpeed = endSpeed = speed;
  });
  measurements.energy = {
    ...run,
    startSpeed,
    endSpeed,
    worstIncrease,
    samples,
  };
  expect(startSpeed).toBeGreaterThan(30);
  expect(samples).toBeGreaterThan(9 * HZ);
  // Float32 velocity quantization allowance, not a permitted sustained energy gain.
  expect(worstIncrease).toBeLessThanOrEqual(1e-4);
  expect(endSpeed).toBeLessThan(startSpeed * 0.9);
});

it('accelerates straight ahead within the appendix A default targets', async () => {
  const script = scenario('Straight-line acceleration', SETTLE + 12 * HZ, [
    frame(0),
    frame(SETTLE, { throttle: 1 }),
  ]);
  let to100 = 0,
    to55 = 0,
    maxLateralOffset = 0;
  const run = await runScript(script, (vehicle, step) => {
    if (step <= SETTLE) return;
    const s = vehicle.telemetry;
    if (!to100 && s.speed >= 100 / 3.6) to100 = (step - SETTLE) / HZ;
    if (!to55 && s.speed >= 55) to55 = (step - SETTLE) / HZ;
    maxLateralOffset = Math.max(maxLateralOffset, Math.abs(s.position.x));
  });
  measurements.acceleration = { ...run, to100, to55, maxLateralOffset };
  // docs/vertical-slice-design.md Appendix A: ~2.15 s to 100 km/h, ~6.7 s to 55 m/s.
  // Section 13.1 supplies their acceptance bands: 2.0–2.3 s and 6.3–7.1 s.
  expect(to100).toBeGreaterThanOrEqual(2);
  expect(to100).toBeLessThanOrEqual(2.3);
  // F0 preserves the measured asphalt baseline: 265 actual steps at 120 Hz.
  // Keep this narrower regression alongside the original design acceptance band.
  expect(to100).toBe(265 / HZ);
  expect(to55).toBeGreaterThanOrEqual(6.3);
  expect(to55).toBeLessThanOrEqual(7.1);
  expect(maxLateralOffset).toBeLessThan(0.01);
  expect(run.result.peakSpeed).toBeLessThanOrEqual(
    script.tuning.topSpeed + 0.01,
  );
});

it('brakes from a scripted 60 m/s approach within 15 percent of 77 metres', async () => {
  const brakeStep = SETTLE + 30 * HZ;
  const script = scenario('Full brake from 60 m/s', brakeStep + 4 * HZ, [
    frame(0),
    frame(SETTLE, { throttle: 1 }),
    frame(brakeStep, { brake: 1 }),
  ]);
  let startingSpeed = 0,
    startingZ = 0,
    distance: number | undefined,
    stopSeconds = 0;
  const run = await runScript(script, (vehicle, step) => {
    const s = vehicle.telemetry;
    if (step === brakeStep) {
      startingSpeed = s.speed;
      startingZ = s.position.z;
    }
    // Measure first stop before the held brake becomes a reverse command at low speed.
    if (step > brakeStep && distance === undefined && s.vLong <= 0.5) {
      distance = startingZ - s.position.z;
      stopSeconds = (step - brakeStep) / HZ;
    }
  });
  measurements.braking = { ...run, startingSpeed, distance, stopSeconds };
  // Appendix A, "Full brake from 60 m/s": ~77 m and ~2.6 s. Section 13.2 allows ±15% distance.
  // Keep every default: full throttle asymptotically approaches topSpeed=60; no velocity injection.
  expect(startingSpeed).toBeGreaterThanOrEqual(59.99);
  expect(startingSpeed).toBeLessThanOrEqual(60.01);
  expect(distance).toBeDefined();
  expect(distance!).toBeGreaterThanOrEqual(77 * 0.85);
  expect(distance!).toBeLessThanOrEqual(77 * 1.15);
  // F0 must preserve the pre-surface-change, real Jolt stopping measurement.
  // Same scripted approach/defaults; compare to sub-millimetre rounding, not wall time.
  expect(distance!).toBeCloseTo(72.3990478515625, 3);
  expect(stopSeconds).toBeGreaterThan(0);
  expect(stopSeconds).toBeLessThan(4);
});

it('holds a constant-steer circle below the load-dependent friction limit', async () => {
  const turnStep = SETTLE + 3 * HZ;
  const steadyStep = turnStep + 15 * HZ;
  const script = scenario('Constant-steer circle', turnStep + 30 * HZ, [
    frame(0),
    frame(SETTLE, { throttle: 1 }),
    frame(turnStep, { throttle: 0.35, steer: 0.45 }),
  ]);
  let samples = 0,
    maxExcess = -Infinity,
    peakLateral = 0,
    yawTravel = 0,
    minSpeed = Infinity,
    minGrounded = 4;
  const run = await runScript(script, (vehicle, step) => {
    if (step <= steadyStep) return;
    const s = vehicle.telemetry;
    // Design 6.5.4 / QUESTIONS #4 approved WP5 coupling: total force may reach sqrt(2-coupling)*mu*Fz.
    // Use actual per-wheel load/friction, including downforce and load sensitivity (Appendix A).
    const capacity =
      s.wheels.reduce((sum, wheel) => sum + wheel.mu * wheel.Fz, 0) /
      vehicle.currentMass;
    const limit = capacity * Math.sqrt(2 - script.tuning.combinedSlipCoupling);
    maxExcess = Math.max(maxExcess, Math.abs(s.lateralAcceleration) - limit);
    peakLateral = Math.max(peakLateral, Math.abs(s.lateralAcceleration));
    yawTravel += s.yawRate / HZ;
    minSpeed = Math.min(minSpeed, s.speed);
    minGrounded = Math.min(minGrounded, s.groundedWheels);
    samples++;
  });
  measurements.circle = {
    ...run,
    samples,
    maxExcess,
    peakLateral,
    yawTravel,
    minSpeed,
    minGrounded,
  };
  expect(samples).toBe(15 * HZ);
  expect(minGrounded).toBe(4);
  expect(minSpeed).toBeGreaterThan(10);
  expect(yawTravel).toBeGreaterThan(2 * Math.PI);
  expect(peakLateral).toBeGreaterThan(2);
  // 1 m/s² allows measured acceleration's 0.1 s low-pass lag and suspension transients.
  expect(maxExcess).toBeLessThanOrEqual(1);
});
