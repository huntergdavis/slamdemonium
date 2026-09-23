import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { PerspectiveCamera } from 'three';
import { expect, it } from 'vitest';
import { parseInputScript } from '../../src/input/scriptFormat';
import { CameraRig } from '../../src/render/cameraRig';
import { scriptVehicleHarness } from '../scriptVehicleHarness';
import { exportInputScript } from '../../src/input/script';

/** Ordinary forward driving has never drawn a complaint, so the camera's
 * path over the shipped replay fixtures is pinned here to the bit. Every
 * new camera behaviour (reverse swing, riding a loop, line of sight) must
 * gate on conditions these routes never meet. Regenerate the golden only
 * for a deliberate, reviewed camera change:
 *   CAMERA_GOLDEN=write npx vitest run --config vitest.integration.config.ts tests/integration/camera-identity.integration.ts
 */
const GOLDEN = 'tests/fixtures/camera-path.json';
const ROUTES = ['ring-lap', 'handbrake-turn'] as const;
const RENDER_EVERY_STEPS = 2; // 120 Hz physics, 60 Hz camera.

interface RoutePath {
  frames: number;
  sha256: string;
  /** Every 100th frame in full, so a mismatch is debuggable by eye. */
  samples: number[][];
}

async function cameraPath(route: (typeof ROUTES)[number]): Promise<RoutePath> {
  const script = parseInputScript(
    readFileSync(`src/input/examples/${route}.json`, 'utf8'),
  );
  const rig = await scriptVehicleHarness({ flatPlane: true });
  try {
    const camera = new PerspectiveCamera();
    const cam = new CameraRig(camera, rig.store);
    const hash = createHash('sha256');
    const samples: number[][] = [];
    let frames = 0;
    let step = 0;
    rig.scripts.load(exportInputScript(script), { tuning: 'verify' });
    const s = rig.vehicle.telemetry;
    const observe = () => {
      step++;
      if (step % RENDER_EVERY_STEPS) return;
      cam.update({ position: s.position, rotation: s.rotation }, s, 1 / 60);
      const row = [
        camera.position.x,
        camera.position.y,
        camera.position.z,
        camera.quaternion.x,
        camera.quaternion.y,
        camera.quaternion.z,
        camera.quaternion.w,
        camera.fov,
      ];
      hash.update(new Uint8Array(Float64Array.from(row).buffer));
      if (frames % 100 === 0) samples.push(row);
      frames++;
    };
    for (let i = 0; i < script.durationSteps; i++) {
      rig.loop.stepMany(1);
      observe();
    }
    return { frames, sha256: hash.digest('hex'), samples };
  } finally {
    rig.dispose();
  }
}

it('keeps the camera path over the forward-driving fixtures identical to the golden', async () => {
  const paths: Record<string, RoutePath> = {};
  for (const route of ROUTES) paths[route] = await cameraPath(route);
  if (process.env.CAMERA_GOLDEN === 'write' || !existsSync(GOLDEN)) {
    writeFileSync(GOLDEN, JSON.stringify(paths, null, 2) + '\n');
    return;
  }
  const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as Record<
    string,
    RoutePath
  >;
  for (const route of ROUTES) {
    expect(paths[route]!.frames).toBe(golden[route]!.frames);
    // Samples first: they name the frame and the axis that moved.
    paths[route]!.samples.forEach((row, index) => {
      row.forEach((value, axis) => {
        expect(
          value,
          `${route} sample ${index} (frame ${index * 100}) axis ${axis}`,
        ).toBe(golden[route]!.samples[index]![axis]!);
      });
    });
    expect(paths[route]!.sha256, `${route} full path`).toBe(
      golden[route]!.sha256,
    );
  }
}, 600000);
