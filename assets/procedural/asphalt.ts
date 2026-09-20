/** Startup-only albedo generator. No DOM, renderer, clock, global RNG or I/O. */
export interface AsphaltOptions {
  /** Power of two, 128–2048. Defaults to the design's 1024 px tile. */
  size?: number;
  /** Unsigned 32-bit integer; equal options produce byte-identical pixels. */
  seed?: number;
  /** Grain wavelength in texels at 1024 px. Larger = coarser; range 1–32. */
  grainScale?: number;
  /** Blotch wavelength in reference texels. Larger = broader; range 16–512. */
  blotchScale?: number;
  /** Multiplier on variation around #45494D. Range 0–3; zero is flat. */
  contrast?: number;
}

export interface AsphaltPixels {
  width: number;
  height: number;
  /** Opaque, row-major sRGB RGBA bytes; copy directly into ImageData.data. */
  data: Uint8ClampedArray;
}

interface NoiseLayer {
  cells: number;
  lattice: Float32Array;
  lower: Uint16Array;
  upper: Uint16Array;
  blend: Float32Array;
}

function finiteRange(name: string, value: number, min: number, max: number): void {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`${name} must be finite and between ${min} and ${max}`);
  }
}

function hash(x: number, y: number, seed: number): number {
  let h = (seed ^ Math.imul(x, 0x1f123bb5) ^ Math.imul(y, 0x5f356495)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return ((h ^ (h >>> 16)) >>> 0) / 0xffffffff;
}

function makeLayer(size: number, wavelength: number, seed: number): NoiseLayer {
  // Integer lattice periods guarantee wrapping even for fractional scale inputs.
  // Limit frequency to output resolution rather than aliasing subpixel detail.
  const cells = Math.min(size, Math.max(2, Math.round(1024 / wavelength)));
  const lattice = new Float32Array(cells * cells);
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) lattice[y * cells + x] = hash(x, y, seed) * 2 - 1;
  }
  const lower = new Uint16Array(size);
  const upper = new Uint16Array(size);
  const blend = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const coordinate = i * cells / size;
    const floor = Math.floor(coordinate);
    const t = coordinate - floor;
    lower[i] = floor;
    upper[i] = (floor + 1) % cells;
    blend[i] = t * t * t * (t * (t * 6 - 15) + 10);
  }
  return { cells, lattice, lower, upper, blend };
}

function sample(layer: NoiseLayer, x: number, y: number): number {
  const row0 = layer.lower[y]! * layer.cells;
  const row1 = layer.upper[y]! * layer.cells;
  const x0 = layer.lower[x]!;
  const x1 = layer.upper[x]!;
  const tx = layer.blend[x]!;
  const ty = layer.blend[y]!;
  const a = layer.lattice[row0 + x0]!;
  const b = layer.lattice[row0 + x1]!;
  const c = layer.lattice[row1 + x0]!;
  const d = layer.lattice[row1 + x1]!;
  const top = a + (b - a) * tx;
  return top + (c + (d - c) * tx - top) * ty;
}

/**
 * Produces a fresh ImageData-compatible object. Use once at world startup.
 * Every noise layer wraps its lattice in both axes: no edge blend, mirrored
 * patches or duplicated border texels. Adjacent border texels differ naturally.
 * Scale arguments are approximate wavelengths, quantized to whole tile periods.
 * At the handoff's 8 m/tile, default grain = 7.8125 mm and blotches = 1 m.
 */
export function createAsphaltTexture(options: AsphaltOptions = {}): AsphaltPixels {
  const { size = 1024, seed = 0x534c414d, grainScale = 1, blotchScale = 128, contrast = 1 } = options;
  finiteRange('size', size, 128, 2048);
  if (!Number.isInteger(size) || (size & (size - 1)) !== 0) {
    throw new RangeError('size must be a power of two');
  }
  finiteRange('seed', seed, 0, 0xffffffff);
  if (!Number.isInteger(seed)) throw new RangeError('seed must be an integer');
  finiteRange('grainScale', grainScale, 1, 32);
  finiteRange('blotchScale', blotchScale, 16, 512);
  finiteRange('contrast', contrast, 0, 3);

  const grain = makeLayer(size, grainScale, seed);
  const aggregate = makeLayer(size, grainScale * 4, seed ^ 0x68bc21eb);
  const blotch = makeLayer(size, blotchScale, seed ^ 0x02e5be93);
  const middle = makeLayer(size, blotchScale / 4, seed ^ 0x967a889b);
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fine = sample(grain, x, y);
      const fleck = fine > 0.78 ? (fine - 0.78) * 42 : fine < -0.86 ? (fine + 0.86) * 28 : 0;
      const variation = contrast * (
        fine * 10 + sample(aggregate, x, y) * 3 +
        sample(blotch, x, y) * 9 + sample(middle, x, y) * 4 + fleck
      );
      const offset = (y * size + x) * 4;
      data[offset] = Math.round(69 + variation);
      data[offset + 1] = Math.round(73 + variation);
      data[offset + 2] = Math.round(77 + variation);
      data[offset + 3] = 255;
    }
  }
  return { width: size, height: size, data };
}
