import {
  BoxGeometry,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  Vector3,
} from 'three';
import { GAME_NAME } from './core/constants';
import { createGameStub } from './core/gameApi';
import type { GameInput } from './core/gameApi';
import { FixedStepLoop } from './core/loop';
import { TransformHistory } from './core/transforms';
import type { IPhysicsWorld, MassDesc } from './physics/adapter';
import { runPhysicsSpike } from './physics/spike';
import { createRenderer } from './render/renderer';
import { BUILTIN_PRESETS } from './tuning/presets';
import type { BuiltinPresetName } from './tuning/presets';
import { isParamKey } from './tuning/schema';
import { TuningStore } from './tuning/store';
import './style.css';

document.title = GAME_NAME;
const host = document.querySelector<HTMLElement>('#app');
if (!host) throw new Error('Missing game mount element.');
host.setAttribute('aria-label', GAME_NAME);

const game = createGameStub();
window.__game = game;
const view = createRenderer(host);
view.render();
const tuning = new TuningStore();
const resources: { dispose(): void }[] = [];
let world: IPhysicsWorld | undefined;
let frameId = 0;
let disposed = false;
let unsubscribe: (() => void) | undefined;
let visibilityChanged = () => {};

function addBox(width: number, height: number, depth: number, color: number) {
  const geometry = new BoxGeometry(width, height, depth);
  const material = new MeshStandardMaterial({ color });
  resources.push(geometry, material);
  const mesh = new Mesh(geometry, material);
  view.scene.add(mesh);
  return mesh;
}

async function boot(): Promise<void> {
  const { createPhysicsWorld } = await import('./physics/joltWorld');
  const physics = await createPhysicsWorld();
  if (disposed) {
    physics.dispose();
    return;
  }
  world = physics;
  const spawn = new Vector3(0, 3, 0);
  const mass: MassDesc = {
    mass: tuning.get('mass'),
    comOffset: {
      x: 0,
      y: tuning.get('comHeightOffset'),
      z: -tuning.get('comLongOffset'),
    },
    inertiaScale: {
      x: tuning.get('pitchRollInertiaScale'),
      y: tuning.get('yawInertiaScale'),
      z: tuning.get('pitchRollInertiaScale'),
    },
  };
  physics.createStaticBox({ x: 0, y: -0.5, z: 0 }, { x: 40, y: 0.5, z: 40 });
  physics.createStaticBox({ x: 0, y: 1, z: -12 }, { x: 8, y: 1, z: 0.02 });
  const body = physics.createDynamicBox({
    center: spawn,
    halfExtents: { x: 0.9, y: 0.5, z: 2 },
    ...mass,
    friction: 0.3,
    restitution: tuning.get('restitution'),
    ccd: true,
    maxAngularVelocity: tuning.get('maxAngularVelocity'),
    angularDamping: tuning.get('angularDamping'),
  });
  const history = new TransformHistory(physics, body);
  const ground = addBox(80, 1, 80, 0x303844);
  ground.position.y = -0.5;
  const wall = addBox(16, 2, 0.04, 0x8b5555);
  wall.position.set(0, 1, -12);
  const chassis = addBox(1.8, 1, 4, 0xf09f42);
  view.scene.add(new HemisphereLight(0xd9edff, 0x39434d, 2));
  const sunlight = new DirectionalLight(0xffffff, 2);
  sunlight.position.set(8, 12, 5);
  view.scene.add(sunlight);
  view.camera.position.set(8, 6, 10);
  view.camera.lookAt(0, 1, 0);

  const requested: GameInput = {
    throttle: 0,
    brake: 0,
    steer: 0,
    handbrake: false,
    boost: false,
  };
  const sampled: GameInput = { ...requested };
  const force = new Vector3();
  const torque = new Vector3();
  const velocity = new Vector3();
  const cameraOffset = new Vector3(8, 6, 10);
  let physicsStepMs = 0;
  const loop = new FixedStepLoop(
    {
      get physicsHz() {
        return tuning.get('physicsHz');
      },
      get timeScale() {
        return tuning.get('timeScale');
      },
    },
    {
      sampleForStep() {
        sampled.throttle = requested.throttle;
        sampled.brake = requested.brake;
        sampled.steer = requested.steer;
        sampled.handbrake = requested.handbrake;
        sampled.boost = requested.boost;
      },
      preStep() {
        history.beforeStep();
        physics.setGravity(tuning.get('gravity'));
        // WP1 force/torque proof only. WP5 replaces this with the layered vehicle model.
        force
          .set(0, 0, -mass.mass * 4 * (sampled.throttle - sampled.brake))
          .applyQuaternion(history.current.rotation);
        torque.set(0, sampled.steer * mass.mass, 0);
        if (force.lengthSq() > 0)
          physics.applyForceAtPoint(body, force, history.current.position);
        if (torque.lengthSq() > 0) physics.applyTorque(body, torque);
      },
      stepPhysics(dt) {
        const start = performance.now();
        physics.step(dt);
        physicsStepMs = performance.now() - start;
      },
      postStep() {
        history.afterStep();
        physics.getLinearVelocity(body, velocity);
      },
      render(alpha) {
        const pose = history.interpolate(alpha);
        chassis.position.copy(pose.position);
        chassis.quaternion.copy(pose.rotation);
        view.camera.position.copy(pose.position).add(cameraOffset);
        view.camera.lookAt(pose.position);
        view.render();
        game.ready = true;
      },
    },
  );

  unsubscribe = tuning.onChange((change) => {
    if (!change.needsRebuild) return;
    mass.mass = tuning.get('mass');
    mass.comOffset.y = tuning.get('comHeightOffset');
    mass.comOffset.z = -tuning.get('comLongOffset');
    mass.inertiaScale.x = tuning.get('pitchRollInertiaScale');
    mass.inertiaScale.y = tuning.get('yawInertiaScale');
    mass.inertiaScale.z = tuning.get('pitchRollInertiaScale');
    physics.updateMassProperties(body, mass);
  });
  game.tuning = {
    get(key) {
      if (!isParamKey(key)) throw new RangeError('Unknown parameter.');
      return tuning.get(key);
    },
    set(key, value) {
      if (!isParamKey(key)) throw new RangeError('Unknown parameter.');
      tuning.set(key, value);
    },
    applyPreset(name) {
      if (!Object.hasOwn(BUILTIN_PRESETS, name))
        throw new RangeError('Unknown preset.');
      tuning.applyPreset(name as BuiltinPresetName);
    },
  };
  game.setInput = (input) => {
    Object.assign(requested, input);
  };
  game.stepMany = (count) => {
    loop.stepMany(count);
  };
  game.getTelemetry = () => ({
    position: {
      x: history.current.position.x,
      y: history.current.position.y,
      z: history.current.position.z,
    },
    rotation: {
      x: history.current.rotation.x,
      y: history.current.rotation.y,
      z: history.current.rotation.z,
      w: history.current.rotation.w,
    },
    speed: velocity.length(),
    physicsStepMs,
    totalSteps: loop.totalSteps,
    stepsPerFrame: loop.stepsThisFrame,
    alpha: loop.alpha,
    physicsHz: tuning.get('physicsHz'),
    timeScale: tuning.get('timeScale'),
  });
  game.respawn = () => {
    physics.setTransform(body, spawn, { x: 0, y: 0, z: 0, w: 1 }, true);
    history.reset();
    velocity.set(0, 0, 0);
    loop.resetClock();
  };
  game.runPhysicsSpike = () => runPhysicsSpike(createPhysicsWorld);
  visibilityChanged = () => {
    loop.setPaused(document.hidden);
  };
  document.addEventListener('visibilitychange', visibilityChanged);
  visibilityChanged();
  function frame(nowMs: number): void {
    loop.frame(nowMs);
    frameId = requestAnimationFrame(frame);
  }
  // Build-time gate: default production emits no fixture module or panel.
  if (import.meta.env.VITE_TEST_API === '1') {
    const { installInputTestFixture } = await import('./input/testFixture');
    if (disposed) return;
    resources.push(installInputTestFixture());
  }
  frameId = requestAnimationFrame(frame);
}

void boot().catch((error: unknown) => {
  console.error(error);
  if (!disposed) host.textContent = 'Unable to start the physics scene.';
});
import.meta.hot?.dispose(() => {
  disposed = true;
  cancelAnimationFrame(frameId);
  document.removeEventListener('visibilitychange', visibilityChanged);
  unsubscribe?.();
  game.ready = false;
  world?.dispose();
  for (const resource of resources) resource.dispose();
  view.dispose();
});
