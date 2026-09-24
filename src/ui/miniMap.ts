import type { HudTelemetry } from './hudTelemetry';

export interface MiniMapLandmark {
  readonly x: number;
  readonly z: number;
  readonly label: string;
  readonly color: string;
}

export interface MiniMapOptions {
  readonly host: HTMLElement;
  readonly landmarks: readonly MiniMapLandmark[];
  /** Half-width of the square world view, in metres. */
  readonly halfSize: number;
}

/** A fixed HUD map. Its canvas and landmark list are created once; update()
 * only redraws the small bitmap at the HUD's existing 30 Hz read rate. */
export class MiniMap {
  readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D | null;
  private readonly landmarks: readonly MiniMapLandmark[];
  private readonly halfSize: number;
  private disposed = false;

  constructor(options: MiniMapOptions) {
    const doc = options.host.ownerDocument;
    this.root = doc.createElement('section');
    this.root.className = 'sl-card sl-mini-map';
    this.root.dataset.hudPersistent = '';
    this.root.setAttribute('aria-label', 'World mini-map');
    const title = doc.createElement('h2');
    title.className = 'sl-card__title';
    title.textContent = 'MAP';
    this.root.append(title);
    this.canvas = doc.createElement('canvas');
    this.canvas.width = 180;
    this.canvas.height = 180;
    this.canvas.setAttribute('aria-hidden', 'true');
    this.root.append(this.canvas);
    options.host.append(this.root);
    this.context = this.canvas.getContext('2d');
    this.landmarks = options.landmarks;
    if (!Number.isFinite(options.halfSize) || options.halfSize <= 0)
      throw new RangeError('Mini-map half-size must be positive.');
    this.halfSize = options.halfSize;
  }

  update(telemetry: HudTelemetry | undefined): void {
    if (this.disposed || !this.context) return;
    const ctx = this.context;
    const size = this.canvas.width;
    const center = size / 2;
    const margin = 10;
    const scale = (size - margin * 2) / (this.halfSize * 2);
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#07111c';
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = 'rgba(190, 210, 220, 0.22)';
    ctx.lineWidth = 1;
    ctx.strokeRect(margin, margin, size - margin * 2, size - margin * 2);
    ctx.beginPath();
    ctx.moveTo(center, margin);
    ctx.lineTo(center, size - margin);
    ctx.moveTo(margin, center);
    ctx.lineTo(size - margin, center);
    ctx.stroke();

    for (const landmark of this.landmarks) {
      const x = center + landmark.x * scale;
      const y = center - landmark.z * scale;
      if (x < margin || x > size - margin || y < margin || y > size - margin)
        continue;
      ctx.fillStyle = landmark.color;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f4f7fa';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(landmark.label, x, y - 6);
    }

    if (!telemetry) return;
    const playerX = center + telemetry.position.x * scale;
    const playerY = center - telemetry.position.z * scale;
    const q = telemetry.rotation;
    const forwardX = -2 * (q.x * q.z + q.y * q.w);
    const forwardZ = -(1 - 2 * (q.x * q.x + q.y * q.y));
    const length = 9;
    const width = 5;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(playerX + forwardX * length, playerY - forwardZ * length);
    ctx.lineTo(
      playerX - forwardX * length * 0.5 - forwardZ * width,
      playerY + forwardZ * length * 0.5 - forwardX * width,
    );
    ctx.lineTo(
      playerX - forwardX * length * 0.5 + forwardZ * width,
      playerY + forwardZ * length * 0.5 + forwardX * width,
    );
    ctx.closePath();
    ctx.fill();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.remove();
  }
}
