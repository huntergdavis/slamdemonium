import { createRequire } from 'node:module';
import { createPhysicsWorld } from '../src/physics/joltWorld';
import { TuningStore } from '../src/tuning/store';
import { Vehicle } from '../src/vehicle/vehicle';
import { FixedStepLoop } from '../src/core/loop';
import { InputMapper } from '../src/input/mapper';
import { KeyboardInput } from '../src/input/keyboard';
import { GamepadInput } from '../src/input/gamepad';
import { ScriptController, type ScriptInput } from '../src/input/script';
import { DEFAULT_TRACK_CONFIG } from '../src/world/trackConfig';
import {
  createGroundDescriptor,
  installTrackColliders,
} from '../src/world/trackPhysics';
import { makePad } from './input-helpers';
import { createTrackSurfaceResolver } from '../src/world/trackSurfaces';
import { createSurfaceRegistry } from '../src/world/surfaceRegistry';
import { createSurfacedBodies } from '../src/world/surfacedBodies';
import { createTrackLayout } from '../src/world/trackLayout';
import { createKerbFootprintQuery } from '../src/world/kerbFootprint';
import { SURFACE_IDS, type SurfaceResolver } from '../src/content/surfaces';

const wasmPath = createRequire(import.meta.url).resolve(
  'jolt-physics/jolt-physics.wasm.wasm',
);
export const ringSpawn = {
  position: { x: 130, y: 0.86, z: 0 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
};
export const neutralScriptInput: ScriptInput = {
  throttle: 0,
  brake: 0,
  steer: 0,
  handbrake: false,
  boost: false,
  source: 'gamepad',
};

export async function scriptVehicleHarness(
  options: {
    flatPlane?: boolean;
    observeStep?: (vehicle: Vehicle, completedSteps: number) => void;
  } = {},
) {
  const world = await createPhysicsWorld({ wasmPath });
  // One registry for the track and for any geometry a test adds through the
  // facade, exactly as boot wires it.
  const registry = createSurfaceRegistry();
  const surfacedBodies = createSurfacedBodies(world, registry);
  let surfaceResolver: SurfaceResolver;
  if (options.flatPlane) {
    const ground = {
      center: { x: 0, y: -0.5, z: 0 },
      halfExtents: { x: 5000, y: 0.5, z: 5000 },
      rotY: 0,
    };
    const groundBody = world.createStaticBox(ground.center, ground.halfExtents);
    surfaceResolver = createTrackSurfaceResolver({
      bodies: { ground: groundBody, barriers: [] },
      groundSurfaceId: SURFACE_IDS.asphalt,
      ground,
      kerbFootprint: () => false,
      registry,
    });
  } else {
    const config = DEFAULT_TRACK_CONFIG;
    const bodies = installTrackColliders(world, config);
    surfaceResolver = createTrackSurfaceResolver({
      bodies,
      groundSurfaceId: config.surfaceId,
      ground: createGroundDescriptor(config),
      kerbFootprint: createKerbFootprintQuery(createTrackLayout(config).curbs),
      registry,
    });
  }
  const store = new TuningStore();
  const vehicle = new Vehicle(
    world,
    store,
    ringSpawn.position,
    surfaceResolver,
  );
  const keyboard = new KeyboardInput(new EventTarget(), {
    visibilityTarget: null,
  });
  const pad = makePad();
  const pads = [pad];
  const mapper = new InputMapper(keyboard, new GamepadInput(() => pads));
  let completedSteps = 0;
  const scripts = new ScriptController({
    store,
    mapper,
    reset: (spawn) => {
      completedSteps = 0;
      vehicle.rebuildMassProperties();
      vehicle.updateBodyProperties();
      vehicle.respawn(spawn.position, spawn.rotation);
    },
    readTelemetry: () => vehicle.telemetry,
    onComplete: () => loop.setPaused(true),
    onError: () => loop.setPaused(true),
  });
  const loop = new FixedStepLoop(
    {
      get physicsHz() {
        return store.get('physicsHz');
      },
      timeScale: 1,
    },
    {
      sampleForStep: () => {
        mapper.sampleForStep();
      },
      preStep: (dt) => vehicle.preStep(dt, mapper.state, mapper.state.source),
      stepPhysics: (dt) => world.step(dt),
      postStep: (dt) => {
        vehicle.postStep(dt);
        options.observeStep?.(vehicle, ++completedSteps);
        scripts.afterStep();
      },
      render: () => {},
    },
  );
  function setPad(input: Readonly<ScriptInput>) {
    (pad.axes as number[])[0] = -input.steer;
    Object.assign(pad.buttons[7]!, { value: input.throttle });
    Object.assign(pad.buttons[6]!, { value: input.brake });
    Object.assign(pad.buttons[0]!, { pressed: input.handbrake });
    Object.assign(pad.buttons[2]!, { pressed: input.boost });
  }
  function record(name: string) {
    scripts.cancel();
    vehicle.rebuildMassProperties();
    vehicle.respawn(ringSpawn.position, ringSpawn.rotation);
    scripts.noteRespawn(ringSpawn, 0x51a7);
    scripts.startRecording(name);
  }
  return {
    world,
    surfacedBodies,
    store,
    vehicle,
    mapper,
    scripts,
    loop,
    setPad,
    record,
    dispose: () => {
      scripts.dispose();
      keyboard.dispose();
      surfaceResolver.dispose();
      surfacedBodies.dispose();
      world.dispose();
    },
  };
}
