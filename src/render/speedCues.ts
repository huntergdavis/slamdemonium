import { DEFAULT_VALUES, type ParamSet } from '../tuning/schema';

/** Values come from the shared tuning store, so presets/A-B/replays agree. */
export type SpeedCueOptions = Pick<
  ParamSet,
  'speedLinesStrength' | 'vignetteStrength'
>;
export interface SpeedCueState {
  /** Telemetry speed magnitude and the tuning store's unboosted topSpeed, m/s. */
  readonly speed: number;
  readonly topSpeed: number;
  /** The same smoothed [0,1] envelope WP6 uses, not a raw boost key. */
  readonly boostEnvelope: number;
}
export interface SpeedCueLevels {
  speedRatio: number;
  lineAlpha: number;
  vignetteAlpha: number;
}
function unit(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}
function smooth(value: number): number {
  const x = unit(value);
  return x * x * (3 - 2 * x);
}

/** Pure, allocation-free envelope calculation; caller owns the output record. */
export function evaluateSpeedCues(
  state: SpeedCueState,
  options: Readonly<SpeedCueOptions>,
  out: SpeedCueLevels,
): void {
  const ratio =
    state.topSpeed > 0 && Number.isFinite(state.topSpeed)
      ? unit(state.speed / state.topSpeed)
      : 0;
  out.speedRatio = ratio;
  out.lineAlpha =
    0.3 *
    unit(options.speedLinesStrength) *
    Math.max(smooth((ratio - 0.8) / 0.2), unit(state.boostEnvelope));
  out.vignetteAlpha = 0.12 * unit(options.vignetteStrength) * smooth(ratio);
}

/**
 * Transparent canvas above the world and below D3 HUD (z10)/Options (z30).
 * The host is full-viewport #app or a positioned container. No RAF or listeners.
 */
export function createSpeedCues(host: HTMLElement) {
  const canvas = host.ownerDocument.createElement('canvas');
  canvas.className = 'sl-speed-cues';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText =
    'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:5;display:none';
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Speed cues require a 2D canvas context');
  host.append(canvas);
  const options: SpeedCueOptions = {
    speedLinesStrength: DEFAULT_VALUES.speedLinesStrength,
    vignetteStrength: DEFAULT_VALUES.vignetteStrength,
  };
  const state = { speed: 0, topSpeed: 1, boostEnvelope: 0 };
  const levels: SpeedCueLevels = {
    speedRatio: 0,
    lineAlpha: 0,
    vignetteAlpha: 0,
  };
  // Fixed, staggered spokes; no random-number source or objects per frame.
  const count = 32;
  const dx = new Float64Array(count);
  const dy = new Float64Array(count);
  const offsets = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const angle = ((i + 0.37) * Math.PI * 2) / count;
    dx[i] = Math.cos(angle);
    dy[i] = Math.sin(angle);
    offsets[i] = (i * 0.61803398875) % 1;
  }
  let width = 1,
    height = 1,
    pixelRatio = 1,
    phase = 0;
  let gradient: CanvasGradient | undefined;
  let dirty = true,
    painted = false,
    disposed = false;
  let previousLine = -1,
    previousVignette = -1,
    previousPhase = -1;

  function render(): void {
    if (!context || disposed) return;
    evaluateSpeedCues(state, options, levels);
    const moving = levels.lineAlpha > 0;
    if (
      !dirty &&
      previousLine === levels.lineAlpha &&
      previousVignette === levels.vignetteAlpha &&
      (!moving || previousPhase === phase)
    )
      return;
    dirty = false;
    previousLine = levels.lineAlpha;
    previousVignette = levels.vignetteAlpha;
    previousPhase = phase;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    if (painted) context.clearRect(0, 0, width, height);
    painted = false;
    if (!moving && levels.vignetteAlpha === 0) {
      canvas.style.display = 'none';
      return;
    }
    canvas.style.display = 'block';
    if (gradient && levels.vignetteAlpha > 0) {
      context.globalAlpha = levels.vignetteAlpha;
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);
      painted = true;
    }
    if (moving) {
      context.save();
      // Hard guarantee: no streak pixels in the central 64% of either dimension.
      context.beginPath();
      context.rect(0, 0, width, height);
      context.rect(width * 0.18, height * 0.18, width * 0.64, height * 0.64);
      context.clip('evenodd');
      context.strokeStyle = '#F2F4EC';
      context.lineWidth = 1.25; // CSS pixels; stable under world resolution changes.
      context.lineCap = 'butt';
      for (let i = 0; i < count; i++) {
        const progress = (phase + offsets[i]!) % 1;
        const radius = 0.8 + progress * 0.55;
        const tail = radius - 0.06 - levels.speedRatio * 0.07;
        context.globalAlpha = levels.lineAlpha * Math.sin(Math.PI * progress);
        context.beginPath();
        context.moveTo(
          width * (0.5 + dx[i]! * tail * 0.65),
          height * (0.5 + dy[i]! * tail * 0.65),
        );
        context.lineTo(
          width * (0.5 + dx[i]! * radius * 0.65),
          height * (0.5 + dy[i]! * radius * 0.65),
        );
        context.stroke();
      }
      context.restore();
      painted = true;
    }
    context.globalAlpha = 1;
  }

  function update(next: SpeedCueState, dtSeconds: number): void {
    if (disposed) return;
    state.speed = next.speed;
    state.topSpeed = next.topSpeed;
    state.boostEnvelope = next.boostEnvelope;
    evaluateSpeedCues(state, options, levels);
    if (levels.lineAlpha > 0 && Number.isFinite(dtSeconds) && dtSeconds > 0) {
      // Bounded state; caller supplies scaled simulation time, zero when paused.
      const rate =
        0.4 + levels.speedRatio * 1.2 + unit(state.boostEnvelope) * 0.4;
      phase = (phase + (dtSeconds % (1 / rate)) * rate) % 1;
    }
    render();
  }
  function setOptions(next: Readonly<SpeedCueOptions>): void {
    if (disposed) return;
    options.speedLinesStrength = unit(next.speedLinesStrength);
    options.vignetteStrength = unit(next.vignetteStrength);
    // Apply even when paused: zero removes already-painted pixels immediately.
    render();
  }
  function resize(
    nextWidth: number,
    nextHeight: number,
    nextPixelRatio = 1,
  ): void {
    if (!context || disposed) return;
    const w = Math.max(
      1,
      Number.isFinite(nextWidth) ? Math.round(nextWidth) : 1,
    );
    const h = Math.max(
      1,
      Number.isFinite(nextHeight) ? Math.round(nextHeight) : 1,
    );
    const dpr = Math.max(
      0.5,
      Math.min(2, Number.isFinite(nextPixelRatio) ? nextPixelRatio : 1),
    );
    if (gradient && w === width && h === height && dpr === pixelRatio) return;
    width = w;
    height = h;
    pixelRatio = dpr;
    canvas.width = Math.ceil(width * pixelRatio);
    canvas.height = Math.ceil(height * pixelRatio);
    context.setTransform(
      (pixelRatio * width) / 2,
      0,
      0,
      (pixelRatio * height) / 2,
      (pixelRatio * width) / 2,
      (pixelRatio * height) / 2,
    );
    gradient = context.createRadialGradient(0, 0, 0.72, 0, 0, Math.SQRT2);
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(1, 'rgba(0,0,0,1)');
    painted = false;
    dirty = true;
    render();
  }
  function dispose(): void {
    if (disposed) return;
    disposed = true;
    canvas.remove();
    canvas.width = canvas.height = 1;
    gradient = undefined;
  }
  resize(host.clientWidth, host.clientHeight);
  return { canvas, update, setOptions, resize, dispose };
}
