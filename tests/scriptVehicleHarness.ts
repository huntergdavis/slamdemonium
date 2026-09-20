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
import { installTrackColliders } from '../src/world/trackPhysics';
import { makePad } from './input-helpers';

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

export async function scriptVehicleHarness() {
  const world = await createPhysicsWorld({ wasmPath });
  installTrackColliders(world, DEFAULT_TRACK_CONFIG);
  const store = new TuningStore();
  const vehicle = new Vehicle(world, store, ringSpawn.position);
  const keyboard = new KeyboardInput(new EventTarget(), {
    visibilityTarget: null,
  });
  const pad = makePad();
  const pads = [pad];
  const mapper = new InputMapper(keyboard, new GamepadInput(() => pads));
  const scripts = new ScriptController({
    store,
    mapper,
    reset: (spawn) => {
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
      world.dispose();
    },
  };
}
