import { createRequire } from 'node:module';
import { afterEach, expect, it, vi } from 'vitest';
import * as surfaces from '../src/content/surfaces';
import type { GameInput } from '../src/core/gameApi';
import { createPhysicsWorld } from '../src/physics/joltWorld';
import { TuningStore } from '../src/tuning/store';
import { Vehicle } from '../src/vehicle/vehicle';
import { createTrackSurfaceResolver } from '../src/world/trackSurfaces';

const wasmPath = createRequire(import.meta.url).resolve(
  'jolt-physics/jolt-physics.wasm.wasm',
);
const dt = 1 / 120;
const idle: GameInput = {
  throttle: 0,
  brake: 0,
  steer: 0,
  handbrake: false,
  boost: false,
};
const cleanup: (() => void)[] = [];

async function rig(
  contact: 'asphalt' | 'concrete' | 'unknown' = 'asphalt',
  kerbFootprint: (x: number, z: number) => boolean = () => false,
) {
  const world = await createPhysicsWorld({ wasmPath });
  const ground = {
    center: { x: 0, y: -0.5, z: 0 },
    halfExtents: { x: 50, y: 0.5, z: 50 },
    rotY: 0,
  };
  const groundBody = world.createStaticBox(ground.center, ground.halfExtents);
  const contactBody =
    contact === 'asphalt'
      ? groundBody
      : world.createStaticBox(
          { x: 0, y: 0.25, z: 0 },
          { x: 5, y: 0.25, z: 5 },
          0,
          0.5,
          0,
          contact === 'concrete'
            ? surfaces.SURFACE_IDS.concrete
            : surfaces.SURFACE_IDS.asphalt,
        );
  const resolver = createTrackSurfaceResolver({
    bodies: {
      ground: groundBody,
      barriers: contact === 'concrete' ? [contactBody] : [],
    },
    groundSurfaceId: surfaces.SURFACE_IDS.asphalt,
    ground,
    kerbFootprint,
  });
  const tuning = new TuningStore();
  const vehicle = new Vehicle(
    world,
    tuning,
    {
      x: 0,
      y: contact === 'asphalt' ? 0.86 : 1.36,
      z: 0,
    },
    resolver,
  );
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    resolver.dispose();
    world.dispose();
  };
  cleanup.push(dispose);
  function step(input = idle, count = 1) {
    for (let i = 0; i < count; i++) {
      vehicle.preStep(dt, input);
      world.step(dt);
      vehicle.postStep(dt);
    }
  }
  step(idle, 360);
  return { world, vehicle, tuning, resolver, contactBody, step, dispose };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const dispose of cleanup) dispose();
  cleanup.length = 0;
});

/** Current authored ground multipliers are both 1. A frozen test-only definition
 * exercises a future different coefficient without changing shipped content. */
function kerbGrip(multiplier: number) {
  const lookup = surfaces.getKnownSurfaceDefinition;
  const kerb = Object.freeze({
    ...lookup(surfaces.SURFACE_IDS.kerb),
    context: 'ground' as const,
    gripMultiplier: multiplier,
  });
  vi.spyOn(surfaces, 'getKnownSurfaceDefinition').mockImplementation((id) =>
    id === surfaces.SURFACE_IDS.kerb ? kerb : lookup(id),
  );
}

it('resolves each wheel once and multiplies authored grip by the live global control', async () => {
  kerbGrip(0.5);
  const { vehicle, tuning, step } = await rig('asphalt', (x) => x > 0);
  tuning.set('loadSensitivity', 0);
  const wheels = [...vehicle.telemetry.wheels];
  const hits = wheels.map((wheel) => wheel.hit);
  for (const global of [0.8, 1.2]) {
    tuning.set('surfaceGrip', global);
    vi.mocked(surfaces.getKnownSurfaceDefinition).mockClear();
    step();
    expect(surfaces.getKnownSurfaceDefinition).toHaveBeenCalledTimes(4);
    for (let i = 0; i < wheels.length; i++) {
      const wheel = vehicle.telemetry.wheels[i]!;
      const kerb = wheel.contactPoint.x > 0;
      expect(wheel).toBe(wheels[i]);
      expect(wheel.hit).toBe(hits[i]);
      expect(wheel.hit.surfaceId).toBe(surfaces.SURFACE_IDS.asphalt);
      expect(wheel.surfaceId).toBe(
        kerb ? surfaces.SURFACE_IDS.kerb : surfaces.SURFACE_IDS.asphalt,
      );
      expect(wheel.surfaceGripMultiplier).toBe(kerb ? 0.5 : 1);
      expect(wheel.mu).toBeCloseTo(
        tuning.get(i < 2 ? 'gripFront' : 'gripRear') *
          global *
          (kerb ? 0.5 : 1),
        12,
      );
    }
  }
  expect(vehicle.telemetry.surfaceDiagnostics).toBeDefined();
  expect(vehicle.telemetry.surfaceDiagnostics?.unknownBodySeen).toBe(false);
});

it('keeps zero-grip ground distinct from an absent tyre surface', async () => {
  kerbGrip(0);
  const { vehicle, step } = await rig('asphalt', () => true);
  step({ ...idle, throttle: 1 }, 60);
  for (const wheel of vehicle.telemetry.wheels) {
    expect(wheel.grounded).toBe(true);
    expect(wheel.surfaceId).toBe(surfaces.SURFACE_IDS.kerb);
    expect(wheel.surfaceGripMultiplier).toBe(0);
    expect(wheel.Fz).toBeGreaterThan(0);
    expect(wheel.mu).toBe(0);
    expect(wheel.Fx).toBe(0);
  }
  expect(vehicle.telemetry.wheels[2].spinning).toBe(true);
});

for (const contact of ['concrete', 'unknown'] as const) {
  it(
    'retains suspension on ' +
      contact +
      ' contact while applying no tyre force',
    async () => {
      const { vehicle, resolver, contactBody, step } = await rig(contact);
      step({ ...idle, throttle: 1 }, 60);
      expect(vehicle.controls.throttle).toBe(1);
      expect(vehicle.telemetry.position.y).toBeCloseTo(1.36, 1);
      expect(vehicle.telemetry.groundedWheels).toBe(4);
      for (const wheel of vehicle.telemetry.wheels) {
        expect(wheel.hit.bodyId).toBe(contactBody);
        expect(wheel.grounded).toBe(true);
        expect(wheel.surfaceId).toBe(
          contact === 'concrete' ? surfaces.SURFACE_IDS.concrete : null,
        );
        expect(wheel.surfaceGripMultiplier).toBeNull();
        expect(wheel.springForce).toBeGreaterThan(0);
        expect(wheel.Fz).toBeGreaterThan(0);
        expect(wheel.Fx).toBe(0);
        expect(wheel.Fy).toBe(0);
        expect(wheel.mu).toBe(0);
        expect(wheel.tireForceWorld.lengthSq()).toBe(0);
        expect(wheel.spinning).toBe(false);
      }
      expect(vehicle.telemetry.surfaceDiagnostics).toBe(resolver.diagnostics);
      expect(resolver.diagnostics.unknownBodySeen).toBe(contact === 'unknown');
      expect(resolver.diagnostics.firstUnknownBodyId).toBe(
        contact === 'unknown' ? contactBody : null,
      );
    },
  );
}

it('clears canonical surface state in the air without reading a stale hit ID', async () => {
  const { vehicle } = await rig();
  vehicle.respawn({ x: 0, y: 100, z: 0 });
  for (const wheel of vehicle.telemetry.wheels) {
    expect(wheel.surfaceId).toBeNull();
    expect(wheel.surfaceGripMultiplier).toBeNull();
    Object.defineProperty(wheel.hit, 'surfaceId', {
      get() {
        throw new Error('Airborne code read a stale hit ID');
      },
    });
  }
  const lookup = vi.spyOn(surfaces, 'getKnownSurfaceDefinition');
  vehicle.preStep(dt, idle);
  expect(lookup).not.toHaveBeenCalled();
  for (const wheel of vehicle.telemetry.wheels) {
    expect(wheel.grounded).toBe(false);
    expect(wheel.surfaceId).toBeNull();
    expect(wheel.surfaceGripMultiplier).toBeNull();
    expect(wheel.mu).toBe(0);
  }
});

it('retains diagnostic evidence on respawn but never reuses disposed world telemetry', async () => {
  const old = await rig('unknown');
  const retained = old.vehicle.telemetry.surfaceDiagnostics!;
  expect(retained.unknownBodySeen).toBe(true);
  old.vehicle.respawn();
  old.vehicle.rebuildMassProperties();
  expect(old.vehicle.telemetry.surfaceDiagnostics).toBe(retained);
  expect(retained.firstUnknownBodyId).toBe(old.contactBody);
  const otherBody = old.world.createStaticBox(
    { x: 20, y: 0.25, z: 0 },
    { x: 5, y: 0.25, z: 5 },
  );
  old.vehicle.respawn({ x: 20, y: 1.36, z: 0 });
  old.step(idle, 2);
  expect(old.vehicle.telemetry.wheels[0].hit.bodyId).toBe(otherBody);
  expect(retained.firstUnknownBodyId).toBe(old.contactBody);
  old.dispose();
  expect(retained.lastStatus).toBe('disposed');

  const fresh = await rig();
  const current = fresh.vehicle.telemetry.surfaceDiagnostics!;
  expect(current).not.toBe(retained);
  expect(current.unknownBodySeen).toBe(false);
  expect(current.firstUnknownBodyId).toBeNull();
  expect(current.invalidHitSeen).toBe(false);
  expect(current.lastStatus).toBe('resolved');
  fresh.step();
  expect(retained.lastStatus).toBe('disposed');
});
