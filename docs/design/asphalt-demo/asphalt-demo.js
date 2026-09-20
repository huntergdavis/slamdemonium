/* global document, clearTimeout, performance, setTimeout, URL */
"use strict";
(() => {
  // assets/procedural/asphalt.ts
  function finiteRange(name, value, min, max) {
    if (!Number.isFinite(value) || value < min || value > max) {
      throw new RangeError(`${name} must be finite and between ${min} and ${max}`);
    }
  }
  function hash(x, y, seed2) {
    let h = (seed2 ^ Math.imul(x, 521288629) ^ Math.imul(y, 1597334677)) >>> 0;
    h = Math.imul(h ^ h >>> 16, 2146121005);
    h = Math.imul(h ^ h >>> 15, 2221713035);
    return ((h ^ h >>> 16) >>> 0) / 4294967295;
  }
  function makeLayer(size, wavelength, seed2) {
    const cells = Math.min(size, Math.max(2, Math.round(1024 / wavelength)));
    const lattice = new Float32Array(cells * cells);
    for (let y = 0; y < cells; y++) {
      for (let x = 0; x < cells; x++) lattice[y * cells + x] = hash(x, y, seed2) * 2 - 1;
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
  function sample(layer, x, y) {
    const row0 = layer.lower[y] * layer.cells;
    const row1 = layer.upper[y] * layer.cells;
    const x0 = layer.lower[x];
    const x1 = layer.upper[x];
    const tx = layer.blend[x];
    const ty = layer.blend[y];
    const a = layer.lattice[row0 + x0];
    const b = layer.lattice[row0 + x1];
    const c = layer.lattice[row1 + x0];
    const d = layer.lattice[row1 + x1];
    const top = a + (b - a) * tx;
    return top + (c + (d - c) * tx - top) * ty;
  }
  function createAsphaltTexture(options = {}) {
    const { size = 1024, seed: seed2 = 1397506381, grainScale = 1, blotchScale = 128, contrast: contrast2 = 1 } = options;
    finiteRange("size", size, 128, 2048);
    if (!Number.isInteger(size) || (size & size - 1) !== 0) {
      throw new RangeError("size must be a power of two");
    }
    finiteRange("seed", seed2, 0, 4294967295);
    if (!Number.isInteger(seed2)) throw new RangeError("seed must be an integer");
    finiteRange("grainScale", grainScale, 1, 32);
    finiteRange("blotchScale", blotchScale, 16, 512);
    finiteRange("contrast", contrast2, 0, 3);
    const grain2 = makeLayer(size, grainScale, seed2);
    const aggregate = makeLayer(size, grainScale * 4, seed2 ^ 1757159915);
    const blotch2 = makeLayer(size, blotchScale, seed2 ^ 48610963);
    const middle = makeLayer(size, blotchScale / 4, seed2 ^ 2524612763);
    const data = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const fine = sample(grain2, x, y);
        const fleck = fine > 0.78 ? (fine - 0.78) * 42 : fine < -0.86 ? (fine + 0.86) * 28 : 0;
        const variation = contrast2 * (fine * 10 + sample(aggregate, x, y) * 3 + sample(blotch2, x, y) * 9 + sample(middle, x, y) * 4 + fleck);
        const offset = (y * size + x) * 4;
        data[offset] = Math.round(69 + variation);
        data[offset + 1] = Math.round(73 + variation);
        data[offset + 2] = Math.round(77 + variation);
        data[offset + 3] = 255;
      }
    }
    return { width: size, height: size, data };
  }

  // docs/design/asphalt-demo/demo.ts
  var DEFAULT_SEED = 1397506381;
  var grain = document.querySelector("#grain");
  var blotch = document.querySelector("#blotch");
  var contrast = document.querySelector("#contrast");
  var seed = document.querySelector("#seed");
  var source = document.querySelector("#textureSource");
  var preview = document.querySelector("#preview");
  var context = source.getContext("2d");
  var view = preview.getContext("2d");
  var status = document.querySelector("#status");
  var single = document.querySelector("#single");
  var repeat = document.querySelector("#repeat");
  var tileCount = 2;
  var pending;
  function redraw() {
    const edge = preview.width / tileCount;
    view.imageSmoothingEnabled = true;
    view.imageSmoothingQuality = "high";
    for (let y = 0; y < tileCount; y++) {
      for (let x = 0; x < tileCount; x++) view.drawImage(source, x * edge, y * edge, edge, edge);
    }
    single.setAttribute("aria-pressed", String(tileCount === 1));
    repeat.setAttribute("aria-pressed", String(tileCount === 2));
    document.querySelector("#viewTitle").textContent = tileCount === 1 ? "One tile \xB7 full resolution" : "2 \xD7 2 repeat";
    document.querySelector("#viewSize").textContent = `${tileCount * 8} \xD7 ${tileCount * 8} m at the default material scale`;
  }
  function regenerate() {
    clearTimeout(pending);
    try {
      const options = {
        seed: seed.valueAsNumber,
        grainScale: grain.valueAsNumber,
        blotchScale: blotch.valueAsNumber,
        contrast: contrast.valueAsNumber
      };
      const start = performance.now();
      const pixels = createAsphaltTexture(options);
      const elapsed = performance.now() - start;
      const image = context.createImageData(pixels.width, pixels.height);
      image.data.set(pixels.data);
      context.putImageData(image, 0, 0);
      document.querySelector("#duration").textContent = `${elapsed.toFixed(1)} ms`;
      document.querySelector("#grainValue").textContent = `${options.grainScale} px`;
      document.querySelector("#blotchValue").textContent = `${options.blotchScale} px`;
      document.querySelector("#contrastValue").textContent = `${options.contrast.toFixed(2)}\xD7`;
      status.textContent = `Ready \xB7 seed ${options.seed}. Changes regenerate after 150 ms.`;
      source.dataset.seed = String(options.seed);
      source.dataset.contrast = String(options.contrast);
      redraw();
      return true;
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "Texture generation failed.";
      return false;
    }
  }
  for (const input of [grain, blotch, contrast, seed]) {
    input.addEventListener("input", () => {
      clearTimeout(pending);
      pending = setTimeout(regenerate, 150);
    });
  }
  single.addEventListener("click", () => {
    tileCount = 1;
    redraw();
  });
  repeat.addEventListener("click", () => {
    tileCount = 2;
    redraw();
  });
  document.querySelector("#reset").addEventListener("click", () => {
    grain.value = "1";
    blotch.value = "128";
    contrast.value = "1";
    seed.value = String(DEFAULT_SEED);
    regenerate();
  });
  document.querySelector("#download").addEventListener("click", () => {
    if (!regenerate()) return;
    source.toBlob((blob) => {
      if (!blob) {
        status.textContent = "PNG export failed.";
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `asphalt-${seed.value}-g${grain.value}-b${blotch.value}-c${contrast.value}.png`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1e3);
    }, "image/png");
  });
  seed.value = String(DEFAULT_SEED);
  regenerate();
})();
