# Procedural asphalt handoff (D2)

Open [index.html](index.html) directly in a browser. The checked-in classic JavaScript bundle works over `file://`, without a server, network request or root project scaffold. Use **One tile** to inspect grain at full resolution, **2 × 2** to inspect joins, and **Download PNG** to export the current settings. Reset restores the sample settings.

Source of truth: [design 9.3](../../vertical-slice-design.md#93-materials) and [visual direction](../visual-direction.md). This is an albedo study; lighting and roughness are not simulated by the 2D canvas. The material handoff defaults are **8 m per tile, roughness 0.95, metalness 0.0**.

## Generator API

Import `createAsphaltTexture` from [assets/procedural/asphalt.ts](../../../assets/procedural/asphalt.ts). It is a pure TypeScript pixel generator: no DOM, three.js, clock, global random state or dependencies. It returns a fresh `{ width, height, data: Uint8ClampedArray }`, compatible with `ImageData.data.set(...)`. Run once at startup; no allocation constraints are assumed inside this startup function.

```ts
const pixels = createAsphaltTexture({
  size: 1024,
  seed: 0x534c414d,
  grainScale: 1,
  blotchScale: 128,
  contrast: 1,
});
```

| Argument | Default | Accepted range / meaning |
|---|---|---|
| `size` | 1024 | Power of two, 128–2048; square output |
| `seed` | 1397506381 (`0x534c414d`) | Integer 0–4294967295; same arguments give identical pixels |
| `grainScale` | 1 | 1–32 reference texels; larger makes grain coarser |
| `blotchScale` | 128 | 16–512 reference texels; larger makes broad blotches larger |
| `contrast` | 1 | 0–3; multiplier on brightness variation; zero yields solid `#45494D` |

Scales are wavelengths measured at the **1024 px reference resolution**, so changing resolution preserves their approximate physical scale. With 8 m tiles, default grain is 7.8125 mm and default blotches are 1 m. Frequency is quantized to a whole number of lattice periods per tile: approximately `round(1024 / scale)`. Low-resolution output caps frequency at its own resolution rather than aliasing extra detail. Fractional scales are accepted; tiny scale changes may select the same period count and produce the same texture. Invalid/non-finite arguments throw `RangeError` rather than silently replacing values.

The texture combines fine grain, a coarser aggregate layer, broad blotches and smaller variation within the blotches. Sparse light/dark flecks give grain definition. Each lattice wraps in both axes and uses quintic interpolation. This gives periodic values and continuous slopes across a tile boundary without mirrored patches or an edge-blending band. The last and first texel columns are adjacent samples, **not duplicated endpoints**; a test expecting equal border columns would be incorrect.

Output is opaque sRGB RGBA, centered near `#45494D`. It is an albedo map, not a roughness/normal map. The default sample's mean red byte is 70.23, and large 64×64-pixel block means have a standard deviation of 4.07 bytes, retaining broad variation after fine grain is averaged out.

## WP3 integration in `src/world/materials.ts`

Use the source module directly; the demo bundle is only for viewing the prototype. Adapt this initialization snippet to the world material factory:

```ts
import {
  CanvasTexture, LinearFilter, LinearMipmapLinearFilter,
  MeshStandardMaterial, RepeatWrapping, SRGBColorSpace,
} from 'three';
import { createAsphaltTexture } from '../../assets/procedural/asphalt';

const pixels = createAsphaltTexture();
const canvas = document.createElement('canvas');
canvas.width = pixels.width;
canvas.height = pixels.height;
const context = canvas.getContext('2d')!;
const image = context.createImageData(pixels.width, pixels.height);
image.data.set(pixels.data);
context.putImageData(image, 0, 0);

const map = new CanvasTexture(canvas);
map.colorSpace = SRGBColorSpace;
map.wrapS = map.wrapT = RepeatWrapping;
map.generateMipmaps = true;
map.minFilter = LinearMipmapLinearFilter;
map.magFilter = LinearFilter;
map.anisotropy = renderer.capabilities.getMaxAnisotropy();
// If track UVs cover the full 300 m disc once:
map.repeat.set(300 / 8, 300 / 8);
const material = new MeshStandardMaterial({
  map, color: 0xffffff, roughness: 0.95, metalness: 0,
});
```

The snippet assumes `renderer` is the existing WebGLRenderer. Use consistent world-projected UVs on the ring and infield: if UV spans the entire disc diameter, repeat 37.5 times; if UV is already world meters divided by 8, keep texture repeat at 1. Do not use both transformations. A separate annulus must not restart UV at its inner edge. Paint stays separate and receives its own depth offset.

Keep the material white: multiplying by the asphalt base color would darken the already colored map twice. The full RGBA output is 4 MiB; GPU mip levels add about one third before driver overhead. Noise lattice arrays are temporary startup memory. Regeneration is synchronous; do not run it in the game render/physics loop. If a later material editor regenerates repeatedly, debounce or move generation to a worker and dispose replaced GPU textures. Current slice generation happens once during loading.

## Rebuild and verify without root files

Run from the repository root. These commands use temporary npm tooling; they do not create a root package.json, lockfile or tsconfig. Tool versions used for this handoff: TypeScript 7.0.2, esbuild 0.28.2 and Playwright 1.63.0.

```sh
npx --yes --package=typescript@7.0.2 tsc --noEmit --strict --noUncheckedIndexedAccess --target ES2020 --module ESNext --moduleResolution bundler --lib ES2020,DOM assets/procedural/asphalt.ts docs/design/asphalt-demo/demo.ts
npx --yes --package=esbuild@0.28.2 esbuild docs/design/asphalt-demo/demo.ts --bundle --format=iife --target=es2020 --banner:js='/* global document, clearTimeout, performance, setTimeout, URL */' --outfile=docs/design/asphalt-demo/asphalt-demo.js
npx --yes --package=esbuild@0.28.2 esbuild assets/procedural/asphalt.ts --format=esm --target=es2020 --outfile=/tmp/slamdemonium-asphalt-validation.mjs
node docs/design/asphalt-demo/validate.mjs /tmp/slamdemonium-asphalt-validation.mjs
```

After changing TypeScript, rebuild and commit `asphalt-demo.js` with it. Regenerate the sample by opening the demo, pressing Reset and downloading PNG, then save it as [assets/procedural/asphalt-sample.png](../../../assets/procedural/asphalt-sample.png). The PNG is a review asset; production should generate its map from the source function.

Checks completed on 2026-09-20:

1. Strict type checking with unchecked-index validation; deterministic output, seed changes, dimensions, opacity, parameter rejection and zero-contrast color checks passed.
2. Default wrap-edge differences were **0.980× horizontal / 1.015× vertical** relative to ordinary adjacent texels. Fractional grain/blotch scales also passed continuity checks. Larger grain reduced high-frequency differences. Broad blotches survived block averaging. Visual inspection of the 2×2 preview found no boundary stripe.
3. Chromium 153.0.8010.12 loaded the page directly from disk with no remote requests or console errors. Single/repeat view, scale/contrast generation, invalid seed feedback, Reset and PNG download were exercised. Layout was checked at 1440 px, 1024 px and 740 px widths; the narrow layout had no horizontal overflow.
4. The default PNG is 1024×1024 RGBA, 1,321,246 bytes. Default raw RGBA SHA-256 is `6f1961a7ec112576504d12d8595c2a9115d5e4957754d015392661469a3a5c56` (hash pixels, not PNG compression bytes).

## Measured generation time

Shared Linux agent host, 1024×1024 default settings; timings bracket **only `createAsphaltTexture()`**, including its allocations and excluding canvas upload, draw, PNG encoding and network. These are prototype measurements, not target-device acceptance results.

| Environment | Cold first call | Warm median, 10 calls | Warm min–max |
|---|---|---|---|
| Chromium 153.0.8010.12, headless | 964.6 ms | 417.2 ms | 339.3–698.9 ms |
| Node 22.22.1 | Not recorded | 519.5 ms | 402.8–797.8 ms |

Host contention affects these timings. Budget startup work explicitly at WP3 and remeasure on the target browser/hardware; this generator has not yet been profiled inside the game's complete startup path. Safari/Firefox and actual mipmapped grazing-angle rendering remain integration checks.
