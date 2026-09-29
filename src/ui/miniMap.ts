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
  /** A route to draw as a closed outline: the road on a map that is one. */
  readonly route?:
    readonly { readonly x: number; readonly z: number }[] | undefined;
}

/** A fixed HUD map. Its canvas and landmark list are created once; update()
 * only redraws the small bitmap at the HUD's existing 30 Hz read rate. */
export class MiniMap {
  readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D | null;
  private readonly landmarks: readonly MiniMapLandmark[];
  private readonly route:
    readonly { readonly x: number; readonly z: number }[] | undefined;
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
    this.route = options.route;
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
    // World to canvas. The world is y-up and right-handed with north as +z,
    // so a driver facing north has +x on the LEFT (right = forward x up =
    // (-1, 0, 0)). North up on the map means -x to the right. The map once
    // put +x on the right, a mirror on one axis: turning right moved the
    // marker left, in every direction of travel, for two days of builds
    // (2026-09-27 to 28). The forward vector from the rotation is correct
    // and so is the triangle's perpendicular; only this axis was wrong.
    const mapX = (worldX: number) => center - worldX * scale;
    const mapY = (worldZ: number) => center - worldZ * scale;
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

    if (this.route && this.route.length > 1) {
      ctx.strokeStyle = 'rgba(190, 210, 220, 0.7)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      this.route.forEach((p, i) => {
        const x = mapX(p.x);
        const y = mapY(p.z);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.stroke();
    }
    for (const landmark of this.landmarks) {
      const x = mapX(landmark.x);
      const y = mapY(landmark.z);
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
    const playerX = mapX(telemetry.position.x);
    const playerY = mapY(telemetry.position.z);
    const q = telemetry.rotation;
    // The car's forward, the world's -z axis rotated by its orientation.
    const forwardX = -2 * (q.x * q.z + q.y * q.w);
    const forwardZ = -(1 - 2 * (q.x * q.x + q.y * q.y));
    // The same direction in canvas units: through the same axis mapping as
    // positions, so the arrow and the motion cannot disagree.
    const dirX = -forwardX;
    const dirY = -forwardZ;
    const length = 9;
    const width = 5;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(playerX + dirX * length, playerY + dirY * length);
    ctx.lineTo(
      playerX - dirX * length * 0.5 - dirY * width,
      playerY - dirY * length * 0.5 + dirX * width,
    );
    ctx.lineTo(
      playerX - dirX * length * 0.5 + dirY * width,
      playerY - dirY * length * 0.5 - dirX * width,
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
