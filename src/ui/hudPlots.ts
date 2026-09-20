import { HudHistory } from './hudTelemetry';
import { node } from './paramControl';

interface Surface {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D | null;
  width: number;
  height: number;
  ratio: number;
}
const LABELS = [
  'Speed · m/s',
  'Slide β · deg',
  'Yaw · deg/s',
  'Lateral · Earth G',
  'Slip · deg',
];

/** Cached canvases; resize callbacks are the only place dimensions are read. */
export class HudPlots {
  readonly gg: HTMLElement;
  readonly graphs: HTMLElement;
  private readonly surfaces: Surface[] = [];
  private readonly observer: ResizeObserver;
  private readonly solid: number[] = [];
  private readonly dashed = [5, 3];
  private readonly colors: {
    background: string;
    grid: string;
    text: string;
    front: string;
    rear: string;
  };

  constructor(host: HTMLElement) {
    const doc = host.ownerDocument;
    const style = doc.defaultView!.getComputedStyle(host);
    this.colors = {
      background: style.getPropertyValue('--sl-panel').trim(),
      grid: style.getPropertyValue('--sl-border').trim(),
      text: style.getPropertyValue('--sl-muted').trim(),
      front: style.getPropertyValue('--sl-accent').trim(),
      rear: style.getPropertyValue('--sl-drift').trim(),
    };
    this.observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        for (const surface of this.surfaces) {
          if (surface.canvas !== entry.target || entry.contentRect.width < 1)
            continue;
          surface.width = entry.contentRect.width;
          surface.height = entry.contentRect.height;
          surface.ratio = Math.min(2, doc.defaultView?.devicePixelRatio || 1);
          surface.canvas.width = Math.ceil(surface.width * surface.ratio);
          surface.canvas.height = Math.ceil(surface.height * surface.ratio);
        }
      }
    });
    const create = (label: string, square = false): HTMLElement => {
      const figure = node(
        doc,
        'figure',
        'sl-graph' + (square ? ' sl-graph--gg' : ''),
      );
      const canvas = node(doc, 'canvas', 'sl-graph__canvas');
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', label);
      canvas.append(doc.createTextNode(label));
      this.surfaces.push({
        canvas,
        context: canvas.getContext('2d'),
        width: 180,
        height: square ? 180 : 112,
        ratio: 1,
      });
      figure.append(canvas, node(doc, 'figcaption', 'sl-graph__legend', label));
      this.observer.observe(canvas);
      return figure;
    };
    this.gg = create('Lateral → / forward ↑ · m/s²', true);
    this.graphs = node(doc, 'div', 'sl-graph-shelf');
    for (const label of LABELS) this.graphs.append(create(label));
    const legend = this.graphs.lastElementChild!.lastElementChild!;
    legend.append(
      node(doc, 'span', 'sl-legend-key', 'Front'),
      node(doc, 'span', 'sl-legend-key sl-legend-key--rear', 'Rear'),
    );
  }

  draw(history: HudHistory, nowSeconds: number, reference: number): void {
    this.drawGG(history, nowSeconds, reference);
    for (let pane = 0; pane < 5; pane++)
      this.drawGraph(history, nowSeconds, pane);
  }

  private clear(surface: Surface): CanvasRenderingContext2D | null {
    const ctx = surface.context;
    if (!ctx) return null;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, surface.canvas.width, surface.canvas.height);
    ctx.setTransform(surface.ratio, 0, 0, surface.ratio, 0, 0);
    ctx.fillStyle = this.colors.background;
    ctx.fillRect(0, 0, surface.width, surface.height);
    ctx.font = '12px ui-monospace, monospace';
    ctx.lineWidth = 1;
    ctx.setLineDash(this.solid);
    return ctx;
  }

  private drawGraph(history: HudHistory, now: number, pane: number): void {
    const surface = this.surfaces[pane + 1]!;
    const ctx = this.clear(surface);
    if (!ctx) return;
    const left = 36,
      top = 16,
      width = Math.max(1, surface.width - left - 8),
      height = Math.max(1, surface.height - top - 20);
    let magnitude = pane === 0 ? 10 : pane === 3 ? 1 : 15;
    for (let n = 0; n < history.count; n++) {
      const i = history.index(n);
      if (history.times[i]! < now - 10) continue;
      for (let channel = pane; channel <= (pane === 4 ? 5 : pane); channel++) {
        const value = history.values[i * history.stride + channel]!;
        if (Number.isFinite(value))
          magnitude = Math.max(magnitude, Math.abs(value));
      }
    }
    magnitude =
      Math.ceil(magnitude * (pane === 3 ? 2 : 0.1)) / (pane === 3 ? 2 : 0.1);
    const minimum = pane === 0 ? 0 : -magnitude;
    const range = magnitude - minimum;
    const zeroY = top + (height * magnitude) / range;
    ctx.strokeStyle = this.colors.grid;
    ctx.beginPath();
    ctx.moveTo(left, top);
    ctx.lineTo(left, top + height);
    ctx.lineTo(left + width, top + height);
    ctx.moveTo(left, zeroY);
    ctx.lineTo(left + width, zeroY);
    ctx.stroke();
    ctx.fillStyle = this.colors.text;
    ctx.fillText(String(magnitude), 2, top);
    ctx.fillText(String(minimum), 2, top + height);
    ctx.fillText('−10s', left, surface.height - 3);
    ctx.fillText('0', left + width - 9, surface.height - 3);
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.clip();
    for (let channel = pane; channel <= (pane === 4 ? 5 : pane); channel++) {
      ctx.strokeStyle = channel === 5 ? this.colors.rear : this.colors.front;
      ctx.setLineDash(channel === 5 ? this.dashed : this.solid);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      let previousTime = -Infinity;
      for (let n = 0; n < history.count; n++) {
        const i = history.index(n),
          time = history.times[i]!;
        const value = history.values[i * history.stride + channel]!;
        if (time < now - 10 || !Number.isFinite(value)) {
          previousTime = -Infinity;
          continue;
        }
        const x = left + width * (1 - (now - time) / 10);
        const y = top + (height * (magnitude - value)) / range;
        if (time - previousTime > 0.25) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        previousTime = time;
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawGG(history: HudHistory, now: number, reference: number): void {
    const surface = this.surfaces[0]!;
    const ctx = this.clear(surface);
    if (!ctx) return;
    let limit = Math.max(10, reference * 1.15);
    for (let n = 0; n < history.count; n++) {
      const i = history.index(n);
      if (history.times[i]! < now - 10) continue;
      const long = history.values[i * history.stride + 6]!,
        lat = history.values[i * history.stride + 7]!;
      if (Number.isFinite(long) && Number.isFinite(lat))
        limit = Math.max(limit, Math.abs(long), Math.abs(lat));
    }
    limit = Math.ceil(limit / 5) * 5;
    const x = surface.width / 2,
      y = surface.height / 2;
    const scale = (Math.min(surface.width, surface.height) / 2 - 22) / limit;
    ctx.strokeStyle = this.colors.grid;
    ctx.beginPath();
    ctx.moveTo(16, y);
    ctx.lineTo(surface.width - 16, y);
    ctx.moveTo(x, 16);
    ctx.lineTo(x, surface.height - 16);
    ctx.stroke();
    ctx.setLineDash(this.dashed);
    ctx.strokeStyle = this.colors.rear;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0, reference * scale), 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash(this.solid);
    ctx.fillStyle = this.colors.text;
    ctx.fillText('+' + limit, x + 3, 13);
    ctx.fillText('−' + limit, 2, y - 4);
    ctx.fillText('+' + limit, surface.width - 30, y - 4);
    ctx.fillStyle = this.colors.front;
    for (let n = 0; n < history.count; n++) {
      const i = history.index(n),
        age = now - history.times[i]!;
      const long = history.values[i * history.stride + 6]!,
        lat = history.values[i * history.stride + 7]!;
      if (age > 10 || !Number.isFinite(long) || !Number.isFinite(lat)) continue;
      ctx.globalAlpha = Math.max(0.15, 1 - age / 10);
      ctx.beginPath();
      ctx.arc(
        x + lat * scale,
        y - long * scale,
        n === history.count - 1 ? 3 : 1.5,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  dispose(): void {
    this.observer.disconnect();
    for (const surface of this.surfaces) {
      surface.canvas.width = 1;
      surface.canvas.height = 1;
    }
  }
}
