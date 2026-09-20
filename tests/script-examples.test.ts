import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import {
  assertReplay,
  assertCompletedLap,
  parseInputScript,
  type ReplayResult,
} from '../src/input/script';
import { scriptVehicleHarness } from './scriptVehicleHarness';
import { generateScriptExamples } from './generateScriptExamples';

beforeAll(async () => {
  if (process.env.WRITE_INPUT_EXAMPLES === '1') await generateScriptExamples();
}, 60000);

for (const name of ['standing-start', 'handbrake-turn', 'ring-lap']) {
  it(
    'replays ' +
      name +
      ' with identical final state after repeated respawns in one Jolt world',
    async () => {
      const document = parseInputScript(
        readFileSync('src/input/examples/' + name + '.json', 'utf8'),
      );
      const expected = (
        JSON.parse(
          readFileSync('tests/fixtures/input-script-results.json', 'utf8'),
        ) as Record<string, ReplayResult>
      )[name]!;
      const results = [];
      const rig = await scriptVehicleHarness();
      try {
        for (let run = 0; run < 2; run++) {
          rig.scripts.load(document, { tuning: 'apply' });
          rig.loop.stepMany(document.durationSteps);
          expect(rig.scripts.progress().done).toBe(true);
          expect(rig.vehicle.telemetry.recoveryCount).toBe(0);
          const result = rig.scripts.result();
          results.push(result);
          assertReplay(result, {
            elapsedSteps: document.durationSteps,
            finalPose: {
              pose: expected.finalPose,
              positionTolerance: 1e-4,
              rotationTolerance: 1e-5,
            },
            peakSpeed: {
              min: expected.peakSpeed - 1e-5,
              max: expected.peakSpeed + 1e-5,
            },
            peakAbsSlideAngle: {
              min: Math.max(0, expected.peakAbsSlideAngle - 1e-5),
              max: expected.peakAbsSlideAngle + 1e-5,
            },
          });
          if (name === 'handbrake-turn')
            assertReplay(result, {
              peakAbsSlideAngle: { min: 0.1, max: Math.PI },
            });
          if (name === 'ring-lap')
            assertCompletedLap(
              rig.scripts.lapProgress()!,
              document.durationSteps,
            );
          expect(() => rig.loop.stepMany(1)).toThrow(/EOF/);
          expect(rig.loop.totalSteps).toBe(document.durationSteps * (run + 1));
        }
      } finally {
        rig.dispose();
      }
      expect(results[0]).toEqual(results[1]);
    },
    60000,
  );
}
