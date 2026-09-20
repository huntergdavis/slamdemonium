import { mkdirSync, writeFileSync } from 'node:fs';
import { Vector3 } from 'three';
import {
  exportInputScript,
  assertCompletedLap,
  type InputScript,
} from '../src/input/script';
import {
  scriptVehicleHarness,
  neutralScriptInput,
} from './scriptVehicleHarness';

/** Explicit regeneration only; the checked-in scripts are immutable test inputs. */
export async function generateScriptExamples() {
  mkdirSync('src/input/examples', { recursive: true });
  mkdirSync('tests/fixtures', { recursive: true });
  const outcomes: Record<string, unknown> = {};
  for (const kind of [
    'standing-start',
    'handbrake-turn',
    'ring-lap',
  ] as const) {
    const rig = await scriptVehicleHarness();
    try {
      rig.record(kind);
      const input = { ...neutralScriptInput };
      const forward = new Vector3();
      const duration =
        kind === 'standing-start'
          ? 240
          : kind === 'handbrake-turn'
            ? 420
            : 9000;
      for (let step = 0; step < duration; step++) {
        if (kind !== 'ring-lap') {
          input.throttle = step < 60 ? 0 : 1;
          input.steer = 0;
          input.brake = 0;
          input.handbrake = false;
          if (kind === 'handbrake-turn' && step >= 270) {
            input.throttle = 0.3;
            input.steer = 0.65;
            input.handbrake = step < 330;
          }
        }
        if (kind === 'ring-lap' && step >= 60 && step % 12 === 0) {
          const s = rig.vehicle.telemetry;
          const angle = Math.atan2(-s.position.z, s.position.x);
          const radiusError = Math.hypot(s.position.x, s.position.z) - 130;
          forward.set(0, 0, -1).applyQuaternion(s.rotation);
          const yaw = Math.atan2(-forward.x, -forward.z);
          const error = Math.atan2(
            Math.sin(angle + radiusError * 0.04 - yaw),
            Math.cos(angle + radiusError * 0.04 - yaw),
          );
          // This feedback authors the recording only. Playback consumes frozen JSON frames.
          input.steer = Math.max(-0.7, Math.min(0.7, 0.2 + error * 1.5));
          input.throttle = Math.max(0, Math.min(1, (20 - s.speed) * 0.15));
          input.brake = Math.max(0, Math.min(0.4, (s.speed - 22) * 0.1));
          input.steer = Math.round(input.steer * 100) / 100;
          input.throttle = Math.round(input.throttle * 100) / 100;
          input.brake = Math.round(input.brake * 100) / 100;
        }
        rig.setPad(input);
        rig.loop.stepMany(1);
        if (kind === 'ring-lap' && rig.scripts.lapProgress()!.completedLaps > 0)
          break;
      }
      if (kind === 'ring-lap')
        assertCompletedLap(rig.scripts.lapProgress()!, 9000);
      const script: InputScript = rig.scripts.stopRecording();
      writeFileSync(
        'src/input/examples/' + kind + '.json',
        exportInputScript(script) + '\n',
      );
      outcomes[kind] = {
        ...rig.scripts.result(),
        lap: { ...rig.scripts.lapProgress() },
      };
    } finally {
      rig.dispose();
    }
  }
  writeFileSync(
    'tests/fixtures/input-script-results.json',
    JSON.stringify(outcomes, null, 2) + '\n',
  );
}
