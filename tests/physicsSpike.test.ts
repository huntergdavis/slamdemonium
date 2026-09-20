import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
import { createPhysicsWorld } from '../src/physics/joltWorld';
import { runPhysicsSpike } from '../src/physics/spike';

it('passes the Day-1 probes, five-minute replay, step budget, and allocator checks', async () => {
  const wasmPath = createRequire(import.meta.url).resolve(
    'jolt-physics/jolt-physics.wasm.wasm',
  );
  const result = await runPhysicsSpike(() => createPhysicsWorld({ wasmPath }));
  mkdirSync('scratch', { recursive: true });
  writeFileSync(
    'scratch/physics-spike-node.json',
    JSON.stringify(result, null, 2),
  );
  expect(result.settledHeight).toBeCloseTo(0.5, 1);
  expect(result.rayDistance).toBeCloseTo(4, 5);
  expect(result.rayNormalY).toBe(1);
  expect(result.forceVelocityZ).toBeLessThan(0);
  expect(result.torqueVelocityY).toBeGreaterThan(0);
  expect(result.ccdMaxX).toBeLessThan(0);
  expect(result.replayHashes[0]).toBe(result.replayHashes[1]);
  expect(result.finiteSteps).toBe(72_000);
  expect(result.meanStepMs).toBeLessThan(0.2);
  expect(result.allocatorLostBytes).toBe(0);
}, 30_000);
