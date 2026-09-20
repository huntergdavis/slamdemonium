import { createAsphaltTexture } from '../../../assets/procedural/asphalt';

const DEFAULT_SEED = 0x534c414d;
const grain = document.querySelector<HTMLInputElement>('#grain')!;
const blotch = document.querySelector<HTMLInputElement>('#blotch')!;
const contrast = document.querySelector<HTMLInputElement>('#contrast')!;
const seed = document.querySelector<HTMLInputElement>('#seed')!;
const source = document.querySelector<HTMLCanvasElement>('#textureSource')!;
const preview = document.querySelector<HTMLCanvasElement>('#preview')!;
const context = source.getContext('2d')!;
const view = preview.getContext('2d')!;
const status = document.querySelector<HTMLElement>('#status')!;
const single = document.querySelector<HTMLButtonElement>('#single')!;
const repeat = document.querySelector<HTMLButtonElement>('#repeat')!;
let tileCount = 2;
let pending: ReturnType<typeof setTimeout> | undefined;

function redraw(): void {
  const edge = preview.width / tileCount;
  view.imageSmoothingEnabled = true;
  view.imageSmoothingQuality = 'high';
  for (let y = 0; y < tileCount; y++) {
    for (let x = 0; x < tileCount; x++) view.drawImage(source, x * edge, y * edge, edge, edge);
  }
  single.setAttribute('aria-pressed', String(tileCount === 1));
  repeat.setAttribute('aria-pressed', String(tileCount === 2));
  document.querySelector('#viewTitle')!.textContent = tileCount === 1 ? 'One tile · full resolution' : '2 × 2 repeat';
  document.querySelector('#viewSize')!.textContent = `${tileCount * 8} × ${tileCount * 8} m at the default material scale`;
}

function regenerate(): boolean {
  clearTimeout(pending);
  try {
    const options = {
      seed: seed.valueAsNumber,
      grainScale: grain.valueAsNumber,
      blotchScale: blotch.valueAsNumber,
      contrast: contrast.valueAsNumber,
    };
    const start = performance.now();
    const pixels = createAsphaltTexture(options);
    const elapsed = performance.now() - start;
    const image = context.createImageData(pixels.width, pixels.height);
    image.data.set(pixels.data);
    context.putImageData(image, 0, 0);
    document.querySelector('#duration')!.textContent = `${elapsed.toFixed(1)} ms`;
    document.querySelector('#grainValue')!.textContent = `${options.grainScale} px`;
    document.querySelector('#blotchValue')!.textContent = `${options.blotchScale} px`;
    document.querySelector('#contrastValue')!.textContent = `${options.contrast.toFixed(2)}×`;
    status.textContent = `Ready · seed ${options.seed}. Changes regenerate after 150 ms.`;
    source.dataset.seed = String(options.seed);
    source.dataset.contrast = String(options.contrast);
    redraw();
    return true;
  } catch (error: unknown) {
    status.textContent = error instanceof Error ? error.message : 'Texture generation failed.';
    return false;
  }
}

for (const input of [grain, blotch, contrast, seed]) {
  input.addEventListener('input', () => {
    clearTimeout(pending);
    pending = setTimeout(regenerate, 150);
  });
}
single.addEventListener('click', () => { tileCount = 1; redraw(); });
repeat.addEventListener('click', () => { tileCount = 2; redraw(); });
document.querySelector('#reset')!.addEventListener('click', () => {
  grain.value = '1';
  blotch.value = '128';
  contrast.value = '1';
  seed.value = String(DEFAULT_SEED);
  regenerate();
});
document.querySelector('#download')!.addEventListener('click', () => {
  // Flush a pending slider edit, so export always matches the visible controls.
  if (!regenerate()) return;
  source.toBlob(blob => {
    if (!blob) { status.textContent = 'PNG export failed.'; return; }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `asphalt-${seed.value}-g${grain.value}-b${blotch.value}-c${contrast.value}.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png');
});
seed.value = String(DEFAULT_SEED);
regenerate();
