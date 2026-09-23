import { GAME_NAME } from './core/constants';
import { createGameStub } from './core/gameApi';
import type { GameInput } from './core/gameApi';
import { DebouncedMassRebuild } from './core/massRebuild';
import { FixedStepLoop } from './core/loop';
import { PerformanceRecorder } from './core/performance';
import { TransformHistory } from './core/transforms';
import { mountAudioDirector } from './audio/mount';
import {
  createImpactSeverity,
  estimateImpactSeverity,
} from './core/impactSeverity';
import { ImpactFeedback } from './core/impactFeedback';
import { DEFAULT_ENGINE } from './vehicle/engineProfile';
import type { AudioDirector } from './audio/director';
import { resolveGroundedSurface } from './content/surfaces';
import type { IPhysicsWorld, V3 } from './physics/adapter';
import { runPhysicsSpike } from './physics/spike';
import { createRenderer } from './render/renderer';
import { CameraRig } from './render/cameraRig';
import { createCarVisual } from './render/carVisual';
import { createSkidMarks } from './render/skidMarks';
import { createSpeedCues } from './render/speedCues';
import { createBreakablePropsVisual } from './render/breakablePropsVisual';
import { prepareScene } from './render/prepareScene';
import { BUILTIN_PRESETS } from './tuning/presets';
import type { BuiltinPresetName } from './tuning/presets';
import { isParamKey } from './tuning/schema';
import { TuningStore } from './tuning/store';
import { KeyboardInput } from './input/keyboard';
import { InputMapper } from './input/mapper';
import { ScriptController } from './input/script';
import type { ActionCounts } from './input/types';
import { mountOptionsPanel } from './ui/optionsPanel';
import { mountHud } from './ui/hud';
import { mountPauseMenu } from './ui/pauseMenu';
import { mountControllerSupport } from './ui/controllerSupport';
import { LatencyProbeView } from './input/latencyProbe';
import { Vehicle } from './vehicle/vehicle';
import { VehicleVisualHistory } from './vehicle/visualState';
import { createTestTrack, installTrackColliders } from './world/track';
import { createPropPools } from './world/bodyPool';
import { createRampVisual, installRamps } from './world/ramps';
import { createLoopVisual, installLoops } from './world/loopDeLoop';
import { createBreakableProps } from './world/breakableProps';
import { BREAKABLE_PROP_PLACEMENTS } from './world/breakablePlacements';
import { createSurfacedBodies } from './world/surfacedBodies';
import { createSurfaceRegistry } from './world/surfaceRegistry';
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
  // One registry for every body: the track registers its ground and
  // barriers, and everything added later goes through the surfaced facade,
  // so no body can exist without an authored surface (and therefore grip).
  const surfaceRegistry = createSurfaceRegistry();
  const surfaceResolver = track.createSurfaceResolver(
    trackBodies,
    surfaceRegistry,
  );
  const surfacedBodies = createSurfacedBodies(physics, surfaceRegistry);
  // Ramps are static geometry installed through the facade, so each one
  // registers its asphalt surface in the call that creates it (design slice
  // B5). Collider and mesh come from the same descriptor.
  installRamps(surfacedBodies);
  const rampVisual = createRampVisual(view.scene, track.materials.asphalt);
  resources.push(rampVisual);
  // The loop-de-loop: a helix of pitched slabs, data through the same facade.
  installLoops(surfacedBodies);
  const loopVisual = createLoopVisual(view.scene, track.materials.asphalt);
  resources.push(loopVisual);
  // Phase C props and debris are reserved now so that no body is created or
  // destroyed mid-session; see POOL_BUDGET for the arithmetic.
  const propPools = createPropPools(surfacedBodies);
  const vehicle = new Vehicle(
    physics,
    tuning,
    track.spawn.position,
    surfaceResolver,
  );
  // Four authored banks of eight plus two eight-panel smash gates sit on the
  // infield. They stay clear of the scripted routes and racing line; the
  // placement module is data only so the route can move without changing
  // lifecycle code.
  const breakableProps = createBreakableProps({
    physics,
    pools: propPools,
    placements: BREAKABLE_PROP_PLACEMENTS,
    vehicleBody: vehicle.body,
  });
  const breakablePropsVisual = createBreakablePropsVisual(
    view.scene,
    physics,
    breakableProps,
    track.materials.barrier,
  );
  resources.push(
    breakablePropsVisual,
    breakableProps,
    propPools,
    surfacedBodies,
  );
  const history = new TransformHistory(physics, vehicle.body);
  const visualHistory = new VehicleVisualHistory(vehicle.telemetry);
  const carVisual = createCarVisual(view.scene);
  const cameraRig = new CameraRig(view.camera, tuning);
  const skids = createSkidMarks(view.scene);
  const speedCues = createSpeedCues(host!);
  const cueState = { speed: 0, topSpeed: 1, boostEnvelope: 0 };
  const cueOptions = {
    speedLinesStrength: tuning.get('speedLinesStrength'),
    vignetteStrength: tuning.get('vignetteStrength'),
  };
  speedCues.setOptions(cueOptions);
  resources.push(carVisual, skids, speedCues);
  const preparedScene = prepareScene(view.scene);
  resources.push(preparedScene);

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
  const measurements = new PerformanceRecorder();
  let perfStepDriver: ((step: number) => void) | undefined;
  let perfCompletedSteps = 0;
  let perfTotalSteps = 0;
  let optionsPaused = false;
  let menuPaused = false;
  let userPaused = false;
  let perfPaused = false;
  let replayStopped = false;
  let replayActive = false;
  let respawnRequested = false;
  const renderTelemetry = {
    cameraFov: 70,
    cameraFovRequested: 70,
    cameraFovCapped: false,
    renderScale: 1,
    smoothedFrameMs: 0,
  };
  function isPaused(): boolean {
    return (
      document.hidden ||
      optionsPaused ||
      menuPaused ||
      userPaused ||
      perfPaused ||
      replayStopped
    );
  }
  function syncPause(): void {
    loop.setPaused(isPaused());
  }
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
        (perfTotalSteps > 0 && perfCompletedSteps === perfTotalSteps) ||
        !scripts.canStep(),
      sampleForStep() {
        if (perfCompletedSteps < perfTotalSteps)
          perfStepDriver?.(perfCompletedSteps);
        const live = input.sampleForStep();
        sampled = injected ? requested : live;
        source = injected ? 'keyboard' : live.source;
        dispatchActions(live.actions);
      },
      preStep(dt) {
        history.beforeStep();
        visualHistory.beforeStep();
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
        breakableProps.update(dt);
        history.afterStep();
        track.checkKillPlane(vehicle.telemetry.position, requestRespawn);
        vehicle.telemetry.physicsStepMs = performance.now() - stepStart;
        if (
          perfCompletedSteps < perfTotalSteps &&
          ++perfCompletedSteps === perfTotalSteps
        ) {
          perfPaused = true;
          syncPause();
        }
        skids.sample(vehicle.telemetry.wheels, loop.simulationSeconds + dt);
        hud.recordStep(vehicle.telemetry, dt, renderTelemetry);
        // A counted landing kicks camera, rumble and a surface crunch through
        // the same severity record as a wall hit. The counter is monotonic, so
        // this catches every landing regardless of steps per frame; the
        // feedback seam suppresses it when a chassis contact already fired.
        if (vehicle.telemetry.landingCount !== landingsSeen) {
          landingsSeen = vehicle.telemetry.landingCount;
          const wheels = vehicle.telemetry.wheels;
          let grounded = -1;
          for (let i = 0; i < wheels.length && grounded < 0; i++)
            if (wheels[i]!.grounded) grounded = i;
          if (grounded >= 0) {
            const wheel = wheels[grounded]!;
            impactFeedback.onLanding(
              wheel.hit.bodyId,
              resolveGroundedSurface(true, wheel.surfaceId)?.audioProfile ??
                null,
              vehicle.landingImpact,
            );
          }
        }
        impactFeedback.endStep();
        controllerSupport.afterStep(dt);
        audio.afterStep(dt);
        scripts.afterStep();
        if (respawnRequested) respawn();
      },
      render(alpha) {
        vehicle.telemetry.totalSteps = loop.totalSteps;
        vehicle.telemetry.stepsPerFrame = loop.stepsThisFrame;
        vehicle.telemetry.alpha = alpha;
        vehicle.telemetry.physicsHz = tuning.get('physicsHz');
        vehicle.telemetry.timeScale = tuning.get('timeScale');
        const pose = history.interpolate(alpha);
        carVisual.update(visualHistory.interpolate(alpha, pose));
        breakablePropsVisual.update();
        cameraRig.update(pose, vehicle.telemetry, loop.renderDeltaSeconds);
        skids.update(loop.simulationSeconds + alpha / tuning.get('physicsHz'));
        track.updateLighting(pose.position);
        view.render(frameTime);
        speedCues.resize(
          view.size.width,
          view.size.height,
          Math.min(window.devicePixelRatio, 2),
        );
        cueState.speed = vehicle.telemetry.speed;
        cueState.topSpeed = tuning.get('topSpeed');
        cueState.boostEnvelope = vehicle.telemetry.boostEnvelope;
        speedCues.update(cueState, loop.renderDeltaSeconds);
        renderTelemetry.cameraFov = cameraRig.telemetry.cameraFov;
        renderTelemetry.cameraFovRequested =
          cameraRig.telemetry.cameraFovRequested;
        renderTelemetry.cameraFovCapped = cameraRig.telemetry.cameraFovCapped;
        renderTelemetry.renderScale = view.resolution.scale;
        renderTelemetry.smoothedFrameMs = view.resolution.smoothedFrameMs;
        options.update(frameTime);
        hud.update(frameTime);
        input.framePresented(frameTime);
        latencyView?.render(frameTime);
        game.ready = true;
      },
    },
  );
  function resetPresentation(): void {
    history.reset();
    visualHistory.reset();
    cameraRig.reset();
    skids.breakStrips();
    breakableProps.reset();
    controllerSupport.reset();
    audio.reset();
    loop.resetClock();
  }
  function requestRespawn(): void {
    respawnRequested = true;
  }
  function respawn(): void {
    respawnRequested = false;
    scripts.cancel();
    replayStopped = replayActive = false;
    massRebuild.flush();
    vehicle.respawn(track.spawn.position, track.spawn.rotation);
    resetPresentation();
    scripts.noteRespawn(track.spawn, 0);
    syncPause();
  }
  const massRebuild = new DebouncedMassRebuild(tuning, () => {
    vehicle.rebuildMassProperties();
    history.reset();
    visualHistory.reset();
  });
  resources.push(massRebuild);
  unsubscribe = tuning.onChange((change) => {
    if (
      change.key === 'speedLinesStrength' ||
      change.key === 'vignetteStrength'
    ) {
      cueOptions.speedLinesStrength = tuning.get('speedLinesStrength');
      cueOptions.vignetteStrength = tuning.get('vignetteStrength');
      speedCues.setOptions(cueOptions);
    }
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
  const options = mountOptionsPanel({
    host: host!,
    drivingSurface: view.renderer.domElement,
    store: tuning,
    readRebuildState: () => massRebuild.state,
    readTelemetry: () => vehicle.telemetry,
    onPauseChange(paused) {
      optionsPaused = paused;
      syncPause();
    },
  });
  // Options restores persistence through the same store; apply any mass change
  // before the first step, after the live body/visual subscriptions are installed.
  massRebuild.flush();
  // The menu precedes the shared controller overlay; its audio callbacks become
  // live after the director mounts on that overlay below.
  let menuAudio: AudioDirector | undefined = undefined;
  const pauseMenu = mountPauseMenu({
    host: host!,
    buildLabel: import.meta.env.VITE_BUILD_LABEL,
    drivingSurface: view.renderer.domElement,
    readPaused: isPaused,
    onPauseChange(paused) {
      menuPaused = paused;
      syncPause();
    },
    // Explicit menu Restart bypasses the gameplay R / pad Y command guard.
    onRespawn: respawn,
    options,
    readGamepad: () => input.gamepad.state,
    readAudioState: () => menuAudio?.state,
    onToggleAudioMute: () => menuAudio?.toggleMasterMute(),
  });
  const hud = mountHud({
    host: options.root,
    store: tuning,
    session: options.session,
    readTelemetry: () => vehicle.telemetry,
    readRenderTelemetry: () => renderTelemetry,
  });
  const scripts = new ScriptController({
    store: tuning,
    mapper: input,
    reset(spawn) {
      injected = false;
      perfStepDriver = undefined;
      perfCompletedSteps = perfTotalSteps = 0;
      massRebuild.cancel();
      vehicle.rebuildMassProperties();
      vehicle.respawn(spawn.position, spawn.rotation);
      resetPresentation();
    },
    readTelemetry: () => vehicle.telemetry,
    onComplete() {
      replayActive = false;
      replayStopped = true;
      syncPause();
    },
    onError() {
      replayActive = false;
      replayStopped = true;
      syncPause();
    },
  });
  scripts.noteRespawn(track.spawn, 0);
  const controllerSupport = mountControllerSupport({
    host: host!,
    input,
    tuning,
    options,
    pauseMenu,
    readTelemetry: () => vehicle.telemetry,
    readPaused: isPaused,
  });
  const audio = mountAudioDirector({
    host: host!,
    tuning,
    engine: DEFAULT_ENGINE,
    readTelemetry: () => vehicle.telemetry,
    readPaused: isPaused,
    resolveGroundedSurface,
  });
  menuAudio = audio;
  // Remove audio's prompt/listeners before the controller overlay they share.
  // Release controller capture/navigation before disposing their UI owners.
  // Menu disposal restores the shared Options element before Options removes it.
  resources.push(audio, controllerSupport, pauseMenu, options, hud, scripts);
  const impactNormal: V3 = { x: 0, y: 0, z: 0 };
  const impact = createImpactSeverity();
  let landingsSeen = vehicle.telemetry.landingCount;
  const impactFeedback = new ImpactFeedback({
    camera: cameraRig,
    haptics: controllerSupport,
    audio,
  });
  // One subscriber serves camera, controller and audio, and ONE severity
  // estimate serves all three (src/core/impactSeverity.ts). Jolt's normal
  // separates body B; orient our reused record out of the other surface into
  // the vehicle. Telemetry velocity is pre-step here, which is the approach
  // speed against a static obstacle; the record says it is estimated.
  physics.onContact((a, b, impulse, point, normal) => {
    if (a !== vehicle.body && b !== vehicle.body) return;
    const direction = a === vehicle.body ? -1 : 1;
    impactNormal.x = normal.x * direction;
    impactNormal.y = normal.y * direction;
    impactNormal.z = normal.z * direction;
    estimateImpactSeverity(
      impulse,
      vehicle.telemetry.velocity,
      impactNormal,
      vehicle.currentMass,
      impact,
    );
    // Breakables consume this same record; they never estimate the contact a
    // second time. Their boundary copies the borrowed point immediately.
    breakableProps.onContact(
      a,
      b,
      point,
      impactNormal,
      vehicle.telemetry.velocity,
      impact,
    );
    const otherBody = a === vehicle.body ? b : a;
    // This callback runs inside physics.step: consumers only queue fixed
    // scalars here. Audio output runs after simulation in update().
    impactFeedback.onContact(
      otherBody,
      surfaceResolver.resolveContactSurface(otherBody)?.audioProfile ?? null,
      impact,
    );
  });
  function dispatchActions(actions: Readonly<ActionCounts>): void {
    // Master mute remains available while the pause menu owns gameplay input.
    if (actions.muteAudio % 2) audio.toggleMasterMute();
    // Consume gameplay edges on menu transitions too; Y must not leak into the
    // opening or resume frame. Only the menu command acts on an owned batch.
    const menuOwnsBatch = pauseMenu.isOpen || actions.pauseMenu > 0;
    if (actions.pauseMenu % 2) pauseMenu.toggle();
    if (menuOwnsBatch) return;
    if (actions.respawn > 0) respawnRequested = true;
    if (actions.options % 2) options.toggle();
    hud.cycleMode(actions.hud);
    if (actions.recordTelemetry % 2) hud.toggleRecording();
    if (actions.swapAB % 2) options.session.swapSlots();
    if (actions.gizmos % 2) carVisual.toggleDebug();
    if (actions.camera > 0) cameraRig.cyclePreset(actions.camera);
    if (actions.slowMotion % 2)
      tuning.set('timeScale', tuning.get('timeScale') === 0.25 ? 1 : 0.25);
    if (actions.pause % 2) {
      userPaused = !userPaused;
      syncPause();
    }
  }
  game.scripts = {
    load(source, settings) {
      scripts.load(source, settings);
      replayActive = true;
      replayStopped = userPaused = perfPaused = false;
      syncPause();
    },
    progress: () => scripts.progress(),
    cancel() {
      scripts.cancel();
      replayActive = replayStopped = false;
      syncPause();
    },
    result: () => scripts.result(),
    lapProgress: () => scripts.lapProgress(),
    startRecording(name) {
      if (injected || perfStepDriver)
        throw new Error(
          'Release injected input and the perf driver before recording.',
        );
      scripts.startRecording(name);
    },
    stopRecording: () => scripts.stopRecording(),
    get recording() {
      return scripts.recording;
    },
    get recordedSteps() {
      return scripts.recordedSteps;
    },
  };
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
      options.session.applyBuiltin(name as BuiltinPresetName);
    },
  };
  game.setInput = (override) => {
    if (replayActive || scripts.recording)
      throw new Error(
        'Cancel scripted playback or recording before injecting input.',
      );
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
  game.setCameraPreset = (preset) => cameraRig.setPreset(preset);
  game.setHudMode = (mode) => hud.setMode(mode);
  game.setOptionsOpen = (open) => options.setOpen(open);
  game.stepMany = (count) => {
    massRebuild.flush();
    loop.stepMany(count);
  };
  game.getTelemetry = () => {
    const s = vehicle.telemetry;
    return {
      ...s,
      ...cameraRig.telemetry,
      surfaceDiagnostics: s.surfaceDiagnostics
        ? { ...s.surfaceDiagnostics }
        : null,
      audio: { ...audio.state, output: { ...audio.outputState } },
      cameraPreset: cameraRig.preset,
      gizmosVisible: view.scene.getObjectByName('car.gizmos')?.visible ?? false,
      renderScale: view.resolution.scale,
      smoothedFrameMs: view.resolution.smoothedFrameMs,
      skidSegments: skids.strips.reduce(
        (total, strip) => total + strip.count,
        0,
      ),
      skidSegmentsWritten: skids.strips.reduce(
        (total, strip) => total + strip.written,
        0,
      ),
      paused: isPaused(),
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
        surfaceId: wheel.surfaceId,
        surfaceGripMultiplier: wheel.surfaceGripMultiplier,
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
      perfPaused = false;
      syncPause();
    },
    setPaused: (paused) => measurements.setPaused(paused),
    pauseSimulation(paused) {
      perfPaused = paused;
      syncPause();
    },
    setStepDriver(driver) {
      if (driver && (replayActive || scripts.recording))
        throw new Error(
          'Cancel scripted playback or recording before attaching a perf driver.',
        );
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
    syncPause();
    view.resolution.resetClock();
    // Hidden tabs may stop RAF before it can schedule the audio-clock fade.
    audio.update(performance.now());
  };
  document.addEventListener('visibilitychange', visibilityChanged);
  visibilityChanged();
  function frame(nowMs: number): void {
    frameTime = nowMs;
    try {
      // No physics/input-script sample while paused. Both readers consume the
      // mapper's same edge counters, so unpausing cannot replay an action.
      // Active replays still need this command path to close their pause menu.
      if (isPaused() || tuning.get('timeScale') === 0) {
        dispatchActions(input.sampleActions());
        if (respawnRequested) respawn();
      }
      loop.frame(nowMs);
      pauseMenu.update(nowMs);
      controllerSupport.update(nowMs);
      audio.update(nowMs);
    } catch (error) {
      replayStopped = true;
      syncPause();
      console.error(error);
    } finally {
      frameId = requestAnimationFrame(frame);
    }
  }
  // Build-time gate: default production emits no fixture module or panel.
  if (import.meta.env.VITE_TEST_API === '1') {
    const { installInputTestFixture } = await import('./input/testFixture');
    if (disposed) return;
    resources.push(installInputTestFixture());
    const { installAllocationTestFixture } =
      await import('./render/allocationTestFixture');
    if (disposed) return;
    resources.push(
      installAllocationTestFixture(
        view.scene,
        () => loop.frame(frameTime),
        preparedScene.dispose,
      ),
    );
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
