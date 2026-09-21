import { PROBE_QUEUE_CAPACITY, type KeyboardState } from './keyboard';

interface ProbeSource {
  readonly probeTimes: Float64Array;
  readonly probeSequence: number;
}

export const LATENCY_SAMPLE_COUNT = 100;
export interface LatencyStats {
  count: number;
  totalSamples: number;
  droppedEvents: number;
  lastMs: number;
  minMs: number;
  meanMs: number;
  p95Ms: number;
  maxMs: number;
  lastFrameTimestamp: number;
  targetMs: number;
  withinTarget: boolean;
}

/** requestAnimationFrame timestamps are the specified presentation proxy, not a
 * hardware display measurement. Submit the timestamp after rendering the step.
 * All buffers and the statistics object are allocated once at construction.
 */
export class LatencyProbe {
  readonly samples = new Float64Array(LATENCY_SAMPLE_COUNT);
  readonly stats: LatencyStats;
  private readonly sorted = new Float64Array(LATENCY_SAMPLE_COUNT);
  private sampledSequence = 0;
  private presentedSequence = 0;
  private writeIndex = 0;
  private polled: ProbeSource | undefined;
  private sampledPolled = 0;
  private presentedPolled = 0;

  /** Poll-to-render proxy for controllers; does not claim device-event latency. */
  attachPolledSource(source: ProbeSource): void {
    this.polled = source;
  }

  constructor(
    private readonly keyboard: KeyboardState,
    displayFrameMs = 1000 / 60,
  ) {
    if (!Number.isFinite(displayFrameMs) || displayFrameMs <= 0)
      throw new RangeError('Invalid display frame duration.');
    this.stats = {
      count: 0,
      totalSamples: 0,
      droppedEvents: 0,
      lastMs: 0,
      minMs: 0,
      meanMs: 0,
      p95Ms: 0,
      maxMs: 0,
      lastFrameTimestamp: -Infinity,
      targetMs: displayFrameMs * 2,
      withinTarget: false,
    };
  }

  get eventTimestamp(): number {
    const sequence = this.keyboard.probeSequence;
    const keyboard =
      sequence === 0
        ? -Infinity
        : (this.keyboard.probeTimes[(sequence - 1) % PROBE_QUEUE_CAPACITY] ??
          -Infinity);
    const polled = this.polled?.probeSequence
      ? (this.polled.probeTimes[
          (this.polled.probeSequence - 1) % PROBE_QUEUE_CAPACITY
        ] ?? -Infinity)
      : -Infinity;
    return Math.max(keyboard, polled);
  }

  sampleForStep(): void {
    this.sampledSequence = this.keyboard.probeSequence;
    this.sampledPolled = this.polled?.probeSequence ?? 0;
  }

  framePresented(timestamp: number): void {
    if (!Number.isFinite(timestamp)) return;
    let changed = false;
    for (let sourceIndex = 0; sourceIndex < 2; sourceIndex++) {
      const source = sourceIndex === 0 ? this.keyboard : this.polled;
      if (!source) continue;
      const sampled =
        sourceIndex === 0 ? this.sampledSequence : this.sampledPolled;
      let presented =
        sourceIndex === 0 ? this.presentedSequence : this.presentedPolled;
      const earliestAvailable = Math.max(
        0,
        source.probeSequence - PROBE_QUEUE_CAPACITY,
      );
      if (presented < earliestAvailable) {
        this.stats.droppedEvents += earliestAvailable - presented;
        presented = earliestAvailable;
      }
      while (presented < sampled) {
        const eventTimestamp =
          source.probeTimes[presented % PROBE_QUEUE_CAPACITY];
        if (eventTimestamp === undefined || eventTimestamp > timestamp) break;
        presented++;
        if (!Number.isFinite(eventTimestamp) || eventTimestamp < 0) continue;
        const delta = timestamp - eventTimestamp;
        this.samples[this.writeIndex] = delta;
        this.writeIndex = (this.writeIndex + 1) % LATENCY_SAMPLE_COUNT;
        this.stats.count = Math.min(LATENCY_SAMPLE_COUNT, this.stats.count + 1);
        this.stats.totalSamples++;
        this.stats.lastMs = delta;
        this.stats.lastFrameTimestamp = timestamp;
        changed = true;
      }
      if (sourceIndex === 0) this.presentedSequence = presented;
      else this.presentedPolled = presented;
    }
    if (changed) this.updateStats();
  }

  private updateStats(): void {
    let sum = 0;
    let min = Infinity;
    let max = 0;
    for (let index = 0; index < LATENCY_SAMPLE_COUNT; index++) {
      const value =
        index < this.stats.count ? (this.samples[index] ?? 0) : Infinity;
      this.sorted[index] = value;
      if (index >= this.stats.count) continue;
      sum += value;
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    this.sorted.sort();
    this.stats.minMs = min;
    this.stats.maxMs = max;
    this.stats.meanMs = sum / this.stats.count;
    this.stats.p95Ms = this.sorted[Math.ceil(this.stats.count * 0.95) - 1] ?? 0;
    this.stats.withinTarget = max < this.stats.targetMs;
  }
}

/** Optional debug overlay. Key handlers write state only; event and sampled-frame
 * indicators are painted on the first available render, including frames without a step.
 */
export class LatencyProbeView {
  readonly element: HTMLDivElement;
  private readonly eventFlash: HTMLSpanElement;
  private readonly frameFlash: HTMLSpanElement;
  private readonly label: HTMLSpanElement;
  private visible = false;
  private eventLit = false;
  private frameLit = false;
  private lastCount = -1;

  constructor(
    private readonly probe: LatencyProbe,
    host: HTMLElement,
  ) {
    const document = host.ownerDocument;
    this.element = document.createElement('div');
    this.element.setAttribute('aria-label', 'Input latency probe');
    this.element.style.cssText =
      'position:fixed;inset:0;z-index:1000;pointer-events:none;display:none;color:white;font:12px monospace;';
    const panel = document.createElement('div');
    panel.style.cssText =
      'position:absolute;left:12px;top:12px;background:#10151ecc;padding:8px;';
    this.eventFlash = document.createElement('span');
    this.frameFlash = document.createElement('span');
    this.label = document.createElement('span');
    this.eventFlash.textContent = ' EVENT ';
    this.frameFlash.textContent = ' FRAME ';
    this.label.textContent = ' Press L: 0/100 samples';
    panel.append(this.eventFlash, this.frameFlash, this.label);
    this.element.append(panel);
    host.append(this.element);
  }

  render(timestamp: number): void {
    const eventTime = this.probe.eventTimestamp;
    if (!this.visible && Number.isFinite(eventTime)) {
      this.visible = true;
      this.element.style.display = 'block';
    }
    const eventLit = timestamp >= eventTime && timestamp - eventTime < 120;
    const frameTime = this.probe.stats.lastFrameTimestamp;
    const frameLit = timestamp >= frameTime && timestamp - frameTime < 120;
    if (eventLit !== this.eventLit) {
      this.eventLit = eventLit;
      this.eventFlash.style.background = eventLit ? '#007a84' : 'transparent';
    }
    if (
      frameLit !== this.frameLit ||
      eventLit !== (this.element.dataset.eventLit === 'true')
    ) {
      this.frameLit = frameLit;
      this.frameFlash.style.background = frameLit ? '#7b2cbf' : 'transparent';
      this.element.dataset.eventLit = String(eventLit);
      this.element.style.boxShadow = frameLit
        ? 'inset 0 0 0 6px #bf6fff'
        : eventLit
          ? 'inset 0 0 0 6px #21dce8'
          : 'none';
    }
    if (this.lastCount !== this.probe.stats.totalSamples) {
      this.lastCount = this.probe.stats.totalSamples;
      const stats = this.probe.stats;
      this.label.textContent = ` ${stats.count}/100 samples | rAF proxy: mean ${stats.meanMs.toFixed(1)}, p95 ${stats.p95Ms.toFixed(1)}, max ${stats.maxMs.toFixed(1)} ms | target <${stats.targetMs.toFixed(1)} ms`;
    }
  }

  dispose(): void {
    this.element.remove();
  }
}
