import { GAME_NAME } from './core/constants';
import { createGameStub } from './core/gameApi';
import type { GameInput } from './core/gameApi';
import { DebouncedMassRebuild } from './core/massRebuild';
import { FixedStepLoop } from './core/loop';
import {
  measurePace,
  PerformanceRecorder,
  type PaceMark,
} from './core/performance';
import { TransformHistory } from './core/transforms';
import { mountAudioDirector } from './audio/mount';
import {
  createImpactSeverity,
  estimateImpactSeverity,
} from './core/impactSeverity';
import { ImpactFeedback } from './core/impactFeedback';
import { CrashScore } from './core/crashScore';
import { Takedowns } from './core/takedowns';
import { RoadRage } from './core/roadRage';
import { RoadRageBest, roadRageBestKey } from './core/roadRageBest';
import { PlayerDamage } from './core/playerDamage';
import { HERO_SEDAN } from './vehicle/vehicleDefinition';
import { ImpactTime } from './core/impactTime';
import {
  GARAGE_CLASSES,
  GARAGE_CLASS_IDS,
  isGarageClassId,
  readGarageClass,
  storeGarageClass,
} from './vehicle/garageClasses';
import { WORKING_SET_KEY } from './tuning/storage';
import type { AudioDirector } from './audio/director';
import { resolveGroundedSurface } from './content/surfaces';
import type { IPhysicsWorld, RayHit, V3 } from './physics/adapter';
import { runPhysicsSpike } from './physics/spike';
import { createRenderer } from './render/renderer';
import { CameraRig } from './render/cameraRig';
import { TakedownMoment, canFocusTakedown } from './render/takedownMoment';
import { createCarVisual } from './render/carVisual';
import { createWreckEffects } from './render/wreckEffects';
import { createSkidMarks } from './render/skidMarks';
import { createSpeedCues } from './render/speedCues';
import { createBreakablePropsVisual } from './render/breakablePropsVisual';
import { createStreamedPropVisual } from './render/streamedPropVisual';
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
import { mountCarChoice } from './ui/carChoice';
import { mountHud } from './ui/hud';
import { createRivalGuidance } from './ui/rivalGuidance';
import { mountPauseMenu } from './ui/pauseMenu';
import { mountControllerSupport } from './ui/controllerSupport';
import { LatencyProbeView } from './input/latencyProbe';
import { Vehicle } from './vehicle/vehicle';
import { VehicleVisualHistory } from './vehicle/visualState';
import { createTestTrack, installTrackColliders } from './world/track';
import { nearestRoadPose } from './world/roadGenerator';
import { createPropPools } from './world/bodyPool';
import { createRampVisual, installRamps } from './world/ramps';
import { createLoopVisual, installLoops } from './world/loopDeLoop';
import { createHalfPipeVisual, installHalfPipes } from './world/halfPipe';
import { createJumpRampVisual, installJumpRamps } from './world/jumpRamp';
import { MAPS } from './world/maps';
import { CAR_MODELS } from './world/carModels';
import {
  chooseMapName,
  mapUrl,
  readStoredMapName,
  shouldOfferMapsAtBoot,
  storeMapName,
} from './world/mapChoice';
import { createRunwayVisual } from './world/runways';
import { createRoadDeckVisual } from './world/roadDeck';
import { createCityBuildingsVisual } from './world/cityBuildings';
import { createCoastVisual } from './world/coastVisual';
import { createHighwayVisual } from './world/highwayVisual';
import { createTimedRun } from './core/timedRun';
import { createRaceEvent, type RaceCar } from './core/raceEvent';
import { awardFaceOffWin, createFaceOffReward } from './core/faceOffReward';
import { mountFaceOffPaintChoice } from './ui/faceOffPaintChoice';
import { createAwakeBudget } from './world/awakeBudget';
import { createRunGateVisual } from './world/runGates';
import { createBoostPadTracker, createBoostPadVisual } from './world/boostPads';
import { createTrafficEvents, type TrafficCarView } from './core/trafficEvents';
import type { MiniMapLandmark } from './ui/miniMap';
import {
  createBreakableProps,
  MAX_RESIDENT_BREAKABLES,
} from './world/breakableProps';
import { BREAKABLE_PROP_PLACEMENTS } from './world/breakablePlacements';
import {
  createPropStreamRecords,
  createPropStreamer,
} from './world/propStreaming';
import { createSurfacedBodies } from './world/surfacedBodies';
import { createSurfaceRegistry } from './world/surfaceRegistry';
import { createTraffic, createTrafficVisual } from './world/traffic';
import { createShuntWallVisual, installShuntWalls } from './world/shuntWalls';
import { Vector3 } from 'three';
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
  // The world is a named map: the proving ground by default, the lab ring
  // with `?map=lab` (and in the e2e build). Every structure below is the
  // map's data.
  const mapStorage = (() => {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  })();
  const faceOffReward = createFaceOffReward(mapStorage);
  const garageClassId = readGarageClass(mapStorage, location.search);
  const garageClass = GARAGE_CLASSES[garageClassId];
  if (
    new URLSearchParams(location.search).get('car') === garageClassId &&
    readGarageClass(mapStorage) !== garageClassId
  )
    storeGarageClass(mapStorage, garageClassId, WORKING_SET_KEY);
  tuning.replace({ ...garageClass.tuning }, 'restore');
  const storedMapName = readStoredMapName(mapStorage);
  const mapName = chooseMapName(
    location.search,
    import.meta.env.VITE_DEFAULT_MAP,
    storedMapName,
  );
  const offerMapsAtBoot = shouldOfferMapsAtBoot(
    location.search,
    import.meta.env.VITE_DEFAULT_MAP,
    storedMapName,
  );
  // An explicit URL switch is a choice too: the plain URL keeps it next time.
  if (new URLSearchParams(location.search).get('map') === mapName)
    storeMapName(mapStorage, mapName);
  const map = MAPS[mapName];
  const track = createTestTrack(view.scene, {
    maxAnisotropy: view.renderer.capabilities.getMaxAnisotropy(),
    config: {
      ...map.track,
      wallFriction: tuning.get('wallFriction'),
      restitution: tuning.get('restitution'),
    },
    ...(map.spawn ? { spawn: map.spawn } : {}),
  });
  resources.push(track);
  if (mapName === 'coast-shoreline' || mapName === 'coast-headland')
    resources.push(createCoastVisual(view.scene));
  if (mapName === 'highway-express' || mapName === 'highway-interchange')
    resources.push(createHighwayVisual(view.scene));
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
  if (map.shuntWalls?.length) {
    installShuntWalls(surfacedBodies, map.shuntWalls);
    resources.push(
      createShuntWallVisual(
        view.scene,
        track.materials.barrier,
        map.shuntWalls,
      ),
    );
  }
  // Ramps are static geometry installed through the facade, so each one
  // registers its asphalt surface in the call that creates it (design slice
  // B5). Collider and mesh come from the same descriptor.
  installRamps(surfacedBodies, map.ramps);
  const rampVisual = createRampVisual(
    view.scene,
    track.materials.asphalt,
    map.ramps,
  );
  resources.push(rampVisual);
  // The loop-de-loops: helices of pitched slabs, data through the same facade.
  installLoops(surfacedBodies, map.loops);
  const loopVisual = createLoopVisual(
    view.scene,
    (surface) => track.materials.forSurface(surface),
    map.loops,
  );
  resources.push(loopVisual);
  installJumpRamps(surfacedBodies, map.jumpRamps);
  resources.push(
    createJumpRampVisual(
      view.scene,
      (surface) => track.materials.forSurface(surface),
      map.jumpRamps,
    ),
  );
  // Half-pipes: quarter-pipe walls, a deck and coping rails, data through
  // the same facade, each slab in its surface's material.
  installHalfPipes(surfacedBodies, map.halfPipes);
  resources.push(
    createHalfPipeVisual(
      view.scene,
      (surface) => track.materials.forSurface(surface),
      map.halfPipes,
    ),
  );
  // Accelerator triangles: paint and a footprint test, no bodies. Driving
  // onto one adds padKick along the heading and padBoost of the bar, once
  // per visit; with drift charge slowed, this is how boost is earned.
  // The timed run (NS3): the start line is a thing in the world he drives
  // into; the clock runs to the goal; Enter is the retry, onto the line.
  const roadRage = mapName === 'road-rage' ? new RoadRage() : undefined;
  const roadRageBest = roadRage
    ? new RoadRageBest(
        roadRageBestKey(mapName, 'player-4.8x2.16', tuning.snapshot()),
        mapStorage,
      )
    : undefined;
  const isTakedownRoad = mapName === 'takedown' || !!roadRage;
  const timedRun = createTimedRun(roadRage || (mapName === 'circuit-race' || mapName === 'face-off') ? undefined : map.runs?.[0]);
  const runStartGate = map.runs?.[0]?.gates[0];
  const runStart = roadRage
    ? track.spawn
    : runStartGate
      ? {
          position: {
            x: runStartGate.x,
            y: track.spawn.position.y,
            z: runStartGate.z,
          },
          rotation: {
            x: 0,
            y: Math.sin(runStartGate.heading / 2),
            z: 0,
            w: Math.cos(runStartGate.heading / 2),
          },
        }
      : track.spawn;
  resources.push(
    createRunGateVisual(view.scene, map.runs?.[0], track.config.paintHeight),
  );
  const boostPads = createBoostPadTracker(map.boostPads);
  resources.push(
    createBoostPadVisual(view.scene, map.boostPads, track.config.paintHeight),
  );
  // City road decks are one visual draw over the continuous ground collider.
  if (map.roadDecks?.length)
    resources.push(createRoadDeckVisual(view.scene, map.roadDecks));
  if (map.cityBuildings?.length)
    resources.push(createCityBuildingsVisual(view.scene, map.cityBuildings));
  // Runways are paint on the infield collider: one instanced draw, no bodies.
  resources.push(
    createRunwayVisual(
      view.scene,
      track.materials.paint,
      map.runways,
      track.config,
    ),
  );
  // Phase C props and debris are reserved now so that no body is created or
  // destroyed mid-session; see POOL_BUDGET for the arithmetic.
  const propPools = createPropPools(surfacedBodies);
  const vehicle = new Vehicle(
    physics,
    tuning,
    track.spawn.position,
    surfaceResolver,
    garageClass.engineProfile,
    garageClass.geometry,
  );
  // Traffic events (NS4): near misses, wrong-side driving and slams feed the
  // boost bar. The detector reads the traffic cars' states after physics;
  // until the traffic module lands on main there are none to read.
  const trafficEvents = createTrafficEvents();
  const trafficStates: readonly TrafficCarView[] = [];
  const trafficTuning = {
    nearMissGap: 0,
    nearMissClosing: 0,
    nearMissBoost: 0,
    wrongSideReach: 0,
    wrongSideRate: 0,
    slamBoost: 0,
  };
  const playerView = {
    position: vehicle.telemetry.position,
    forward: { x: 0, z: 1 },
    velocity: vehicle.telemetry.velocity,
    speed: 0,
  };
  // Apply the authored map heading before the first frame; without this
  // initial respawn the proving-ground camera starts facing away from every
  // target even though subsequent respawns use the correct rotation.
  vehicle.respawn(track.spawn.position, track.spawn.rotation);
  const traffic =
    map.path && map.traffic
      ? createTraffic(physics, surfacedBodies, map.path, map.traffic, {
          density: tuning.get('trafficDensity'),
          minGap: tuning.get('trafficMinGap'),
          maxGap: tuning.get('trafficMaxGap'),
        })
      : undefined;
  const race =
    (mapName === 'circuit-race' || mapName === 'face-off') &&
    map.path &&
    map.runs?.[0] &&
    traffic
      ? createRaceEvent(
          map.runs[0],
          map.path,
          traffic.raceStates.map((car) => car.id),
        )
      : undefined;
  const raceCars: RaceCar[] = race
    ? [
        { id: 0, x: 0, z: 0, vx: 0, vz: 0 },
        ...traffic!.raceStates.map((car) => ({
          id: car.id,
          x: 0,
          z: 0,
          vx: 0,
          vz: 0,
        })),
      ]
    : [];
  const takedowns = isTakedownRoad ? new Takedowns() : undefined;
  const takedownMoment = takedowns ? new TakedownMoment() : undefined;
  const playerDamage = takedowns ? new PlayerDamage() : undefined;
  const impactTime = playerDamage ? new ImpactTime() : undefined;
  const trafficVisual = traffic
    ? createTrafficVisual(view.scene, traffic)
    : undefined;
  if (traffic && trafficVisual) resources.push(trafficVisual, traffic);
  const wreckEffects = traffic
    ? createWreckEffects(view.scene, traffic.hasRivals)
    : undefined;
  if (wreckEffects) resources.push(wreckEffects);
  const rivalGuidance = (isTakedownRoad || !!race || mapName === 'face-off') ? createRivalGuidance(host!, mapName === 'face-off' ? 'VESPER' : 'RIVAL') : undefined;
  if (rivalGuidance) resources.push(rivalGuidance);
  const crashScore = new CrashScore();
  // Authored prop records are promoted near the car and represented by a
  // cheap far-field instance elsewhere; the record format is shared with a
  // future map editor so moving content never changes lifecycle code.
  const breakableProps = createBreakableProps({
    physics,
    pools: propPools,
    placements: map.placements ?? BREAKABLE_PROP_PLACEMENTS,
    vehicleBody: vehicle.body,
    onBreak: (severity) => crashScore.recordBreakSeverity(severity),
    initialActiveIndices: [],
    maxActiveProps: MAX_RESIDENT_BREAKABLES,
  });
  // Promoted props sleep until touched; the step-time budget is how many
  // are awake, and this puts the farthest back to sleep when it is exceeded.
  const awakeBudget = createAwakeBudget({
    physics,
    props: breakableProps,
    readVehiclePosition: (out) => {
      const p = vehicle.telemetry.position;
      out.x = p.x;
      out.y = p.y;
      out.z = p.z;
    },
  });
  const propStreamRecords = createPropStreamRecords(
    map.placements ?? BREAKABLE_PROP_PLACEMENTS,
    32,
  );
  const propStreamer = createPropStreamer({
    props: breakableProps,
    records: propStreamRecords,
    // Dense phase-two fields need a tighter promotion window: at 60–80 m/s
    // this still gives roughly one second to promote before contact while
    // keeping the candidate query inside the active-content budget.
    maxPromoted: MAX_RESIDENT_BREAKABLES,
    enterRadius: 90,
    exitRadius: 130,
    readVehiclePosition: (out) => {
      out.x = vehicle.telemetry.position.x;
      out.y = vehicle.telemetry.position.y;
      out.z = vehicle.telemetry.position.z;
    },
  });
  const streamedPropVisual = createStreamedPropVisual(
    view.scene,
    propStreamer,
    breakableProps.propHalfExtents,
    track.materials.barrier,
    {
      readViewPosition: (out) => {
        out.x = vehicle.telemetry.position.x;
        out.y = vehicle.telemetry.position.y;
        out.z = vehicle.telemetry.position.z;
      },
    },
  );
  const breakablePropsVisual = createBreakablePropsVisual(
    view.scene,
    physics,
    breakableProps,
    track.materials.barrier,
  );
  // The small-prop visibility prototype: glow goes to near and far alike so
  // the swap stays invisible; the impostor scale is far-only by design.
  const applyPropLook = (): void => {
    const glow = tuning.get('propGlow');
    breakablePropsVisual.setGlow(glow);
    streamedPropVisual.setGlow(glow);
    streamedPropVisual.setFarScale(tuning.get('propFarScale'));
  };
  applyPropLook();
  resources.push(
    streamedPropVisual,
    propStreamer,
    breakablePropsVisual,
    breakableProps,
    propPools,
    surfacedBodies,
  );
  const history = new TransformHistory(physics, vehicle.body);
  const visualHistory = new VehicleVisualHistory(vehicle.telemetry);
  const carVisual = createCarVisual(view.scene, garageClass.geometry);
  carVisual.setPaint(faceOffReward.selected);
  await carVisual.loadHeroModel();
  // Line of sight for the camera: static geometry between car and camera
  // pulls the camera in, so the loop, a bridge or a prop bank never hides
  // the car. The car's own body is ignored; the ray record is reused.
  const sightHit: RayHit = {
    distance: 0,
    point: { x: 0, y: 0, z: 0 },
    normal: { x: 0, y: 0, z: 0 },
    bodyId: 0,
    surfaceId: 0,
  };
  const sightDirection: V3 = { x: 0, y: 0, z: 0 };
  const cameraRig = new CameraRig(view.camera, tuning, {
    lineOfSight: (from, to) => {
      sightDirection.x = to.x - from.x;
      sightDirection.y = to.y - from.y;
      sightDirection.z = to.z - from.z;
      const span = Math.hypot(
        sightDirection.x,
        sightDirection.y,
        sightDirection.z,
      );
      if (span < 1e-6) return null;
      sightDirection.x /= span;
      sightDirection.y /= span;
      sightDirection.z /= span;
      return physics.rayCast(from, sightDirection, span, sightHit, vehicle.body)
        ? sightHit.distance
        : null;
    },
  });
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
  let perfPaceStart: PaceMark | null = null;
  let perfStepDriver: ((step: number) => void) | undefined;
  let perfCompletedSteps = 0;
  let perfTotalSteps = 0;
  let optionsPaused = false;
  let menuPaused = false;
  let userPaused = false;
  let perfPaused = false;
  let replayStopped = false;
  let replayActive = false;
  let inspectionCamera: { position: V3; target: V3 } | null = null;
  let respawnRequested = false;
  let retryRequested = false;
  let playerWreckPending = false;
  const wreckInput = {
    throttle: 0,
    brake: 0,
    steer: 0,
    handbrake: false,
    boost: false,
  } as const;
  let actionsThisStep = 0;
  const countActions = (actions: Readonly<ActionCounts>): number => {
    let total = 0;
    for (const count of Object.values(actions)) total += count;
    return total;
  };
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
        if (impactTime?.active) return impactTime.timeScale;
        return tuning.get('timeScale') * (takedownMoment?.timeScale ?? 1);
      },
      maxStepsPerFrame: 32,
      maxFrameDeltaSeconds: 0.25,
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
        actionsThisStep = countActions(live.actions);
        dispatchActions(live.actions);
      },
      preStep(dt) {
        history.beforeStep();
        visualHistory.beforeStep();
        stepStart = performance.now();
        vehicle.preStep(
          dt,
          playerDamage?.wrecked ||
            (roadRage && roadRage.state.phase !== 'running') ||
            race?.state.phase === 'countdown'
            ? wreckInput
            : sampled,
          source,
          impactTime?.active ?? false,
        );
        if (impactTime?.active)
          vehicle.applyAftertouch(
            sampled.steer,
            impactTime.steerDeltaVelocity(sampled.steer, dt),
            dt,
          );
        traffic?.preStep(
          dt,
          vehicle.telemetry.position,
          vehicle.telemetry.speed,
        );
      },
      stepPhysics(dt) {
        const engineStarted = performance.now();
        physics.step(dt);
        measurements.recordEngineStep(performance.now() - engineStarted);
      },
      postStep(dt) {
        traffic?.postStep(vehicle.body, vehicle.currentMass);
        vehicle.postStep(dt);
        if (traffic && wreckEffects) {
          wreckEffects.consume(
            traffic.newlyWrecked,
            traffic.states,
            vehicle.telemetry.position,
          );
          wreckEffects.advance(dt);
        }
        const playerRotation = vehicle.telemetry.rotation;
        playerView.forward.x =
          -2 *
          (playerRotation.x * playerRotation.z +
            playerRotation.y * playerRotation.w);
        playerView.forward.z = -(
          1 -
          2 * (playerRotation.x ** 2 + playerRotation.y ** 2)
        );
        playerView.speed = vehicle.telemetry.speed;
        const wasWrecked = playerDamage?.wrecked ?? false;
        if (!wasWrecked) playerDamage?.step(dt);
        if (!wasWrecked && playerDamage?.wrecked) playerWreckPending = true;
        const startedPlayerWreck = playerWreckPending;
        if (playerWreckPending) {
          roadRage?.notePlayerWreck();
          vehicle.loseBoostSection();
          audio.onPlayerWreck();
          impactTime?.start();
          takedownMoment?.reset();
          cameraRig.setWreckFocus(true);
          playerWreckPending = false;
        }
        impactTime?.advanceSimulation(dt);
        const playerWreckRecoveryDue = impactTime?.consumeRecovery() ?? false;
        if (takedowns) {
          const countBefore = takedowns.count;
          const victim = takedowns.update(dt, traffic?.newlyWrecked ?? []);
          const eventRunning = !roadRage || roadRage.state.phase === 'running';
          const earned = eventRunning ? takedowns.count - countBefore : 0;
          for (let count = 0; count < earned; count++) vehicle.awardTakedown();
          // The collision that wrecked the player is ordinary; only later
          // contacts in this episode can earn Aftertouch credit.
          if (startedPlayerWreck) takedowns.beginAftertouchEpisode();
          const focusVictim =
            eventRunning &&
            !impactTime?.active &&
            !!victim &&
            canFocusTakedown(
              victim,
              vehicle.telemetry.position,
              playerView.forward,
            );
          if (focusVictim) audio.onTakedown();
          if (victim && focusVictim)
            takedownMoment?.start(victim.id, performance.now());
          else if (eventRunning && !victim && takedowns.lastObservedVictim) {
            const other = takedowns.lastObservedVictim;
            const player = vehicle.telemetry.position;
            if (
              Math.hypot(
                other.position.x - player.x,
                other.position.z - player.z,
              ) < 140
            ) {
              const nowMs = performance.now();
              rivalGuidance?.showRivalWreck(nowMs);
            }
          }
          if (roadRage) {
            const wasCountdown = roadRage.state.phase === 'countdown';
            roadRage.step(dt, earned);
            if (
              roadRage.state.changed &&
              roadRage.state.finishReason === 'time'
            )
              roadRageBest?.record(roadRage.state.count, roadRage.state.wrecks);
            // Wrecks during the countdown have been observed but can never
            // carry player attribution or score over the GO boundary.
            if (wasCountdown && roadRage.state.phase === 'running')
              takedowns.reset();
          }
        }
        breakableProps.update(dt);
        {
          const entered = boostPads.update(
            vehicle.telemetry.position.x,
            vehicle.telemetry.position.z,
          );
          if (entered > 0)
            vehicle.applyPad(
              tuning.get('padKick') * entered,
              tuning.get('padBoost') * entered,
            );
        }
        {
          trafficTuning.nearMissGap = tuning.get('nearMissGap');
          trafficTuning.nearMissClosing = tuning.get('nearMissClosing');
          trafficTuning.nearMissBoost = tuning.get('nearMissBoost');
          trafficTuning.wrongSideReach = tuning.get('wrongSideReach');
          trafficTuning.wrongSideRate = tuning.get('wrongSideRate');
          trafficTuning.slamBoost = tuning.get('slamBoost');
          const nearMissesBefore = trafficEvents.state.nearMisses;
          const grant = trafficEvents.update(
            dt,
            playerView,
            traffic?.states ?? trafficStates,
            trafficTuning,
          );
          if (trafficEvents.state.nearMisses !== nearMissesBefore)
            audio.onNearMiss(
              trafficEvents.state.nearMissSide,
              trafficEvents.state.nearMissClosingSpeed,
            );
          if (grant > 0) vehicle.applyPad(0, grant);
        }
        crashScore.update(dt);
        timedRun.update(
          dt,
          vehicle.telemetry.position.x,
          vehicle.telemetry.position.z,
          vehicle.telemetry.speed,
        );
        if (race && traffic) {
          const player = raceCars[0]! as {
            id: number;
            x: number;
            z: number;
            vx: number;
            vz: number;
          };
          player.x = vehicle.telemetry.position.x;
          player.z = vehicle.telemetry.position.z;
          player.vx = vehicle.telemetry.velocity.x;
          player.vz = vehicle.telemetry.velocity.z;
          for (let index = 0; index < traffic.raceStates.length; index++) {
            const state = traffic.raceStates[index]!;
            const car = raceCars[index + 1]! as typeof player;
            car.x = state.position.x;
            car.z = state.position.z;
            car.vx = state.velocity.x;
            car.vz = state.velocity.z;
          }
          race.update(dt, raceCars);
          if (
            mapName === 'face-off' &&
            awardFaceOffWin(race.state, faceOffReward)
          )
            faceOffPaintChoice?.refresh();
          for (const state of traffic.raceStates)
            traffic.setRaceValidatedStation(
              state.id,
              race.validatedStation(state.id),
            );
          traffic.setRaceRunning(race.state.phase !== 'countdown');
        }
        propStreamer.update();
        awakeBudget.update(
          tuning.get('awakeBudget'),
          tuning.get('awakeKeepRadius'),
        );
        history.afterStep();
        if (!playerDamage?.wrecked && roadRage?.state.phase !== 'finished')
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
        // What the driver is doing this step, for the HUD reminder's idle
        // timer: driving input or any keypress counts, a resting stick does not.
        hud.noteInput(sampled, actionsThisStep);
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
        if (retryRequested) retry();
        else if (respawnRequested && roadRage?.state.phase !== 'finished')
          respawn();
        else if (playerWreckRecoveryDue && roadRage?.state.phase !== 'finished')
          respawnAfterWreck();
      },
      render(alpha) {
        vehicle.telemetry.totalSteps = loop.totalSteps;
        vehicle.telemetry.stepsPerFrame = loop.stepsThisFrame;
        vehicle.telemetry.alpha = alpha;
        vehicle.telemetry.physicsHz = tuning.get('physicsHz');
        vehicle.telemetry.timeScale = tuning.get('timeScale');
        const pose = history.interpolate(alpha);
        carVisual.update(visualHistory.interpolate(alpha, pose));
        if (playerDamage) carVisual.setCrush(playerDamage.crush);
        breakablePropsVisual.update();
        trafficVisual?.update();
        wreckEffects?.render();
        streamedPropVisual.update();
        cameraRig.update(pose, vehicle.telemetry, loop.renderDeltaSeconds);
        if (takedownMoment && traffic && !impactTime?.active)
          takedownMoment.apply(
            view.camera,
            traffic.states,
            vehicle.telemetry.position,
            playerView.forward,
            frameTime,
          );
        if (inspectionCamera) {
          view.camera.position.set(
            inspectionCamera.position.x,
            inspectionCamera.position.y,
            inspectionCamera.position.z,
          );
          view.camera.up.set(0, 1, 0);
          view.camera.lookAt(
            inspectionCamera.target.x,
            inspectionCamera.target.y,
            inspectionCamera.target.z,
          );
        }
        if (rivalGuidance && traffic)
          rivalGuidance.update(
            view.camera,
            traffic.states,
            vehicle.telemetry.position,
          );
        carVisual.updateLod(view.camera, view.size.height);
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
    wreckEffects?.reset();
    boostPads.reset();
    trafficEvents.reset();
    takedownMoment?.reset();
    takedowns?.endAftertouchEpisode();
    impactTime?.reset();
    history.reset();
    visualHistory.reset();
    cameraRig.reset();
    skids.breakStrips();
    propStreamer.reset();
    controllerSupport.reset();
    audio.reset();
    crashScore.resetChain();
    loop.resetClock();
  }
  function requestRespawn(): void {
    respawnRequested = true;
  }
  function respawn(): void {
    if (roadRage || race) {
      retry();
      return;
    }
    respawnRequested = false;
    playerWreckPending = false;
    scripts.cancel();
    replayStopped = replayActive = false;
    massRebuild.flush();
    vehicle.respawn(track.spawn.position, track.spawn.rotation);
    playerDamage?.reset();
    resetPresentation();
    timedRun.abandon();
    scripts.noteRespawn(track.spawn, 0);
    syncPause();
  }
  /** Instant retry (NS3): a respawn that also forgets the run. Respawn keeps
   * the free-drive score and ends the chain; retry zeroes the score, and
   * whatever the timed run adds (its clock) resets here too. It is applied
   * on the same step the key is read, so "again" is one press and no wait. */
  function retry(): void {
    retryRequested = false;
    respawnRequested = false;
    playerWreckPending = false;
    scripts.cancel();
    replayStopped = replayActive = false;
    massRebuild.flush();
    // Onto the start line itself: the next step is an arrival and the
    // countdown begins at once.
    const restart = race ? track.spawn : runStart;
    vehicle.respawn(restart.position, restart.rotation);
    playerDamage?.reset();
    resetPresentation();
    takedowns?.reset();
    if (roadRage) {
      traffic?.resetForEvent();
      roadRage.reset();
    }
    crashScore.reset();
    timedRun.reset();
    if (race) {
      race.reset();
      traffic?.resetRaceGrid();
    }
    scripts.noteRespawn(restart, 0);
    syncPause();
  }
  /** A takedown-map wreck preserves the race and earned sections after losing
   * one, but starts a pristine car at rest on the nearest finish-facing road. */
  function respawnAfterWreck(): void {
    if (!playerDamage || !map.path) return;
    const road = nearestRoadPose(map.path, vehicle.telemetry.position);
    const sections = vehicle.telemetry.boostSections;
    const spawn = {
      position: { x: road.x, y: track.spawn.position.y, z: road.z },
      rotation: {
        x: 0,
        y: Math.sin(road.heading / 2),
        z: 0,
        w: Math.cos(road.heading / 2),
      },
    };
    vehicle.respawn(spawn.position, spawn.rotation, sections);
    playerDamage.reset();
    resetPresentation();
    scripts.noteRespawn(spawn, 0);
  }
  const massRebuild = new DebouncedMassRebuild(tuning, () => {
    vehicle.rebuildMassProperties();
    history.reset();
    visualHistory.reset();
  });
  resources.push(massRebuild);
  unsubscribe = tuning.onChange((change) => {
    if (
      change.key === 'trafficDensity' ||
      change.key === 'trafficMinGap' ||
      change.key === 'trafficMaxGap'
    )
      traffic?.setRules({
        density: tuning.get('trafficDensity'),
        minGap: tuning.get('trafficMinGap'),
        maxGap: tuning.get('trafficMaxGap'),
      });
    if (change.key === 'propGlow' || change.key === 'propFarScale')
      applyPropLook();
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
  const faceOffPaintChoice = mountFaceOffPaintChoice(
    options.element,
    faceOffReward,
    () => carVisual.setPaint(faceOffReward.selected),
  );
  let applyingStoredCarPaint = true;
  resources.push(
    mountCarChoice(options.element, (paint) => {
      if (applyingStoredCarPaint && faceOffReward.selected === 'vesper-gold') {
        applyingStoredCarPaint = false;
        return;
      }
      applyingStoredCarPaint = false;
      if (faceOffReward.selected === 'vesper-gold') {
        faceOffReward.select('orange');
        faceOffPaintChoice.refresh();
      }
      carVisual.setPaint(paint);
    }),
  );
  const miniMapLandmarks: MiniMapLandmark[] = [];
  for (const ramp of map.ramps)
    miniMapLandmarks.push({
      x: ramp.x,
      z: ramp.z,
      label: 'R',
      color: '#ff7a24',
    });
  for (const loop of map.loops)
    miniMapLandmarks.push({
      x: loop.x,
      z: loop.z,
      label: 'L',
      color: '#4fb0ff',
    });
  for (const pipe of map.halfPipes)
    miniMapLandmarks.push({
      x: pipe.x,
      z: pipe.z,
      label: 'A',
      color: '#ffd34f',
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
    maps: {
      current: mapName,
      entries: Object.entries(MAPS).map(([name, entry]) => ({
        name,
        label: entry.label,
      })),
      onSelect(name) {
        if (name === mapName) {
          pauseMenu.setOpen(false);
          return;
        }
        if (Object.hasOwn(MAPS, name)) {
          storeMapName(mapStorage, name as keyof typeof MAPS);
          location.assign(mapUrl(location.pathname, name as keyof typeof MAPS));
        }
      },
    },
    garage: {
      current: garageClassId,
      entries: GARAGE_CLASS_IDS.map((id) => ({
        name: id,
        label: GARAGE_CLASSES[id].label,
        trait: GARAGE_CLASSES[id].trait,
      })),
      onSelect(name) {
        if (!isGarageClassId(name) || name === garageClassId) {
          pauseMenu.setOpen(false);
          return;
        }
        storeGarageClass(mapStorage, name, WORKING_SET_KEY);
        const url = new URL(location.href);
        url.searchParams.set('car', name);
        location.assign(url.toString());
      },
    },
  });
  if (offerMapsAtBoot)
    // The first boot ever offers the list, once; every boot after that goes
    // straight to the remembered map. The e2e build's default never prompts.
    requestAnimationFrame(() => pauseMenu.openMaps());
  const hud = mountHud({
    host: options.root,
    store: tuning,
    session: options.session,
    readTelemetry: () => vehicle.telemetry,
    readScore: () => crashScore.state,
    readRun: () => timedRun.state,
    ...(race ? { readRace: () => race.state } : {}),
    ...(race
      ? {
          raceKind:
            mapName === 'face-off'
              ? ('face-off' as const)
              : ('circuit' as const),
        }
      : {}),
    readTrafficEvents: () => trafficEvents.state,
    ...(takedowns
      ? {
          readTakedowns: () => roadRage?.state.count ?? takedowns.count,
          readTakedownKind: () => takedowns.lastCreditKind,
        }
      : {}),
    ...(roadRage
      ? {
          readRoadRage: () => roadRage.state,
          readRoadRageBest: () => roadRageBest?.value ?? null,
        }
      : {}),
    ...(playerDamage
      ? {
          readPlayerDamage: () => ({
            amount: playerDamage.damage,
            wrecked: playerDamage.wrecked,
            secondsLeft: playerDamage.wreckSecondsLeft,
            impactTime: impactTime?.active ?? false,
          }),
        }
      : {}),
    readRenderTelemetry: () => renderTelemetry,
    miniMap: {
      landmarks: miniMapLandmarks,
      route: map.route,
      halfSize:
        isTakedownRoad || !!race || mapName === 'face-off'
          ? 200
          : Math.max(track.config.pavedRadius, track.config.barrierInnerRadius),
      followPlayer: isTakedownRoad || !!race || mapName === 'face-off',
      headingUp: isTakedownRoad || !!race || mapName === 'face-off',
      ...(isTakedownRoad || !!race || mapName === 'face-off'
        ? { readRivals: () => traffic?.states ?? [] }
        : {}),
    },
  });
  const scripts = new ScriptController({
    store: tuning,
    mapper: input,
    ring: {
      centerLineRadius: track.config.centerLineRadius,
      innerRadius: track.config.ringInnerRadius,
      outerRadius: track.config.pavedRadius,
    },
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
    engine: garageClass.engineProfile,
    readTelemetry: () => vehicle.telemetry,
    readPaused: isPaused,
    readPresentationTimeScale: () => takedownMoment?.timeScale ?? 1,
    resolveGroundedSurface,
  });
  menuAudio = audio;
  // Remove audio's prompt/listeners before the controller overlay they share.
  // Release controller capture/navigation before disposing their UI owners.
  // Menu disposal restores the shared Options element before Options removes it.
  resources.push(audio, controllerSupport, pauseMenu, options, hud, scripts);
  const impactNormal: V3 = { x: 0, y: 0, z: 0 };
  const relativeImpactVelocity: V3 = { x: 0, y: 0, z: 0 };
  const otherContactVelocityA: V3 = { x: 0, y: 0, z: 0 };
  const otherContactVelocityB: V3 = { x: 0, y: 0, z: 0 };
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
  physics.onContact((a, b, impulse, point, normal, readVelocities) => {
    if (a !== vehicle.body && b !== vehicle.body) {
      const carA = traffic?.stateForBody(a);
      const carB = traffic?.stateForBody(b);
      if (carA || carB) {
        readVelocities(otherContactVelocityA, otherContactVelocityB);
        const dx = otherContactVelocityA.x - otherContactVelocityB.x;
        const dy = otherContactVelocityA.y - otherContactVelocityB.y;
        const dz = otherContactVelocityA.z - otherContactVelocityB.z;
        const normalSpeed = dx * normal.x + dy * normal.y + dz * normal.z;
        const closing = Math.max(0, normalSpeed);
        const tangent = Math.sqrt(
          Math.max(0, dx * dx + dy * dy + dz * dz - normalSpeed * normalSpeed),
        );
        const glassEligible =
          Math.abs(normal.y) < 0.55 &&
          ((carA !== undefined &&
            point.y - (carA.position.y - CAR_MODELS[carA.modelKind].ride) >=
              CAR_MODELS[carA.modelKind].halfExtents.y * 1.1) ||
            (carB !== undefined &&
              point.y - (carB.position.y - CAR_MODELS[carB.modelKind].ride) >=
                CAR_MODELS[carB.modelKind].halfExtents.y * 1.1));
        audio.onCrashContact(a, b, closing, tangent, point, 2, glassEligible);
        const struck = carA ?? carB!;
        wreckEffects?.noteContact(
          a,
          b,
          point,
          struck.position.y - CAR_MODELS[struck.modelKind].ride,
          normal,
          struck.velocity,
          closing,
          tangent,
          glassEligible,
          vehicle.telemetry.position,
        );
      }
      takedowns?.noteCarContact(carA, carB);
      traffic?.onWorldContact(a, b, normal, readVelocities);
      return;
    }
    const direction = a === vehicle.body ? -1 : 1;
    impactNormal.x = normal.x * direction;
    impactNormal.y = normal.y * direction;
    impactNormal.z = normal.z * direction;
    const otherBody = a === vehicle.body ? b : a;
    const trafficVelocity = traffic?.velocityForBody(otherBody);
    const severityVelocity = trafficVelocity
      ? relativeImpactVelocity
      : vehicle.telemetry.velocity;
    if (trafficVelocity) {
      relativeImpactVelocity.x =
        vehicle.telemetry.velocity.x - trafficVelocity.x;
      relativeImpactVelocity.y =
        vehicle.telemetry.velocity.y - trafficVelocity.y;
      relativeImpactVelocity.z =
        vehicle.telemetry.velocity.z - trafficVelocity.z;
    }
    estimateImpactSeverity(
      impulse,
      severityVelocity,
      impactNormal,
      vehicle.currentMass,
      impact,
    );
    if (playerDamage && (!roadRage || roadRage.state.phase === 'running')) {
      const wasWrecked = playerDamage.wrecked;
      playerDamage.noteContact(
        impactNormal,
        severityVelocity,
        vehicle.telemetry.rotation,
      );
      if (!wasWrecked && playerDamage.wrecked) {
        playerWreckPending = true;
      }
    }
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
    takedowns?.notePlayerContact(
      traffic?.stateForBody(otherBody),
      impact.severity,
    );
    traffic?.onPlayerContact(otherBody, impact, impactNormal, severityVelocity);
    if (trafficVelocity) trafficEvents.noteContact(otherBody, impact.severity);
    // Touching the static world ends a flight; a prop or debris does not.
    if (surfaceRegistry.has(otherBody))
      vehicle.noteChassisContact(impactNormal);
    const profile =
      surfaceResolver.resolveContactSurface(otherBody)?.audioProfile ?? null;
    const crashKind: 0 | 1 | null = trafficVelocity
      ? 0
      : profile === 'concrete' ||
          (!surfaceRegistry.has(otherBody) && impact.approachSpeed >= 4)
        ? 1
        : null;
    if (crashKind !== null) {
      const normalSpeed =
        severityVelocity.x * impactNormal.x +
        severityVelocity.y * impactNormal.y +
        severityVelocity.z * impactNormal.z;
      const speedSquared =
        severityVelocity.x ** 2 +
        severityVelocity.y ** 2 +
        severityVelocity.z ** 2;
      const tangent = Math.sqrt(
        Math.max(0, speedSquared - normalSpeed * normalSpeed),
      );
      const struck = traffic?.stateForBody(otherBody);
      const struckModel = struck && CAR_MODELS[struck.modelKind];
      const glassEligible =
        !!struck &&
        !!struckModel &&
        Math.abs(impactNormal.y) < 0.55 &&
        point.y - (struck.position.y - struckModel.ride) >=
          struckModel.halfExtents.y * 1.1;
      audio.onCrashContact(
        vehicle.body,
        otherBody,
        impact.approachSpeed,
        tangent,
        point,
        crashKind,
        glassEligible,
      );
      if (struck)
        wreckEffects?.noteContact(
          vehicle.body,
          otherBody,
          point,
          struck.position.y - CAR_MODELS[struck.modelKind].ride,
          impactNormal,
          struck.velocity,
          impact.approachSpeed,
          tangent,
          glassEligible,
          vehicle.telemetry.position,
        );
      else if (crashKind === 1 && Math.abs(impactNormal.y) < 0.55) {
        let groundY = point.y - 0.5;
        for (const wheel of vehicle.telemetry.wheels)
          if (wheel.grounded) {
            groundY = wheel.hit.point.y;
            break;
          }
        wreckEffects?.noteContact(
          vehicle.body,
          otherBody,
          point,
          groundY,
          impactNormal,
          vehicle.telemetry.velocity,
          impact.approachSpeed,
          tangent,
          false,
          vehicle.telemetry.position,
        );
      }
    }
    // This callback runs inside physics.step: consumers only queue fixed
    // scalars here. Audio output runs after simulation in update().
    impactFeedback.onContact(
      otherBody,
      crashKind === null ? profile : null,
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
    // Again: the whole run from the start line, nothing kept. One key, no menu.
    if (actions.retry > 0) retryRequested = true;
    if (actions.options % 2) options.toggle();
    hud.cycleMode(actions.hud);
    if (actions.recordTelemetry % 2) hud.toggleRecording();
    if (actions.swapAB % 2) options.session.swapSlots();
    if (actions.gizmos % 2) carVisual.toggleDebug();
    if (actions.camera > 0) cameraRig.cyclePreset(actions.camera);
    // Test cheat: B fills the boost bar so boost behaviour can be judged
    // without earning it. Shipped in every build, like T and F9: the CTO
    // evaluates production preview builds, which carry no test API.
    if (actions.fillBoost > 0)
      vehicle.setDriftMeter(vehicle.telemetry.boostSections);
    if (actions.slowMotion % 2 && !playerDamage?.wrecked)
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
  game.setInspectionCamera = (pose) => {
    if (pose) {
      for (const value of [
        ...Object.values(pose.position),
        ...Object.values(pose.target),
      ])
        if (!Number.isFinite(value))
          throw new RangeError('Inspection camera pose must be finite.');
      inspectionCamera = {
        position: { ...pose.position },
        target: { ...pose.target },
      };
    } else inspectionCamera = null;
  };
  game.getHeroLod = () => carVisual.lodInfo();
  game.getGarageClass = () => ({
    id: garageClassId,
    width: garageClass.geometry.width,
    height: garageClass.geometry.height,
    length: garageClass.geometry.length,
    mass: vehicle.currentMass,
  });
  game.setHudMode = (mode) => hud.setMode(mode);
  game.setOptionsOpen = (open) => options.setOpen(open);
  game.stepMany = (count) => {
    massRebuild.flush();
    loop.stepMany(count);
  };
  // Test-only browser fixture: use the same pooled cars and physics path as
  // play, but give main and PR an identical multi-car impact on the road.
  game.stageTrafficPileup = (count = 3) => {
    const actors = (traffic?.states ?? [])
      .filter((car) => car.bodyId > 0)
      .slice(0, count);
    if (actors.length !== count)
      throw new Error(`${count} nearby traffic bodies required.`);
    for (let index = 0; index < actors.length; index++) {
      const car = actors[index]!;
      physics.setTransform(
        car.bodyId,
        { x: -846.5, y: car.position.y, z: -1445 + index * 15 },
        { x: 0, y: 1, z: 0, w: 0 },
        true,
      );
      physics.setLinearVelocity(car.bodyId, {
        x: 0,
        y: 0,
        z: index === 0 ? 50 : 0,
      });
      physics.setAngularVelocity(car.bodyId, { x: 0, y: 0, z: 0 });
    }
    return actors.map((car) => car.id);
  };
  const trafficScreenPoint = new Vector3();
  game.getTraffic = () =>
    (traffic?.states ?? []).map((car) => {
      // Test-only projection from the rendered camera, so browser density
      // measurements do not mistake behind-camera cars for visible traffic.
      const rightX = -car.forward.z;
      const rightZ = car.forward.x;
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      let inDepth = false;
      for (const side of [-1, 1])
        for (const end of [-1, 1]) {
          trafficScreenPoint
            .set(
              car.position.x + rightX * side * 0.95 + car.forward.x * end * 2.1,
              car.position.y + 0.45,
              car.position.z + rightZ * side * 0.95 + car.forward.z * end * 2.1,
            )
            .project(view.camera);
          minX = Math.min(minX, trafficScreenPoint.x);
          maxX = Math.max(maxX, trafficScreenPoint.x);
          minY = Math.min(minY, trafficScreenPoint.y);
          maxY = Math.max(maxY, trafficScreenPoint.y);
          inDepth ||= trafficScreenPoint.z >= -1 && trafficScreenPoint.z <= 1;
        }
      const inFrame =
        inDepth && maxX >= -1 && minX <= 1 && maxY >= -1 && minY <= 1;
      const screenPixels = inFrame
        ? (Math.min(1, maxX) - Math.max(-1, minX)) * view.size.width * 0.5
        : 0;
      return {
        id: car.id,
        bodyId: car.bodyId,
        x: car.position.x,
        y: car.position.y,
        z: car.position.z,
        fx: car.forward.x,
        fz: car.forward.z,
        vx: car.velocity.x,
        vz: car.velocity.z,
        speed: car.speed,
        wrecked: car.wrecked,
        wreckSide: car.wreckSide ?? null,
        tornSide: car.tornSide ?? null,
        rival: car.rival,
        modelKind: (car as { modelKind?: string }).modelKind ?? null,
        crush: { ...car.crush },
        inFrame,
        screenPixels,
      };
    });
  game.getWreckEffects = () => ({
    activePanels: wreckEffects?.activeCount ?? 0,
    ...(wreckEffects?.particleState ?? {
      sparks: 0,
      metal: 0,
      glass: 0,
      bursts: 0,
      grinds: 0,
      dropped: 0,
    }),
  });
  game.getRivalControl = () => traffic?.debugRivals() ?? null;
  if (race && traffic)
    game.getRace = () => ({
      state: race.state,
      order: [...race.order],
      cars: traffic.debugRivals().cars.filter((car) => car.raceEntrant),
    });
  game.getTakedowns = () => ({
    count: takedowns?.count ?? 0,
    lastCreditKind: takedowns?.lastCreditKind ?? null,
    boostSections: vehicle.telemetry.boostSections,
  });
  if (roadRage) game.getRoadRage = () => ({ ...roadRage.state });
  if (playerDamage)
    game.getPlayerDamage = () => ({
      amount: playerDamage.damage,
      wrecked: playerDamage.wrecked,
      secondsLeft: playerDamage.wreckSecondsLeft,
      crush: { ...playerDamage.crush },
    });
  if (takedowns && traffic)
    game.stageRivalTakedown = () => {
      const rival = traffic.states.find((car) => car.rival && !car.wrecked);
      if (!rival) throw new Error('No unwrecked rival remains in view.');
      vehicle.respawn(
        {
          x: rival.position.x - rival.forward.x * 12,
          y: track.spawn.position.y,
          z: rival.position.z - rival.forward.z * 12,
        },
        rival.rotation,
      );
      physics.setLinearVelocity(vehicle.body, {
        x: rival.forward.x * (rival.speed + 30),
        y: 0,
        z: rival.forward.z * (rival.speed + 30),
      });
      history.reset();
      visualHistory.reset();
      cameraRig.reset();
      return rival.id;
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
  game.getRoadPath = () => {
    if (!map.path) return null;
    const first = map.path.samples[0];
    const second = map.path.samples[1];
    return {
      points: map.path.samples.map((sample) => [sample.x, sample.z] as const),
      step: first && second ? second.s - first.s : 4,
      closed: map.path.closed,
    };
  };
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
      perfPaceStart = {
        wallMs: performance.now(),
        totalSteps: loop.totalSteps,
        droppedSeconds: loop.droppedSeconds,
        physicsHz: tuning.get('physicsHz'),
        timeScale: tuning.get('timeScale'),
      };
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
    pace: () =>
      perfPaceStart
        ? measurePace(perfPaceStart, {
            wallMs: performance.now(),
            totalSteps: loop.totalSteps,
            droppedSeconds: loop.droppedSeconds,
            physicsHz: tuning.get('physicsHz'),
            timeScale: tuning.get('timeScale'),
          })
        : null,
    getMemory() {
      const memory = { heapBytes: 0, freeBytes: 0 };
      physics.getMemoryStats(memory);
      return memory;
    },
  };
  let previousWallFrameMs: number | undefined;
  visibilityChanged = () => {
    previousWallFrameMs = undefined;
    syncPause();
    view.resolution.resetClock();
    // Hidden tabs may stop RAF before it can schedule the audio-clock fade.
    audio.update(performance.now());
  };
  document.addEventListener('visibilitychange', visibilityChanged);
  visibilityChanged();
  function frame(nowMs: number): void {
    frameTime = nowMs;
    const wallDt =
      previousWallFrameMs === undefined
        ? 0
        : Math.max(0, (nowMs - previousWallFrameMs) / 1000);
    previousWallFrameMs = nowMs;
    try {
      // No physics/input-script sample while paused. Both readers consume the
      // mapper's same edge counters, so unpausing cannot replay an action.
      // Active replays still need this command path to close their pause menu.
      if (isPaused() || tuning.get('timeScale') === 0) {
        dispatchActions(input.sampleActions());
        if (retryRequested) retry();
        else if (respawnRequested) respawn();
      }
      loop.frame(nowMs);
      if (!isPaused() && tuning.get('timeScale') !== 0)
        impactTime?.advanceWall(wallDt, input.slowMotionHeld);
      pauseMenu.update(nowMs);
      controllerSupport.update(nowMs);
      hud.setInputDevice(controllerSupport.device);
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
