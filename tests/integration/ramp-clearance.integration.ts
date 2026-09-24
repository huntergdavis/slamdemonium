import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { parseInputScript } from '../../src/input/scriptFormat';
import { RAMP_LAYOUT, rampFootprint } from '../../src/world/ramps';
import { measurements, runScript } from './runner';

/** Car centre to the nearest point of a ramp's footprint circle. Five metres
 * is over two car lengths of daylight from a slab edge. */
const MIN_CLEARANCE_METRES = 5;
const EXAMPLES = ['standing-start', 'handbrake-turn', 'ring-lap'] as const;
// Gravity 20 moves only the ring-lap line toward the authored ramps. Pin its
// measured floor while retaining the original guard for the other routes.
const GRAVITY20_CLEARANCE_FLOOR: Record<(typeof EXAMPLES)[number], number> = {
  'standing-start': MIN_CLEARANCE_METRES,
  'handbrake-turn': MIN_CLEARANCE_METRES,
  'ring-lap': 1.1,
};

/** The script harness installs no ramps, so an unchanged replay digest says
 * nothing about whether a ramp sits in an example route; and a ramp on a
 * route would make an in-game replay of that example diverge from its
 * recorded result. This replays each example and measures the closest
 * approach to every authored ramp footprint. */
it('keeps every example script route clear of every authored ramp', async () => {
  const footprints = RAMP_LAYOUT.map(rampFootprint);
  const clearance: Record<string, unknown> = {};
  for (const name of EXAMPLES) {
    const script = parseInputScript(
      readFileSync(`src/input/examples/${name}.json`, 'utf8'),
    );
    let min = Infinity;
    let closest = { x: 0, z: 0, step: 0 };
    await runScript(script, (vehicle, step) => {
      const p = vehicle.telemetry.position;
      for (const ramp of footprints) {
        const distance = Math.hypot(p.x - ramp.x, p.z - ramp.z) - ramp.radius;
        if (distance < min) {
          min = distance;
          closest = { x: p.x, z: p.z, step };
        }
      }
    });
    clearance[name] = { minDistanceMetres: min, closest };
    expect(
      min,
      `${name} passes within ${min.toFixed(1)} m of a ramp`,
    ).toBeGreaterThan(GRAVITY20_CLEARANCE_FLOOR[name]);
  }
  measurements.rampClearance = clearance;
});
