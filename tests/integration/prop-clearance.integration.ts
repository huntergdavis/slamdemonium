import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { parseInputScript } from '../../src/input/scriptFormat';
import { BREAKABLE_PROP_PLACEMENTS } from '../../src/world/breakablePlacements';
import { measurements, runScript } from './runner';

/** Centre-to-centre in the ground plane. The car is about 2 m long and a
 * prop is a 1 m box, so 10 m is five car lengths of daylight: a bank moved
 * into a scripted route fails this long before it would be brushed. */
const MIN_CLEARANCE_METRES = 10;
const EXAMPLES = ['standing-start', 'handbrake-turn', 'ring-lap'] as const;

/** The replay fixtures cannot prove this on their own: the script harness
 * never creates props, so an unchanged replay digest says nothing about
 * whether the authored banks sit in a route. This replays each example and
 * measures the closest approach to any placement. */
it('keeps every example script route at least ten metres from every authored prop', async () => {
  const clearance: Record<string, unknown> = {};
  for (const name of EXAMPLES) {
    const script = parseInputScript(
      readFileSync(`src/input/examples/${name}.json`, 'utf8'),
    );
    let min = Infinity;
    let closest = { x: 0, z: 0, step: 0 };
    await runScript(script, (vehicle, step) => {
      const p = vehicle.telemetry.position;
      for (const prop of BREAKABLE_PROP_PLACEMENTS) {
        const distance = Math.hypot(
          p.x - prop.position.x,
          p.z - prop.position.z,
        );
        if (distance < min) {
          min = distance;
          closest = { x: p.x, z: p.z, step };
        }
      }
    });
    clearance[name] = { minDistanceMetres: min, closest };
    expect(
      min,
      `${name} passes within ${min.toFixed(1)} m of a prop`,
    ).toBeGreaterThan(MIN_CLEARANCE_METRES);
  }
  measurements.propClearance = clearance;
  expect(BREAKABLE_PROP_PLACEMENTS.length).toBeGreaterThan(0);
});
