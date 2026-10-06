import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
import { createImpactSeverity } from '../../src/core/impactSeverity';
import { createPhysicsWorld } from '../../src/physics/joltWorld';
import { sampleRoad } from '../../src/world/roadGenerator';
import { createSurfacedBodies } from '../../src/world/surfacedBodies';
import { createSurfaceRegistry } from '../../src/world/surfaceRegistry';
import { createTraffic } from '../../src/world/traffic';

const wasmPath = createRequire(import.meta.url).resolve(
  'jolt-physics/jolt-physics.wasm.wasm',
);
const DT = 1 / 120;

it('slow grinding dents to a small cap while separate slams add distinct chunks on every side', async () => {
  const world = await createPhysicsWorld({ wasmPath });
  const bodies = createSurfacedBodies(world, createSurfaceRegistry());
  try {
    world.setGravity(20);
    world.createStaticBox(
      { x: 0, y: -0.5, z: -250 },
      { x: 300, y: 0.5, z: 400 },
    );
    const path = sampleRoad([{ kind: 'straight', length: 500 }], {
      x: 0,
      z: 0,
      heading: 0,
    });
    const traffic = createTraffic(world, bodies, path, [
      { station: 140, laneSide: -1, speed: 0, modelKind: 'boxTruck' },
    ]);
    try {
      const player = { x: 3.5, y: 0.6, z: -40 };
      traffic.preStep(DT, player);
      world.step(DT);
      traffic.postStep();
      const car = traffic.states[0]!;
      expect(car.bodyId).toBeGreaterThan(0);
      const encounterId = car.id;
      const gentle = createImpactSeverity();
      const step = (
        normal?: { x: number; y: number; z: number },
        relative?: { x: number; y: number; z: number },
      ) => {
        traffic.preStep(DT, car.position);
        world.step(DT);
        if (normal && relative) {
          // Jolt may report several points on one contact manifold; these
          // must count as one scrape step or one slam episode.
          traffic.onPlayerContact(car.bodyId, gentle, normal, relative);
          traffic.onPlayerContact(car.bodyId, gentle, normal, relative);
        }
        traffic.postStep();
      };
      const rear = { x: 0, y: 0, z: 1 };
      const scrape = { x: 0, y: 0, z: -0.5 };
      for (let i = 0; i < 120; i++) step(rear, scrape);
      expect(car.crush.rear).toBeCloseTo(0.16, 2);
      for (let i = 0; i < 120; i++) step(rear, scrape);
      expect(car.crush.rear).toBeCloseTo(0.28, 2);
      for (let i = 0; i < 120; i++) step(rear, scrape);
      expect(car.crush.rear).toBeCloseTo(0.28, 2);

      const rearSlam = { x: 0, y: 0, z: -8 };
      for (let i = 0; i < 120; i++) step(rear, rearSlam);
      expect(car.crush.rear).toBeCloseTo(0.58, 2);
      for (let i = 0; i < 30; i++) step();
      step(rear, rearSlam);
      expect(car.crush.rear).toBeCloseTo(0.88, 2);

      for (const [side, normal, relative] of [
        ['front', { x: 0, y: 0, z: -1 }, { x: 0, y: 0, z: 15 }],
        ['right', { x: -1, y: 0, z: 0 }, { x: 15, y: 0, z: 0 }],
        ['left', { x: 1, y: 0, z: 0 }, { x: -15, y: 0, z: 0 }],
      ] as const) {
        for (let i = 0; i < 30; i++) step();
        step(normal, relative);
        expect(car.crush[side]).toBeCloseTo(0.45, 2);
      }
      expect(car.wrecked).toBe(false);

      traffic.preStep(DT, { x: 1000, y: 0.6, z: 1000 });
      world.step(DT);
      traffic.postStep();
      expect(car.bodyId).toBe(-1);
      traffic.preStep(DT, car.position);
      world.step(DT);
      traffic.postStep();
      expect(car.bodyId).toBeGreaterThan(0);
      expect(car.id).toBe(encounterId);
      expect(car.crush.rear).toBeCloseTo(0.88, 2);
      expect(car.crush.front).toBeCloseTo(0.45, 2);
    } finally {
      traffic.dispose();
    }
  } finally {
    bodies.dispose();
    world.dispose();
  }
}, 300_000);
