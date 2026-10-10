import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
import { createPhysicsWorld } from '../../src/physics/joltWorld';
import { createCircuitMap } from '../../src/world/circuit';
import { createTakedownMap } from '../../src/world/takedownCourse';
import { poseAt } from '../../src/world/roadGenerator';
import { createSurfaceRegistry } from '../../src/world/surfaceRegistry';
import { createSurfacedBodies } from '../../src/world/surfacedBodies';
import { createTraffic } from '../../src/world/traffic';

const wasmPath = createRequire(import.meta.url).resolve(
  'jolt-physics/jolt-physics.wasm.wasm',
);
const DT = 1 / 120;

it.each([
  ['circuit', createCircuitMap],
  ['takedown', createTakedownMap],
] as const)(
  'keeps %s traffic free of unprovoked wrecks through 60 seconds of parked and moving browser-pace promotion',
  async (_name, makeMap) => {
    const map = makeMap();
    const path = map.path!;
    for (const moving of [false, true]) {
      const world = await createPhysicsWorld({ wasmPath });
      world.setGravity(20);
      world.createStaticBox(
        { x: 0, y: -0.5, z: 0 },
        { x: 4000, y: 0.5, z: 4000 },
      );
      const bodies = createSurfacedBodies(world, createSurfaceRegistry());
      const traffic = createTraffic(world, bodies, path, map.traffic!, {
        density: 0.85,
        minGap: 12,
        maxGap: 36,
      });
      let stepNumber = 0;
      const rivalContactAt = new Map<number, number>();
      const rivalWreckIds = new Set<number>();
      world.onContact((a, b, _impulse, _point, normal, velocities) => {
        const first = traffic.states.find((car) => car.bodyId === a);
        const second = traffic.states.find((car) => car.bodyId === b);
        if (
          first &&
          (first.rival || rivalWreckIds.has(first.id)) &&
          second &&
          !second.rival
        )
          rivalContactAt.set(second.id, stepNumber);
        if (
          second &&
          (second.rival || rivalWreckIds.has(second.id)) &&
          first &&
          !first.rival
        )
          rivalContactAt.set(first.id, stepNumber);
        traffic.onWorldContact(a, b, normal, velocities);
      });
      const start = path.samples.reduce((best, sample) =>
        Math.hypot(sample.x - map.spawn!.x, sample.z - map.spawn!.z) <
        Math.hypot(best.x - map.spawn!.x, best.z - map.spawn!.z)
          ? sample
          : best,
      );
      const player = { x: map.spawn!.x, y: 1, z: map.spawn!.z };
      let ambient = 0;
      let rivalCaused = 0;
      const ambientRows: string[] = [];
      let peakPhysical = 0;
      try {
        for (let frame = 0; frame < 60 * 60; frame++) {
          if (moving) {
            const station = (start.s + frame * (35 / 60)) % path.length;
            const pose = poseAt(path, station);
            player.x = pose.x;
            player.z = pose.z;
          }
          for (let substep = 0; substep < 2; substep++) {
            stepNumber++;
            traffic.preStep(DT, player, moving ? 35 : 0);
            world.step(DT);
            traffic.postStep();
            for (const car of traffic.newlyWrecked)
              if (!car.rival) {
                if (
                  (rivalContactAt.get(car.id) ?? -Infinity) >=
                  stepNumber - 2
                ) {
                  rivalCaused++;
                  rivalWreckIds.add(car.id);
                  continue;
                }
                ambient++;
                if (ambientRows.length < 8)
                  ambientRows.push(
                    `t=${(frame / 60).toFixed(2)} id=${car.id} x=${car.position.x.toFixed(1)} z=${car.position.z.toFixed(1)} nearby=${traffic.states
                      .filter(
                        (other) =>
                          other.id !== car.id &&
                          Math.hypot(
                            other.position.x - car.position.x,
                            other.position.z - car.position.z,
                          ) < 20,
                      )
                      .map(
                        (other) =>
                          `${other.id}:${other.rival ? 'rival' : 'civilian'}:${other.speed.toFixed(1)}:${other.wrecked}`,
                      )
                      .join(',')}`,
                  );
              }
            peakPhysical = Math.max(
              peakPhysical,
              traffic.states.filter((car) => car.bodyId > 0).length,
            );
          }
        }
        expect(
          ambient,
          `${_name} moving=${moving} ambient wrecks: ${ambientRows.join('; ')}`,
        ).toBe(0);
        console.info(
          'TRAFFIC_BROWSER_PACE',
          _name,
          moving ? 'moving' : 'parked',
          { ambient, rivalCaused, peakPhysical },
        );
        expect(peakPhysical).toBeGreaterThan(0);
      } finally {
        traffic.dispose();
        bodies.dispose();
        world.dispose();
      }
    }
  },
  120_000,
);
