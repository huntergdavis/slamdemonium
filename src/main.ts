import { BoxGeometry, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { GAME_NAME } from './core/constants';
import { createGameStub } from './core/gameApi';
import type { GameInput } from './core/gameApi';
import { DebouncedMassRebuild } from './core/massRebuild';
import { FixedStepLoop } from './core/loop';
import { PerformanceRecorder } from './core/performance';
import { TransformHistory } from './core/transforms';
import type { IPhysicsWorld } from './physics/adapter';
import { runPhysicsSpike } from './physics/spike';
import { createRenderer } from './render/renderer';
import { BUILTIN_PRESETS } from './tuning/presets';
import type { BuiltinPresetName } from './tuning/presets';
import { isParamKey } from './tuning/schema';
import { TuningStore } from './tuning/store';
import { KeyboardInput } from './input/keyboard';
import { InputMapper } from './input/mapper';
import { LatencyProbeView } from './input/latencyProbe';
import { Vehicle } from './vehicle/vehicle';
import { createTestTrack, installTrackColliders } from './world/track';
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
  const track = createTestTrack(view.scene, {
    maxAnisotropy: view.renderer.capabilities.getMaxAnisotropy(),
    config: {
      wallFriction: tuning.get('wallFriction'),
      restitution: tuning.get('restitution'),
    },
  });
  resources.push(track);
  view.renderer.shadowMap.enabled = true;
  const trackBodies = installTrackColliders(
    physics,
    track.config,
    track.barrierBoxes,
  );
  const vehicle = new Vehicle(physics, tuning, track.spawn.position);
  const history = new TransformHistory(physics, vehicle.body);
  const chassis = addBox(1.8, 1, 4, 0xf09f42);
  chassis.castShadow = true;
  chassis.receiveShadow = true;
  const nose = addBox(1.1, 0.02, 0.4, 0x21dce8);
  chassis.add(nose);
  nose.position.set(0, 0.51, -1.55);

  const keyboard = new KeyboardInput(window);
  resources.push(keyboard);
  const input = new InputMapper(keyboard);
  // The input fixture owns its own probe overlay when enabled.
  const latencyView =
    import.meta.env.VITE_TEST_API === '1'
      ? undefined
      : new LatencyProbeView(input.latency, document.body);
  if (latencyView) resources.push(latencyView);
  view.renderer.domElement.tabIndex = 0;
  view.renderer.domElement.focus();

  const requested: GameInput = {
    throttle: 0,
    brake: 0,
    steer: 0,
    handbrake: false,
    boost: false,
  };
  let sampled: Readonly<GameInput> = requested;
  let source: 'keyboard' | 'gamepad' = 'keyboard';
  let injected = false;
  let stepStart = 0;
  let frameTime = 0;
  const cameraOffset = new Vector3(0, 4, 9);
  const cameraTarget = new Vector3();
  const measurements = new PerformanceRecorder();
  let perfStepDriver: ((step: number) => void) | undefined;
  let perfCompletedSteps = 0;
  let perfTotalSteps = 0;
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
      measurement: measurements,
      shouldStopStepping: () =>
        perfTotalSteps > 0 && perfCompletedSteps === perfTotalSteps,
      sampleForStep() {
        if (perfCompletedSteps < perfTotalSteps)
          perfStepDriver?.(perfCompletedSteps);
        const live = input.sampleForStep();
        sampled = injected ? requested : live;
        source = injected ? 'keyboard' : live.source;
        if (live.actions.respawn > 0) respawn();
      },
      preStep(dt) {
        history.beforeStep();
        stepStart = performance.now();
        vehicle.preStep(dt, sampled, source);
      },
      stepPhysics(dt) {
        const engineStarted = performance.now();
        physics.step(dt);
        measurements.recordEngineStep(performance.now() - engineStarted);
      },
      postStep(dt) {
        vehicle.postStep(dt);
        history.afterStep();
        track.checkKillPlane(vehicle.telemetry.position, respawn);
        vehicle.telemetry.physicsStepMs = performance.now() - stepStart;
        if (
          perfCompletedSteps < perfTotalSteps &&
          ++perfCompletedSteps === perfTotalSteps
        )
          loop.setPaused(true);
      },
      render(alpha) {
        vehicle.telemetry.totalSteps = loop.totalSteps;
        vehicle.telemetry.stepsPerFrame = loop.stepsThisFrame;
        vehicle.telemetry.alpha = alpha;
        vehicle.telemetry.physicsHz = tuning.get('physicsHz');
        vehicle.telemetry.timeScale = tuning.get('timeScale');
        const pose = history.interpolate(alpha);
        chassis.position.copy(pose.position);
        chassis.quaternion.copy(pose.rotation);
        cameraTarget
          .copy(cameraOffset)
          .applyQuaternion(pose.rotation)
          .add(pose.position);
        view.camera.position.copy(cameraTarget);
        cameraTarget
          .set(0, 0.6, -4)
          .applyQuaternion(pose.rotation)
          .add(pose.position);
        view.camera.lookAt(cameraTarget);
        track.updateLighting(pose.position);
        view.render();
        input.framePresented(frameTime);
        latencyView?.render(frameTime);
        game.ready = true;
      },
    },
  );
  function respawn(): void {
    massRebuild.flush();
    vehicle.respawn();
    history.reset();
    loop.resetClock();
  }
  const massRebuild = new DebouncedMassRebuild(tuning, () => {
    vehicle.rebuildMassProperties();
    history.reset();
  });
  resources.push(massRebuild);
  unsubscribe = tuning.onChange((change) => {
    if (change.key === 'wallFriction' || change.key === 'restitution') {
      for (const barrier of trackBodies.barriers) {
        physics.setContactProperties(
          barrier,
          tuning.get('wallFriction'),
          tuning.get('restitution'),
        );
      }
    }
    if (
      change.key === 'angularDamping' ||
      change.key === 'maxAngularVelocity' ||
      change.key === 'wallFriction' ||
      change.key === 'restitution'
    )
      vehicle.updateBodyProperties();
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
  game.setInput = (override) => {
    for (const key of ['throttle', 'brake', 'steer'] as const) {
      if (override[key] !== undefined && !Number.isFinite(override[key]))
        throw new RangeError('Input must be finite.');
    }
    Object.assign(requested, override);
    injected = true;
  };
  game.releaseInput = () => {
    injected = false;
  };
  game.setDriftMeter = (value) => {
    vehicle.setDriftMeter(value);
  };
  game.stepMany = (count) => {
    massRebuild.flush();
    loop.stepMany(count);
  };
  game.getTelemetry = () => {
    const s = vehicle.telemetry;
    return {
      ...s,
      mass: vehicle.currentMass,
      massRebuildStatus: massRebuild.state.status,
      position: { x: s.position.x, y: s.position.y, z: s.position.z },
      rotation: {
        x: s.rotation.x,
        y: s.rotation.y,
        z: s.rotation.z,
        w: s.rotation.w,
      },
      velocity: { x: s.velocity.x, y: s.velocity.y, z: s.velocity.z },
      angularVelocity: {
        x: s.angularVelocity.x,
        y: s.angularVelocity.y,
        z: s.angularVelocity.z,
      },
      cameraPosition: {
        x: view.camera.position.x,
        y: view.camera.position.y,
        z: view.camera.position.z,
      },
      wheels: s.wheels.map((wheel) => ({
        Fx: wheel.Fx,
        Fy: wheel.Fy,
        mu: wheel.mu,
        compression: wheel.compression,
        suspensionLength: wheel.suspensionLength,
        steerAngle: wheel.steerAngle,
        spinAngle: wheel.spinAngle,
        Fz: wheel.Fz,
        alpha: wheel.alpha,
        gripUsage: wheel.gripUsage,
        spinning: wheel.spinning,
        locked: wheel.locked,
        grounded: wheel.grounded,
      })),
      droppedSeconds: loop.droppedSeconds,
      totalSteps: loop.totalSteps,
      stepsPerFrame: loop.stepsThisFrame,
      alpha: loop.alpha,
      physicsHz: tuning.get('physicsHz'),
      timeScale: tuning.get('timeScale'),
    };
  };
  game.respawn = respawn;
  game.runPhysicsSpike = () => runPhysicsSpike(createPhysicsWorld);
  game.perf = {
    start(totalSteps) {
      if (!Number.isSafeInteger(totalSteps) || totalSteps < 1)
        throw new RangeError(
          'Performance replay length must be a positive step count.',
        );
      perfCompletedSteps = 0;
      perfTotalSteps = totalSteps;
      measurements.start();
      loop.setPaused(false);
    },
    setPaused: (paused) => measurements.setPaused(paused),
    pauseSimulation: (paused) => loop.setPaused(paused),
    setStepDriver(driver) {
      perfStepDriver = driver;
    },
    progress: () => ({
      completedSteps: perfCompletedSteps,
      totalSteps: perfTotalSteps,
      done: perfTotalSteps > 0 && perfCompletedSteps === perfTotalSteps,
    }),
    drain: () => measurements.drain(),
    getMemory() {
      const memory = { heapBytes: 0, freeBytes: 0 };
      physics.getMemoryStats(memory);
      return memory;
    },
  };
  visibilityChanged = () => {
    loop.setPaused(document.hidden);
  };
  document.addEventListener('visibilitychange', visibilityChanged);
  visibilityChanged();
  function frame(nowMs: number): void {
    frameTime = nowMs;
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
