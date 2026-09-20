import { TuningStore } from '../tuning/store';

export interface TireWheelReading {
  grounded: boolean;
  slipAngle: number; // radians, matching simulation units
  gripUsage: number;
  normalLoad: number;
}
export interface TirePlotTelemetry { wheels: readonly TireWheelReading[]; } // FL, FR, RL, RR
export interface OperatingPoint { visible: boolean; slipDegrees: number; usage: number; }
export interface OperatingPoints { front: OperatingPoint; rear: OperatingPoint; }

export function tireCurve(slipDegrees: number, peakDegrees: number, slideRatio: number, falloff: number): number {
  const x = Math.abs(slipDegrees) / peakDegrees;
  return x <= 1 ? 2 * x - x * x : slideRatio + (1 - slideRatio) * Math.exp(-falloff * (x - 1));
}

/** Reuses out; unsupported/airborne wheel readings do not fabricate zero-usage dots. */
export function readOperatingPoints(telemetry: TirePlotTelemetry | undefined, out: OperatingPoints): void {
  let frontCount = 0;
  let rearCount = 0;
  out.front.slipDegrees = 0;
  out.front.usage = 0;
  out.rear.slipDegrees = 0;
  out.rear.usage = 0;
  for (let index = 0; index < 4; index++) {
    const wheel = telemetry?.wheels[index];
    if (!wheel?.grounded || !Number.isFinite(wheel.normalLoad) || wheel.normalLoad <= 0
      || !Number.isFinite(wheel.slipAngle) || !Number.isFinite(wheel.gripUsage) || wheel.gripUsage < 0) continue;
    const point = index < 2 ? out.front : out.rear;
    point.slipDegrees += Math.abs(wheel.slipAngle) * 180 / Math.PI;
    point.usage += wheel.gripUsage;
    if (index < 2) frontCount++; else rearCount++;
  }
  out.front.visible = frontCount > 0;
  out.rear.visible = rearCount > 0;
  if (frontCount) { out.front.slipDegrees /= frontCount; out.front.usage /= frontCount; }
  if (rearCount) { out.rear.slipDegrees /= rearCount; out.rear.usage /= rearCount; }
}

export class TireCurvePlot {
  readonly element: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly points: OperatingPoints = {
    front: { visible: false, slipDegrees: 0, usage: 0 },
    rear: { visible: false, slipDegrees: 0, usage: 0 },
  };
  private readonly context: CanvasRenderingContext2D | null;
  private readonly caption: Text;
  private readonly unsubscribe: () => void;
  private readonly observer: ResizeObserver | undefined;
  private readonly solid: number[] = [];
  private readonly dashed = [6, 4];
  private lastReadMs = -Infinity;
  private width = 332;
  private readonly height = 144;
  private readonly pixelRatio: number;
  private readonly colors: { background: string; grid: string; text: string; front: string; rear: string; peak: string; };

  constructor(
    host: HTMLElement,
    private readonly store: TuningStore,
    private readonly readTelemetry: () => TirePlotTelemetry | undefined = () => undefined,
  ) {
    const doc = host.ownerDocument;
    this.element = doc.createElement('figure');
    this.element.className = 'sl-graph sl-graph--tire';
    this.canvas = doc.createElement('canvas');
    this.canvas.className = 'sl-graph__canvas';
    this.canvas.setAttribute('aria-label', 'Tire response: slip angle in degrees versus normalized grip usage');
    this.canvas.setAttribute('role', 'img');
    this.canvas.textContent = 'Front solid and rear dashed tire curves; peak grip is 1.0.';
    const legend = doc.createElement('figcaption');
    legend.className = 'sl-graph__legend';
    const front = doc.createElement('span');
    front.className = 'sl-legend-key';
    front.textContent = 'Front solid';
    const rear = doc.createElement('span');
    rear.className = 'sl-legend-key sl-legend-key--rear';
    rear.textContent = 'Rear dashed';
    const detail = doc.createElement('span');
    this.caption = doc.createTextNode('No grounded wheel readings');
    detail.append(this.caption);
    legend.append(front, rear, detail);
    this.element.append(this.canvas, legend);
    host.append(this.element);
    this.context = this.canvas.getContext('2d');
    this.pixelRatio = Math.max(1, doc.defaultView?.devicePixelRatio ?? 1);
    const style = doc.defaultView?.getComputedStyle(this.canvas);
    const token = (name: string) => style?.getPropertyValue(name).trim() ?? '';
    this.colors = {
      background: token('--sl-panel'), grid: token('--sl-border'), text: token('--sl-muted'),
      front: token('--sl-accent'), rear: token('--sl-drift'), peak: token('--sl-warning'),
    };
    this.resize(this.width);
    this.unsubscribe = store.onChange((change) => {
      if (change.key === 'peakSlipAngle' || change.key === 'slideGripRatio' || change.key === 'slipFalloffRate') this.draw();
    });
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver((entries) => {
        const width = entries[0]?.contentRect.width;
        if (width && width > 0) this.resize(width);
      });
      this.observer.observe(this.canvas);
    }
  }

  /** Rate gate precedes the telemetry getter; hidden panels do not sample. */
  update(nowMs: number, visible = true): boolean {
    if (!visible || nowMs - this.lastReadMs < 1000 / 30) return false;
    this.lastReadMs = nowMs;
    readOperatingPoints(this.readTelemetry(), this.points);
    this.caption.nodeValue = this.points.front.visible || this.points.rear.visible
      ? `F ${this.describe(this.points.front)} · R ${this.describe(this.points.rear)}`
      : 'No grounded wheel readings';
    this.draw();
    return true;
  }

  dispose(): void { this.unsubscribe(); this.observer?.disconnect(); }

  private describe(point: OperatingPoint): string {
    return point.visible ? `${point.slipDegrees.toFixed(1)}° / ${point.usage.toFixed(2)}` : 'AIR';
  }

  private resize(width: number): void {
    this.width = width;
    this.canvas.width = Math.round(width * this.pixelRatio);
    this.canvas.height = Math.round(this.height * this.pixelRatio);
    this.draw();
  }

  private draw(): void {
    const ctx = this.context;
    if (!ctx) return;
    const left = 30, top = 12, right = this.width - 12, bottom = this.height - 28;
    const plotWidth = right - left, plotHeight = bottom - top;
    const peak = this.store.get('peakSlipAngle');
    const slide = this.store.get('slideGripRatio');
    const falloff = this.store.get('slipFalloffRate');
    ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    ctx.fillStyle = this.colors.background;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.lineWidth = 1;
    ctx.setLineDash(this.solid);
    ctx.strokeStyle = this.colors.grid;
    ctx.beginPath(); ctx.moveTo(left, top); ctx.lineTo(left, bottom); ctx.lineTo(right, bottom); ctx.stroke();
    ctx.fillStyle = this.colors.text;
    ctx.font = '11px system-ui';
    ctx.fillText('1.0', 3, bottom - plotHeight / 1.5 + 4);
    ctx.fillText('0', 16, bottom + 4);
    ctx.fillText('0', left, bottom + 16);
    ctx.fillText('90°', right - 20, bottom + 16);
    ctx.fillText('Slip angle °', left + 55, this.height - 3);
    ctx.strokeStyle = this.colors.peak;
    const peakX = left + peak / 90 * plotWidth;
    ctx.beginPath(); ctx.moveTo(peakX, top); ctx.lineTo(peakX, bottom); ctx.stroke();
    ctx.fillText(`Peak ${peak}°`, Math.min(peakX + 3, right - 70), top + 9);
    for (let axle = 0; axle < 2; axle++) {
      ctx.strokeStyle = axle === 0 ? this.colors.front : this.colors.rear;
      ctx.setLineDash(axle === 0 ? this.solid : this.dashed);
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let index = 0; index <= 180; index++) {
        const slip = index / 2;
        const x = left + slip / 90 * plotWidth;
        const y = bottom - tireCurve(slip, peak, slide, falloff) / 1.5 * plotHeight;
        if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      const point = axle === 0 ? this.points.front : this.points.rear;
      if (point.visible) {
        const x = left + Math.min(90, point.slipDegrees) / 90 * plotWidth;
        const y = bottom - Math.min(1.5, point.usage) / 1.5 * plotHeight;
        ctx.fillStyle = axle === 0 ? this.colors.front : this.colors.rear;
        ctx.beginPath(); ctx.arc(x, y, axle === 0 ? 5 : 3, 0, Math.PI * 2); ctx.fill();
        ctx.fillText(axle === 0 ? 'F' : 'R', x + 6, y - 4);
      }
    }
    ctx.setLineDash(this.solid);
  }
}
