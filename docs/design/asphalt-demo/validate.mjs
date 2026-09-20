// Run against an ES module compiled from assets/procedural/asphalt.ts.
// See README.md. No test framework or repository scaffold required.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import process from 'node:process';
import console from 'node:console';

if (!process.argv[2]) throw new Error('Pass the compiled asphalt ES module path.');
const { createAsphaltTexture } = await import(pathToFileURL(process.argv[2]).href);
const texture = createAsphaltTexture();
assert.equal(texture.width, 1024);
assert.equal(texture.height, 1024);
assert.equal(texture.data.length, 1024 * 1024 * 4);
for (let i = 3; i < texture.data.length; i += 4) assert.equal(texture.data[i], 255);
const digest = pixels => createHash('sha256').update(pixels.data).digest('hex');
assert.equal(digest(texture), digest(createAsphaltTexture()));
assert.notEqual(digest(texture), digest(createAsphaltTexture({ seed: 42 })));
const flat = createAsphaltTexture({ size: 128, contrast: 0 });
for (let i = 0; i < flat.data.length; i += 4) {
  assert.deepEqual(Array.from(flat.data.subarray(i, i + 4)), [69, 73, 77, 255]);
}
for (const invalid of [
  { size: 129 }, { size: Infinity }, { seed: -1 }, { seed: 1.5 },
  { grainScale: 0 }, { blotchScale: NaN }, { contrast: 4 },
]) assert.throws(() => createAsphaltTexture(invalid), RangeError);

function continuity(pixels) {
  const n = pixels.width;
  const at = (x, y) => pixels.data[(y * n + x) * 4];
  let insideX = 0, insideY = 0, seamX = 0, seamY = 0;
  for (let y = 0; y < n; y++) {
    seamX += Math.abs(at(n - 1, y) - at(0, y));
    seamY += Math.abs(at(y, n - 1) - at(y, 0));
    for (let x = 0; x < n - 1; x++) {
      insideX += Math.abs(at(x, y) - at(x + 1, y));
      insideY += Math.abs(at(y, x) - at(y, x + 1));
    }
  }
  insideX /= n * (n - 1);
  insideY /= n * (n - 1);
  return { insideX, insideY, wrapRatioX: seamX / n / insideX, wrapRatioY: seamY / n / insideY };
}
const normal = continuity(texture);
// A wrap must look like ordinary adjacent texels, not a special high-contrast edge.
assert.ok(normal.wrapRatioX < 1.4 && normal.wrapRatioY < 1.4, JSON.stringify(normal));
const coarse = createAsphaltTexture({ grainScale: 16.5, blotchScale: 320.5 });
const coarseStats = continuity(coarse);
assert.ok(coarseStats.wrapRatioX < 1.7 && coarseStats.wrapRatioY < 1.7, JSON.stringify(coarseStats));
assert.ok(coarseStats.insideX < normal.insideX * 0.4, 'Larger grain must reduce high-frequency variation.');
assert.notEqual(digest(texture), digest(createAsphaltTexture({ blotchScale: 64 })));

const blockMeans = [];
for (let by = 0; by < 1024; by += 64) for (let bx = 0; bx < 1024; bx += 64) {
  let total = 0;
  for (let y = by; y < by + 64; y++) for (let x = bx; x < bx + 64; x++) total += texture.data[(y * 1024 + x) * 4];
  blockMeans.push(total / 4096);
}
const mean = blockMeans.reduce((a, b) => a + b, 0) / blockMeans.length;
const blockDeviation = Math.sqrt(blockMeans.reduce((sum, value) => sum + (value - mean) ** 2, 0) / blockMeans.length);
assert.ok(blockDeviation > 1, 'Broad blotches must survive block averaging.');

const timings = [];
for (let i = 0; i < 10; i++) {
  const start = performance.now();
  createAsphaltTexture();
  timings.push(performance.now() - start);
}
timings.sort((a, b) => a - b);
console.log(JSON.stringify({
  result: 'PASS', node: process.version, rgbaSha256: digest(texture),
  meanRed: mean, broadBlotchDeviation: blockDeviation, defaultContinuity: normal,
  fractionalScaleContinuity: coarseStats,
  generationMs: { runs: 10, median: (timings[4] + timings[5]) / 2, min: timings[0], max: timings[9] },
}, null, 2));
