import type { TuningStore } from '../tuning/store';
import {
  CRASH_CHAIN_WINDOW_SECONDS,
  CRASH_MAX_MULTIPLIER,
  type CrashScoreState,
} from '../core/crashScore';
import { steeringLock } from '../vehicle/controls';
import {
  HudHistory,
  HUD_INTERVAL_MS,
  RAD_TO_DEG,
  type HudTelemetry,
  type HudRenderTelemetry,
} from './hudTelemetry';
import { HudPlots } from './hudPlots';
import type { TimedRunState } from '../core/timedRun';
import type { RoadRageState } from '../core/roadRage';
import type { RoadRageBestResult } from '../core/roadRageBest';
import { HudChainState, isChainAlive } from './hudChain';
import type { TrafficEventsState } from '../core/trafficEvents';
import { HudHintState, isHudInputActive, type HudHintInput } from './hudHint';
import { MiniMap, type MiniMapOptions } from './miniMap';
import { node } from './paramControl';
import {
  TelemetryRecorder,
  type RecorderOptions,
  type RecordingExport,
} from './telemetryRecorder';
import type { TuningSession } from './tuningSession';
import './ui.css';

export type HudMode = 'full' | 'minimal' | 'off';
/** The CTO reads speed in mph. */
export const MPH_PER_MPS = 2.2369362920544;

/** The bottom reminder: the keys a first-time player needs, in a glance. It
 * replaced the driving-screen strip (Escape, O, H, controller status). */
export const HUD_HINT_TEXT = Object.freeze({
  keyboard: 'Esc menu · O options · H HUD',
  gamepad: 'Start menu · View options · hold LB for commands',
});
const TRAFFIC_EVENT_LABELS: Record<
  NonNullable<TrafficEventsState['lastEvent']>,
  string
> = {
  'near-miss': 'NEAR MISS',
  oncoming: 'ONCOMING',
  slam: 'SLAM',
};

export interface HudOptions extends RecorderOptions {
  /** Prefer options.root, so the shared Options-open layout applies. */
  host: HTMLElement;
  store: TuningStore;
  session: Pick<
    TuningSession,
    'presetName' | 'activeSlot' | 'modified' | 'onUpdate'
  >;
  readTelemetry: () => HudTelemetry | undefined;
  readScore?: () => Readonly<CrashScoreState>;
  /** The timed run (NS3): countdown, clock and finish on the persistent seam. */
  readRun?: () => Readonly<TimedRunState>;
  /** Road Rage's fixed-step event, persistent even when the HUD is off. */
  readRoadRage?: () => Readonly<RoadRageState>;
  readRoadRageBest?: () => Readonly<RoadRageBestResult> | null;
  /** Traffic events: the one short label beside the boost bar. */
  readTrafficEvents?: () => Readonly<TrafficEventsState>;
  /** Takedown mode's persistent counter, visible even with the HUD off. */
  readTakedowns?: () => number;
  /** Takedown-map player damage and the short wreck/recovery beat. */
  readPlayerDamage?: () => {
    amount: number;
    wrecked: boolean;
    secondsLeft: number;
    impactTime?: boolean;
  };
  miniMap?: Omit<MiniMapOptions, 'host'>;
  readRenderTelemetry?: () => HudRenderTelemetry | undefined;
  /** Optional export sink for tests/integration. Default downloads a CSV. */
  onExport?: (recording: RecordingExport) => void;
}
interface Meter {
  element: HTMLElement;
  value: Text;
  load: Text;
  flags: Text;
  segmentMarks?: HTMLElement[];
}

/** m:ss.hh, the way a stopwatch reads; under a minute just ss.hh. */
export function formatRunClock(seconds: number): string {
  const total = Math.max(0, seconds);
  const minutes = Math.floor(total / 60);
  const rest = total - minutes * 60;
  const body = rest.toFixed(2).padStart(minutes > 0 ? 5 : 4, '0');
  return minutes > 0 ? `${minutes}:${body}` : body;
}

function write(text: Text, value: string): void {
  if (text.data !== value) text.data = value;
}
function fixed(value: number, digits = 1): string {
  return Number.isFinite(value) ? value.toFixed(digits) : '—';
}

export function mountHud(options: HudOptions): Hud {
  return new Hud(options);
}

/** No RAF or keyboard listener. update() gates before either telemetry getter. */
export class Hud {
  readonly root: HTMLElement;
  readonly element: HTMLElement;
  readonly recorder: TelemetryRecorder;
  readonly history = new HudHistory();
  private readonly readings = new Map<string, Text>();
  private readonly wheels: Meter[] = [];
  private readonly throttle: Meter;
  private readonly brake: Meter;
  private readonly handbrake: Meter;
  private readonly boost: Meter;
  private readonly drift: Meter;
  private readonly gauge: HTMLElement;
  private readonly steering: HTMLElement;
  private readonly camera: HTMLElement;
  private readonly charging: HTMLElement;
  private readonly tachometer: HTMLElement;
  private readonly tachTrack: HTMLElement;
  private readonly notice: HTMLElement;
  private readonly scoreTotal: Text;
  private readonly scoreAward: HTMLElement;
  private readonly scoreChain: HTMLElement;
  private readonly scoreChainText: Text;
  private readonly scoreChainTrack: HTMLElement;
  private readonly chain: HTMLElement;
  private readonly chainMult: Text;
  private readonly chainTrack: HTMLElement;
  private readonly chainAward: HTMLElement;
  private readonly chainTotal: Text;
  private readonly chainState = new HudChainState();
  private readonly run: HTMLElement;
  private readonly runClock: Text;
  private readonly runLabel: Text;
  private readonly plots: HudPlots;
  private readonly miniMap?: MiniMap;
  private readonly unsubscribe: () => void;
  private readonly modeButton: HTMLButtonElement;
  private readonly collapseButton: HTMLButtonElement;
  /** The game boots with the HUD off: a clean screen, the map persistent,
   * and the reminder at the bottom. */
  private mode: HudMode = 'off';
  private readonly hint: HTMLElement;
  private readonly drive: HTMLElement;
  private readonly driveBoost: Meter;
  private readonly driveEvent: HTMLElement;
  private readonly takedownCount: HTMLElement | null;
  private readonly roadRageCard: HTMLElement | null;
  private readonly roadRageResult: HTMLElement | null;
  private readonly playerDamageNotice: HTMLElement | null;
  private lastTakedownCount = 0;
  private takedownFlashUntilMs = 0;
  private driveEventShown = '';
  private readonly hintState = new HudHintState();
  private activitySinceUpdate = false;
  private hintDevice: 'keyboard' | 'gamepad' = 'keyboard';
  private lastReadMs = -Infinity;
  private previousFrameMs = NaN;
  private frameMs = NaN;
  private disposed = false;
  private downloadURL: string | null = null;
  private exportMessage = 'CSV pending';
  private lastUpshiftCount = NaN;
  private lastDownshiftCount = NaN;

  constructor(private readonly options: HudOptions) {
    const doc = options.host.ownerDocument;
    this.root = node(doc, 'div', 'sl-ui');
    options.host.append(this.root);
    this.element = node(doc, 'section', 'sl-hud');
    this.element.dataset.mode = 'off';
    this.element.setAttribute('aria-label', 'Driving telemetry');
    this.root.append(this.element);
    this.recorder = new TelemetryRecorder(options.store, options);
    const card = (
      className: string,
      title?: string,
      full = false,
    ): HTMLElement => {
      const element = node(doc, 'section', 'sl-card ' + className);
      if (title) element.append(node(doc, 'h2', 'sl-card__title', title));
      if (full) element.dataset.hudDetail = 'full';
      this.element.append(element);
      return element;
    };
    const reading = (
      host: HTMLElement,
      key: string,
      value = '—',
      className = '',
    ): HTMLElement => {
      const element = node(doc, 'span', className, value);
      element.dataset.reading = key;
      this.readings.set(key, element.firstChild as Text);
      host.append(element);
      return element;
    };
    const status = card('sl-hud__status');
    const stats = node(doc, 'div', 'sl-status');
    status.append(stats);
    reading(stats, 'fps');
    const performance = node(doc, 'span', 'sl-status');
    performance.dataset.hudDetail = 'full';
    stats.append(performance);
    for (const key of ['step', 'steps', 'scale']) reading(performance, key);
    for (const key of ['timeScale', 'preset', 'slot']) reading(stats, key);
    reading(stats, 'telemetry', 'Waiting for telemetry');
    this.camera = reading(stats, 'fov');
    const controls = node(doc, 'div', 'sl-hud__controls');
    controls.dataset.hudPersistent = '';
    this.modeButton = node(doc, 'button', 'sl-button', 'HUD: Off · H');
    this.modeButton.type = 'button';
    this.modeButton.addEventListener('click', this.cycleFromButton);
    this.collapseButton = node(
      doc,
      'button',
      'sl-button sl-hud__collapse',
      'Collapse instruments',
    );
    this.collapseButton.type = 'button';
    this.collapseButton.setAttribute('aria-expanded', 'true');
    this.collapseButton.addEventListener('click', this.toggleCollapsed);
    controls.append(this.modeButton, this.collapseButton);
    this.element.append(controls);
    const score = card('sl-hud__score', 'CRASH SCORE');
    this.scoreTotal = reading(score, 'scoreTotal', '0').firstChild as Text;
    this.scoreAward = reading(score, 'scoreAward', '', 'sl-hud__score-award');
    this.scoreAward.setAttribute('aria-live', 'polite');
    this.scoreChain = reading(score, 'scoreChain', '', 'sl-hud__score-chain');
    this.scoreChainText = this.scoreChain.firstChild as Text;
    this.scoreChainTrack = node(doc, 'span', 'sl-hud__score-chain-track');
    this.scoreChain.append(this.scoreChainTrack);
    this.scoreChain.hidden = true;
    // The reminder: bottom of the screen, persistent through HUD off, shown
    // and hidden by the timing in hudHint.ts.
    this.hint = node(doc, 'p', 'sl-hud__hint', HUD_HINT_TEXT.keyboard);
    this.hint.dataset.hudPersistent = '';
    this.hint.setAttribute('aria-hidden', 'true'); // A reminder, not a status.
    this.hint.dataset.visible = 'true';
    this.element.append(this.hint);
    // The two persistent driving instruments, beside the mini-map and outside
    // the H stack: a speedometer in mph and the boost bar. The game boots
    // with the HUD off and the driver must still see both.
    this.drive = node(doc, 'section', 'sl-card sl-hud__drive');
    this.drive.dataset.hudPersistent = '';
    this.drive.setAttribute('aria-label', 'Speed and boost');
    const mph = node(doc, 'div', 'sl-speed');
    reading(mph, 'driveMph', '0', 'sl-drive__value');
    mph.append(node(doc, 'span', 'sl-caption', 'mph'));
    this.drive.append(mph);
    this.driveBoost = this.meter(this.drive, 'Boost');
    // One short label for a traffic event (near miss, oncoming, slam); it
    // shows for a moment and never stacks: the CTO does not want it busy.
    this.driveEvent = node(doc, 'div', 'sl-hud__event');
    this.driveEvent.setAttribute('role', 'status');
    this.driveEvent.hidden = true;
    this.drive.append(this.driveEvent);
    this.takedownCount = options.readTakedowns
      ? node(doc, 'div', 'sl-hud__takedowns', 'TAKEDOWNS 0')
      : null;
    if (this.takedownCount) this.drive.append(this.takedownCount);
    this.roadRageCard = options.readRoadRage
      ? node(doc, 'section', 'sl-card sl-hud__road-rage', '')
      : null;
    if (this.roadRageCard) {
      this.roadRageCard.dataset.hudPersistent = '';
      this.roadRageCard.setAttribute('aria-live', 'polite');
      this.element.append(this.roadRageCard);
    }
    this.roadRageResult = options.readRoadRage
      ? node(doc, 'section', 'sl-card sl-hud__road-rage-result', '')
      : null;
    if (this.roadRageResult) {
      this.roadRageResult.dataset.hudPersistent = '';
      this.roadRageResult.setAttribute('aria-live', 'assertive');
      this.roadRageResult.hidden = true;
      this.element.append(this.roadRageResult);
    }
    this.playerDamageNotice = options.readPlayerDamage
      ? node(doc, 'div', 'sl-hud__player-damage', '')
      : null;
    if (this.playerDamageNotice) {
      this.playerDamageNotice.hidden = true;
      this.drive.append(this.playerDamageNotice);
    }
    this.element.append(this.drive);
    this.notice = node(doc, 'div', 'sl-card sl-hud__recording');
    this.notice.dataset.hudPersistent = '';
    this.notice.setAttribute('role', 'status');
    this.notice.hidden = true;
    reading(this.notice, 'recording', '');
    this.element.append(this.notice);
    // The transient chain readout: the score only when it is happening.
    // Persistent like the map and the drive card, fixed top-centre, faded
    // by the shared data-visible rule and timed by hudChain.ts. The full
    // HUD's crash score card stays as the tuning lab's detail view.
    this.chain = node(doc, 'section', 'sl-card sl-hud__chain');
    this.chain.dataset.hudPersistent = '';
    this.chain.dataset.visible = 'false';
    this.chain.setAttribute('aria-hidden', 'true'); // The card announces awards.
    this.chainMult = reading(this.chain, 'chainMult', '×1', 'sl-chain__mult')
      .firstChild as Text;
    this.chainTrack = node(
      doc,
      'span',
      'sl-hud__score-chain-track sl-chain__track',
    );
    this.chain.append(this.chainTrack);
    this.chainAward = reading(this.chain, 'chainAward', '', 'sl-chain__award');
    this.chainAward.hidden = true;
    this.chainTotal = reading(this.chain, 'chainTotal', '0', 'sl-chain__total')
      .firstChild as Text;
    this.element.append(this.chain);
    // The timed run's readout: countdown, then the clock, then the finish
    // time; shown only while a run is on, top-left, on the persistent seam.
    this.run = node(doc, 'section', 'sl-card sl-hud__run');
    this.run.dataset.hudPersistent = '';
    this.run.dataset.visible = 'false';
    this.run.dataset.phase = 'idle';
    this.run.setAttribute('aria-live', 'polite');
    this.runClock = reading(this.run, 'runClock', '', 'sl-run__clock')
      .firstChild as Text;
    this.runLabel = reading(this.run, 'runLabel', '', 'sl-run__label')
      .firstChild as Text;
    this.element.append(this.run);
    if (options.miniMap)
      this.miniMap = new MiniMap({ host: this.element, ...options.miniMap });
    this.plots = new HudPlots(this.root);
    const gg = card('sl-hud__gg', 'G-G · last 10 s', true);
    gg.append(this.plots.gg);
    reading(gg, 'reference', '—', 'sl-caption');
    const wheelCard = card('sl-hud__wheels', 'Grip usage / normal load', true);
    const wheelStack = node(doc, 'div', 'sl-meter-stack');
    wheelCard.append(wheelStack);
    for (const name of ['FL', 'FR', 'RL', 'RR'])
      this.wheels.push(this.meter(wheelStack, name, '', true));
    const bottom = node(doc, 'div', 'sl-hud__bottom');
    this.element.append(bottom);
    const inputs = node(doc, 'section', 'sl-card sl-meter-stack');
    inputs.dataset.hudDetail = 'full';
    this.steering = node(doc, 'span', 'sl-steering__wheel', '┴');
    this.steering.setAttribute('aria-hidden', 'true');
    const steer = node(doc, 'div', 'sl-steering');
    steer.append(this.steering);
    reading(steer, 'steer');
    inputs.append(steer);
    this.throttle = this.meter(inputs, 'Throttle');
    this.brake = this.meter(inputs, 'Brake', 'sl-meter--brake');
    this.handbrake = this.meter(inputs, 'Handbrake', 'sl-meter--handbrake');
    const slide = node(doc, 'section', 'sl-card sl-gauge');
    this.gauge = slide;
    reading(slide, 'beta', 'Slide β —');
    const track = node(doc, 'div', 'sl-gauge__track');
    track.setAttribute('aria-hidden', 'true');
    for (const part of [
      'zero',
      'threshold sl-gauge__threshold--low',
      'threshold sl-gauge__threshold--high',
      'marker',
    ])
      track.append(node(doc, 'span', 'sl-gauge__' + part));
    const axis = node(doc, 'div', 'sl-gauge__axis');
    axis.append(
      node(doc, 'span', '', '−90°'),
      node(doc, 'span', '', '0°'),
      node(doc, 'span', '', '+90°'),
    );
    slide.append(track, axis);
    reading(slide, 'driftThreshold', '—', 'sl-caption');
    const speed = node(doc, 'section', 'sl-card sl-meter-stack');
    this.tachometer = node(doc, 'div', 'sl-tachometer');
    this.tachometer.setAttribute('role', 'meter');
    this.tachometer.setAttribute('aria-label', 'Engine tachometer');
    const tachHeader = node(doc, 'div', 'sl-tachometer__header');
    const tachGear = node(doc, 'span', 'sl-tachometer__gear', '—');
    tachHeader.append(
      node(doc, 'span', 'sl-tachometer__label', 'TACH'),
      tachGear,
    );
    tachGear.dataset.reading = 'tachGear';
    this.readings.set('tachGear', tachGear.firstChild as Text);
    const tachRpm = node(doc, 'span', 'sl-tachometer__rpm');
    tachRpm.dataset.reading = 'tachRpm';
    tachRpm.append(doc.createTextNode('— rpm'));
    this.readings.set('tachRpm', tachRpm.firstChild as Text);
    this.tachTrack = node(doc, 'div', 'sl-tachometer__track');
    this.tachTrack.setAttribute('aria-hidden', 'true');
    this.tachTrack.append(
      node(doc, 'span', 'sl-tachometer__redline'),
      node(doc, 'span', 'sl-tachometer__needle'),
    );
    const tachMarks = node(doc, 'div', 'sl-tachometer__marks');
    for (const position of [0, 25, 50, 75, 100]) {
      const mark = node(doc, 'span', 'sl-tachometer__mark');
      mark.style.left = position + '%';
      tachMarks.append(mark);
    }
    this.tachometer.append(tachHeader, tachRpm, this.tachTrack);
    this.tachometer.append(tachMarks);
    speed.append(this.tachometer);
    const number = node(doc, 'div', 'sl-speed');
    reading(number, 'speed', '—', 'sl-speed__value');
    number.append(node(doc, 'span', 'sl-speed__unit', 'km/h'));
    speed.append(number);
    reading(speed, 'speedMs', '— m/s', 'sl-speed__secondary');
    this.boost = this.meter(speed, 'Boost');
    this.drift = this.meter(speed, 'Drift', 'sl-meter--drift');
    this.charging = reading(speed, 'charging', 'Not charging', 'sl-caption');
    bottom.append(inputs, slide, speed);
    const graphCard = card('sl-hud__graphs', undefined, true);
    graphCard.append(this.plots.graphs);
    this.unsubscribe = options.session.onUpdate(this.syncSession);
    this.syncSession();
  }

  private meter(
    host: HTMLElement,
    label: string,
    extra = '',
    wheel = false,
  ): Meter {
    const doc = host.ownerDocument;
    const element = node(doc, 'div', 'sl-meter ' + extra);
    element.dataset.meter = label;
    element.setAttribute('role', 'meter');
    element.setAttribute('aria-label', label + (wheel ? ' grip usage' : ''));
    element.setAttribute('aria-valuemin', '0');
    element.setAttribute('aria-valuemax', wheel ? '1.5' : '1');
    const header = node(doc, 'div', 'sl-meter__label');
    const value = doc.createTextNode('—');
    const display = node(doc, 'span', 'sl-meter__value');
    display.append(value);
    header.append(node(doc, 'span', '', label), display);
    const track = node(doc, 'div', 'sl-meter__track');
    track.setAttribute('aria-hidden', 'true');
    track.append(node(doc, 'span', 'sl-meter__fill'));
    const segmentMarks: HTMLElement[] = [];
    if (label === 'Boost')
      for (let index = 0; index < 3; index++) {
        const mark = node(doc, 'span', 'sl-meter__section-mark');
        mark.hidden = true;
        track.append(mark);
        segmentMarks.push(mark);
      }
    if (wheel) track.append(node(doc, 'span', 'sl-meter__threshold'));
    const meta = node(doc, 'div', 'sl-wheel__meta');
    const load = doc.createTextNode('— kN'),
      flags = doc.createTextNode('');
    const loadBox = node(doc, 'span'),
      flagBox = node(doc, 'span');
    loadBox.append(load);
    flagBox.append(flags);
    meta.append(loadBox, flagBox);
    element.append(header, track);
    if (wheel) element.append(meta);
    host.append(element);
    return { element, value, load, flags, segmentMarks };
  }

  setMode(mode: HudMode): void {
    if (this.disposed) return;
    if (mode !== 'full' && mode !== 'minimal' && mode !== 'off')
      throw new RangeError('Unknown HUD mode.');
    if (mode === this.mode) return;
    this.mode = mode;
    this.element.dataset.mode = mode;
    write(
      this.modeButton.firstChild as Text,
      'HUD: ' + mode[0]!.toUpperCase() + mode.slice(1) + ' · H',
    );
  }

  /** Called every physics step with what the driver is doing; any input
   * counts as activity except a resting stick or pedal under the threshold. */
  noteInput(input: Readonly<HudHintInput>, actionCount = 0): void {
    if (isHudInputActive(input, actionCount)) this.activitySinceUpdate = true;
  }

  /** Words the reminder for the device the driver last used. */
  setInputDevice(device: 'keyboard' | 'gamepad'): void {
    if (this.disposed || device === this.hintDevice) return;
    this.hintDevice = device;
    write(this.hint.firstChild as Text, HUD_HINT_TEXT[device]);
  }

  get hintVisible(): boolean {
    return this.hint.dataset.visible === 'true';
  }

  cycleMode(count = 1): void {
    if (!Number.isFinite(count) || Math.trunc(count) % 3 === 0) return;
    const index = this.mode === 'full' ? 0 : this.mode === 'minimal' ? 1 : 2;
    const next = (((index + Math.trunc(count)) % 3) + 3) % 3;
    this.setMode(next === 0 ? 'full' : next === 1 ? 'minimal' : 'off');
  }

  toggleRecording(): void {
    if (this.disposed) return;
    if (this.recorder.recording) this.recorder.stop();
    else {
      this.exportStopped();
      try {
        this.recorder.start();
        this.exportMessage = 'CSV pending';
      } catch {
        this.set(
          'recording',
          'Recording could not start: insufficient buffer memory.',
        );
        this.notice.hidden = false;
        return;
      }
    }
    this.updateNotice();
  }

  /** Call once after each completed physics step and its timing measurement. */
  recordStep(
    telemetry: HudTelemetry,
    dtSeconds: number,
    render?: HudRenderTelemetry,
  ): void {
    if (!this.disposed) this.recorder.sample(telemetry, dtSeconds, render);
  }

  update(nowMs: number): void {
    if (this.disposed || !Number.isFinite(nowMs)) return;
    const delta = nowMs - this.previousFrameMs;
    if (delta > 0 && delta < 1000)
      this.frameMs = Number.isFinite(this.frameMs)
        ? this.frameMs + (delta - this.frameMs) * 0.1
        : delta;
    this.previousFrameMs = nowMs;
    if (this.activitySinceUpdate) {
      this.activitySinceUpdate = false;
      this.hintState.noteActivity(nowMs);
    }
    const hintVisible = this.hintState.update(nowMs, this.mode === 'off');
    if (hintVisible !== this.hintVisible)
      this.hint.dataset.visible = hintVisible ? 'true' : 'false';
    if (nowMs - this.lastReadMs < HUD_INTERVAL_MS) return;
    this.lastReadMs = nowMs;
    this.exportStopped();
    this.updateNotice();
    this.updateScore(nowMs, this.options.readScore?.());
    this.updateRun(this.options.readRun?.());
    this.updateRoadRage();
    const collapsed = this.element.dataset.collapsed === 'true';
    // The mini-map is HUD-persistent, so keep its position live while the
    // instrument cards are collapsed or the HUD mode is off. HUDs without a
    // map retain the cheap early return and do not read telemetry.
    const telemetry = this.options.readTelemetry();
    this.miniMap?.update(telemetry);
    // Persistent instruments read in every mode, including off and collapsed.
    if (telemetry) {
      this.set('driveMph', fixed(telemetry.speed * MPH_PER_MPS, 0));
      this.fillBoost(this.driveBoost, telemetry);
    }
    this.updateTrafficEvent(this.options.readTrafficEvents?.());
    this.updateTakedowns(nowMs);
    this.updatePlayerDamage();
    if (this.mode === 'off' || collapsed) return;
    const render = this.options.readRenderTelemetry?.();
    const store = this.options.store;
    this.set('timeScale', 'Time ×' + fixed(store.get('timeScale'), 2));
    const fpsMs =
      render?.smoothedFrameMs && render.smoothedFrameMs > 0
        ? render.smoothedFrameMs
        : this.frameMs;
    this.set('fps', fixed(1000 / fpsMs, 0) + ' FPS · ' + fixed(fpsMs) + ' ms');
    this.set('scale', 'Render ×' + fixed(render?.renderScale ?? NaN, 2));
    this.set(
      'fov',
      render
        ? 'FOV ' +
            fixed(render.cameraFov) +
            '°' +
            (render.cameraFovCapped
              ? ' CAPPED · requested ' + fixed(render.cameraFovRequested) + '°'
              : '')
        : 'FOV —',
    );
    this.camera.dataset.state = render?.cameraFovCapped ? 'capped' : 'normal';
    if (!telemetry) {
      this.element.dataset.telemetry = 'unavailable';
      this.set('telemetry', 'Telemetry unavailable');
      return;
    }
    this.element.dataset.telemetry = 'available';
    this.set('telemetry', '');
    this.history.push(nowMs / 1000, telemetry);
    this.set('speed', fixed(telemetry.speedKmh, 0));
    this.set(
      'speedMs',
      fixed(telemetry.speed) + ' m/s' + (telemetry.vLong < -0.1 ? ' · R' : ''),
    );
    this.updateTachometer(telemetry);
    this.set('beta', 'Slide β ' + fixed(telemetry.beta * RAD_TO_DEG) + '°');
    const threshold = store.get('driftMinAngle');
    this.set('driftThreshold', 'Drift ticks ±' + fixed(threshold) + '°');
    this.gauge.style.setProperty(
      '--sl-position',
      50 + Math.max(-90, Math.min(90, telemetry.beta * RAD_TO_DEG)) / 1.8 + '%',
    );
    this.gauge.style.setProperty(
      '--sl-threshold-low',
      50 - threshold / 1.8 + '%',
    );
    this.gauge.style.setProperty(
      '--sl-threshold-high',
      50 + threshold / 1.8 + '%',
    );
    this.gauge.dataset.valid = String(Number.isFinite(telemetry.beta));
    this.set('step', fixed(telemetry.physicsStepMs, 2) + ' ms/step');
    this.set('steps', fixed(telemetry.stepsPerFrame, 0) + ' steps/frame');
    this.fillBoost(this.boost, telemetry);
    this.fill(this.drift, telemetry.driftMeter, telemetry.boostSections);
    this.set('charging', telemetry.charging ? 'CHARGING' : 'Not charging');
    this.charging.dataset.charging = String(telemetry.charging);
    if (this.mode !== 'full') return;
    this.fill(this.throttle, telemetry.throttle);
    this.fill(this.brake, telemetry.brake01);
    this.fill(this.handbrake, telemetry.handbrake01);
    const lock = steeringLock(
      telemetry.speed,
      store.get('steerMaxLowSpeed'),
      store.get('steerMaxTopSpeed'),
      store.get('topSpeed'),
      store.get('steerSpeedExp'),
    );
    this.set(
      'steer',
      'Steer ' +
        fixed(telemetry.steerAngle * RAD_TO_DEG) +
        '° · lock ±' +
        fixed(lock) +
        '°',
    );
    this.steering.style.transform =
      'rotate(' +
      (Number.isFinite(telemetry.steerAngle) ? telemetry.steerAngle : 0) +
      'rad)';
    for (let i = 0; i < 4; i++) {
      const wheel = telemetry.wheels[i],
        meter = this.wheels[i]!;
      const loaded = Boolean(
        wheel?.grounded && Number.isFinite(wheel.Fz) && wheel.Fz > 0,
      );
      const usage = loaded ? (wheel?.gripUsage ?? NaN) : NaN;
      this.fill(meter, usage, 1.5);
      meter.element.dataset.state = !loaded
        ? 'air'
        : usage > 1
          ? 'over'
          : 'normal';
      write(meter.value, fixed(usage, 2) + (usage > 1 ? ' !' : ''));
      write(meter.load, fixed((wheel?.Fz ?? NaN) / 1000, 2) + ' kN');
      write(
        meter.flags,
        !loaded
          ? 'AIR'
          : wheel?.locked && wheel.spinning
            ? 'LOCK SPIN'
            : wheel?.locked
              ? 'LOCK'
              : wheel?.spinning
                ? 'SPIN'
                : 'GRIP',
      );
    }
    const mu =
      Math.min(store.get('gripFront'), store.get('gripRear')) *
      store.get('surfaceGrip');
    const reference = mu * store.get('gravity');
    this.set(
      'reference',
      'Nominal μ ' + fixed(mu, 2) + ' × g = ' + fixed(reference) + ' m/s²',
    );
    this.plots.draw(this.history, nowMs / 1000, reference);
  }

  private updateScore(
    nowMs: number,
    score: Readonly<CrashScoreState> | undefined,
  ): void {
    if (!score) return;
    this.updateChain(nowMs, score);
    write(this.scoreTotal, score.total.toLocaleString('en-US'));
    const showAward = score.awardAgeSeconds < 0.9 && score.lastAward > 0;
    this.scoreAward.hidden = !showAward;
    if (showAward)
      write(
        this.scoreAward.firstChild as Text,
        '+' + score.lastAward.toLocaleString('en-US'),
      );
    const active = score.chainCount > 0 && score.chainRemainingSeconds > 0;
    this.scoreChain.hidden = !active;
    if (active) {
      write(
        this.scoreChainText,
        'CHAIN ×' +
          score.multiplier +
          ' · ' +
          score.chainRemainingSeconds.toFixed(1) +
          's',
      );
      this.scoreChainTrack.style.setProperty(
        '--sl-chain-progress',
        (score.chainRemainingSeconds / 2) * 100 + '%',
      );
    }
  }

  /** The transient readout carries the tension: the multiplier large, the
   * two-second window draining under it, the last award while it is fresh,
   * the running total small. */
  private updateRun(run: Readonly<TimedRunState> | undefined): void {
    if (!run) return;
    const visible = run.phase !== 'idle';
    if (this.run.dataset.visible !== String(visible))
      this.run.dataset.visible = String(visible);
    if (this.run.dataset.phase !== run.phase)
      this.run.dataset.phase = run.phase;
    if (!visible) return;
    if (run.phase === 'countdown') {
      write(this.runClock, String(Math.ceil(run.countdown)));
      write(this.runLabel, 'READY');
      return;
    }
    // GO flashes for the first moments of the clock, then the clock reads.
    const go = run.phase === 'running' && run.clock < 0.8;
    write(this.runClock, go ? 'GO' : formatRunClock(run.clock));
    write(
      this.runLabel,
      run.phase === 'finished'
        ? 'FINISH'
        : run.gatesTaken > 1
          ? `GATE ${run.gatesTaken - 1} of ${run.gateCount - 1}`
          : 'RUN',
    );
  }

  private updateChain(nowMs: number, score: Readonly<CrashScoreState>): void {
    const visible = this.chainState.update(nowMs, score);
    if (this.chain.dataset.visible !== String(visible))
      this.chain.dataset.visible = String(visible);
    if (!visible) return;
    write(this.chainMult, '×' + score.multiplier);
    this.chain.dataset.max = String(score.multiplier >= CRASH_MAX_MULTIPLIER);
    this.chainTrack.style.setProperty(
      '--sl-chain-progress',
      (isChainAlive(score)
        ? (score.chainRemainingSeconds / CRASH_CHAIN_WINDOW_SECONDS) * 100
        : 0) + '%',
    );
    const showAward = score.awardAgeSeconds < 0.9 && score.lastAward > 0;
    this.chainAward.hidden = !showAward;
    if (showAward)
      write(
        this.chainAward.firstChild as Text,
        '+' + score.lastAward.toLocaleString('en-US'),
      );
    write(this.chainTotal, score.total.toLocaleString('en-US'));
  }

  private updateTrafficEvent(
    events: Readonly<TrafficEventsState> | undefined,
  ): void {
    const label =
      events && events.labelSeconds > 0 && events.lastEvent
        ? TRAFFIC_EVENT_LABELS[events.lastEvent]
        : '';
    if (label === this.driveEventShown) return;
    this.driveEventShown = label;
    this.driveEvent.textContent = label;
    this.driveEvent.hidden = label === '';
  }
  private fill(meter: Meter, value: number, maximum = 1): void {
    const valid = Number.isFinite(value);
    const bounded = valid ? Math.max(0, Math.min(maximum, value)) : 0;
    meter.element.style.setProperty('--sl-fill', String(bounded / maximum));
    if (valid) meter.element.setAttribute('aria-valuenow', String(bounded));
    else meter.element.removeAttribute('aria-valuenow');
    meter.element.setAttribute(
      'aria-valuetext',
      valid
        ? fixed(value * (maximum === 1 ? 100 : 1), maximum === 1 ? 0 : 2) +
            (maximum === 1 ? '%' : '')
        : 'Unavailable',
    );
    write(
      meter.value,
      valid
        ? maximum === 1
          ? fixed(value * 100, 0) + '%'
          : fixed(value, 1) + ' / ' + maximum
        : '—',
    );
  }

  private fillBoost(meter: Meter, telemetry: HudTelemetry): void {
    const sections = Math.max(1, Math.min(4, telemetry.boostSections));
    this.fill(meter, telemetry.boostMeter, sections);
    for (let index = 0; index < (meter.segmentMarks?.length ?? 0); index++) {
      const mark = meter.segmentMarks![index]!;
      mark.hidden = index + 1 >= sections;
      if (!mark.hidden) mark.style.left = ((index + 1) / sections) * 100 + '%';
    }
  }

  private updateTakedowns(nowMs: number): void {
    if (!this.takedownCount) return;
    const count = this.options.readTakedowns?.() ?? 0;
    if (count !== this.lastTakedownCount) {
      this.lastTakedownCount = count;
      this.takedownFlashUntilMs = nowMs + 1500;
    }
    const flashing = nowMs < this.takedownFlashUntilMs;
    const label = flashing ? 'TAKEDOWN! · ' + count : 'TAKEDOWNS ' + count;
    if (this.takedownCount.textContent !== label)
      this.takedownCount.textContent = label;
    this.takedownCount.dataset.flash = String(flashing);
  }

  private updateRoadRage(): void {
    if (!this.roadRageCard || !this.roadRageResult) return;
    const state = this.options.readRoadRage?.();
    if (!state) return;
    const seconds = Math.ceil(state.remaining);
    const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    const target =
      state.nextTarget === null ? 'GOLD SECURED' : `NEXT ${state.nextTarget}`;
    const takedownWord = state.count === 1 ? 'TAKEDOWN' : 'TAKEDOWNS';
    const wrecksLeft = 3 - state.wrecks;
    const wreckBudget = `${wrecksLeft} WRECK${wrecksLeft === 1 ? '' : 'S'} LEFT`;
    const label =
      state.phase === 'countdown'
        ? `ROAD RAGE · ${Math.ceil(state.countdown)}`
        : state.goCue > 0
          ? 'ROAD RAGE · GO!'
          : `ROAD RAGE · ${clock} · ${state.count} ${takedownWord} · ${target}${state.phase === 'running' ? ` · ${state.wrecks === 2 ? 'CRITICAL · ' : ''}${wreckBudget}` : ''}`;
    if (this.roadRageCard.textContent !== label)
      this.roadRageCard.textContent = label;
    this.roadRageCard.dataset.phase = state.phase;
    this.roadRageCard.dataset.wrecks = String(state.wrecks);
    this.roadRageResult.hidden = state.phase !== 'finished';
    if (state.phase === 'finished') {
      const best = this.options.readRoadRageBest?.();
      const outcome =
        state.finishReason === 'wrecks'
          ? 'FAILED · NO MEDAL'
          : `TIME UP · ${state.medal.toUpperCase()}`;
      const result = `${outcome} · ${state.count} ${takedownWord} · BEST ${best?.count ?? '—'} · ENTER TO RETRY`;
      if (this.roadRageResult.textContent !== result)
        this.roadRageResult.textContent = result;
    }
  }

  private updatePlayerDamage(): void {
    if (!this.playerDamageNotice) return;
    const state = this.options.readPlayerDamage?.();
    if (!state) return;
    this.playerDamageNotice.hidden = !state.wrecked && state.amount <= 0;
    const label = state.impactTime
      ? 'IMPACT TIME · HOLD T OR LB+↓ · STEER'
      : state.wrecked
        ? 'WRECKED · RESPAWNING'
        : 'DAMAGE ' + Math.round(state.amount * 100) + '%';
    if (this.playerDamageNotice.textContent !== label)
      this.playerDamageNotice.textContent = label;
    this.playerDamageNotice.dataset.wrecked = String(state.wrecked);
  }

  private set(key: string, value: string): void {
    write(this.readings.get(key)!, value);
  }

  private updateTachometer(telemetry: HudTelemetry): void {
    if (
      telemetry.idleRpm <= 0 ||
      telemetry.redlineRpm <= 0 ||
      telemetry.gearCount <= 0
    ) {
      this.tachometer.dataset.state = 'unavailable';
      this.tachometer.dataset.shift = 'none';
      this.tachTrack.style.setProperty('--sl-tach-position', '0%');
      this.tachTrack.style.setProperty('--sl-tach-redline', '100%');
      this.tachometer.removeAttribute('aria-valuenow');
      this.tachometer.removeAttribute('aria-valuemin');
      this.tachometer.removeAttribute('aria-valuemax');
      this.set('tachGear', '—');
      this.set('tachRpm', '— rpm');
      return;
    }
    const reverse = telemetry.vLong < -0.1;
    this.set(
      'tachGear',
      reverse ? 'R' : 'G' + Math.max(1, Math.round(telemetry.gear)),
    );
    this.set('tachRpm', fixed(telemetry.rpm, 0) + ' rpm');
    const maxRpm = telemetry.redlineRpm > 0 ? telemetry.redlineRpm * 1.15 : NaN;
    const position = Number.isFinite(maxRpm)
      ? Math.max(0, Math.min(1, telemetry.rpm / maxRpm))
      : 0;
    const redline = Number.isFinite(maxRpm)
      ? Math.max(0, Math.min(1, telemetry.redlineRpm / maxRpm))
      : 1;
    this.tachTrack.style.setProperty(
      '--sl-tach-position',
      position * 100 + '%',
    );
    this.tachTrack.style.setProperty('--sl-tach-redline', redline * 100 + '%');
    this.tachometer.dataset.state =
      telemetry.rpm >= telemetry.redlineRpm ? 'redline' : 'normal';
    this.tachometer.setAttribute('aria-valuemin', fixed(telemetry.idleRpm, 0));
    this.tachometer.setAttribute(
      'aria-valuemax',
      fixed(telemetry.redlineRpm, 0),
    );
    this.tachometer.setAttribute('aria-valuenow', fixed(telemetry.rpm, 0));
    this.tachometer.setAttribute(
      'aria-valuetext',
      fixed(telemetry.rpm, 0) +
        ' rpm, ' +
        (reverse ? 'reverse' : 'gear ' + telemetry.gear),
    );
    const upshift =
      Number.isFinite(this.lastUpshiftCount) &&
      telemetry.upshiftCount > this.lastUpshiftCount;
    const downshift =
      Number.isFinite(this.lastDownshiftCount) &&
      telemetry.downshiftCount > this.lastDownshiftCount;
    this.tachometer.dataset.shift = upshift
      ? 'up'
      : downshift
        ? 'down'
        : 'none';
    this.lastUpshiftCount = telemetry.upshiftCount;
    this.lastDownshiftCount = telemetry.downshiftCount;
  }

  private readonly syncSession = (): void => {
    const session = this.options.session;
    this.set(
      'preset',
      session.presetName + (session.modified ? ' · modified' : ''),
    );
    this.set('slot', session.activeSlot + ' ACTIVE');
  };
  private readonly cycleFromButton = (): void => {
    this.cycleMode();
  };
  private readonly toggleCollapsed = (): void => {
    const collapsed = this.element.dataset.collapsed !== 'true';
    this.element.dataset.collapsed = String(collapsed);
    this.collapseButton.setAttribute('aria-expanded', String(!collapsed));
    write(
      this.collapseButton.firstChild as Text,
      collapsed ? 'Expand instruments' : 'Collapse instruments',
    );
  };

  private updateNotice(): void {
    const recorder = this.recorder;
    if (recorder.recording) {
      this.notice.hidden = false;
      this.element.dataset.recordingNotice = 'true';
      this.notice.dataset.state = 'recording';
      this.notice.setAttribute('aria-live', 'off');
      this.set(
        'recording',
        '● REC · ' + Math.floor(recorder.elapsedSeconds) + ' s · F9 to save',
      );
    } else if (recorder.stopReason) {
      this.notice.hidden = false;
      this.element.dataset.recordingNotice = 'true';
      this.notice.dataset.state =
        recorder.stopReason === 'manual' ? 'saved' : 'stopped';
      this.notice.setAttribute('aria-live', 'polite');
      const reason =
        recorder.stopReason === 'capacity'
          ? 'capacity reached'
          : recorder.stopReason === 'physics-rate-changed'
            ? 'physicsHz changed'
            : recorder.stopReason === 'step-rate-mismatch'
              ? 'physics step duration changed'
              : 'F9';
      this.set(
        'recording',
        'Recording stopped: ' +
          reason +
          ' · ' +
          recorder.sampleCount +
          ' samples / ' +
          fixed(recorder.elapsedSeconds, 2) +
          ' s · ' +
          this.exportMessage,
      );
    }
  }

  private exportStopped(): void {
    const recording = this.recorder.takeExport();
    if (!recording) return;
    if (this.options.onExport) this.options.onExport(recording);
    else {
      if (this.downloadURL) URL.revokeObjectURL(this.downloadURL);
      this.downloadURL = URL.createObjectURL(recording.blob);
      const anchor = node(this.root.ownerDocument, 'a');
      anchor.href = this.downloadURL;
      anchor.download = recording.filename;
      anchor.hidden = true;
      this.root.append(anchor);
      anchor.click();
      anchor.remove();
    }
    this.exportMessage = this.options.onExport
      ? 'CSV exported'
      : 'CSV download requested';
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    this.recorder.dispose();
    this.plots.dispose();
    this.miniMap?.dispose();
    this.modeButton.removeEventListener('click', this.cycleFromButton);
    this.collapseButton.removeEventListener('click', this.toggleCollapsed);
    if (this.downloadURL) URL.revokeObjectURL(this.downloadURL);
    this.root.remove();
  }
}
