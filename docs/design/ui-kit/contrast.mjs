import { URL } from 'node:url';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import console from 'node:console';

const css = readFileSync(
  new URL('../../../src/ui/ui.css', import.meta.url),
  'utf8',
);
const properties = Object.fromEntries(
  [...css.matchAll(/--sl-([\w-]+):\s*([^;]+);/g)].map((match) => [
    match[1],
    match[2].trim(),
  ]),
);
function resolve(name) {
  const value = properties[name];
  if (value.startsWith('var(')) return resolve(value.slice(9, -1));
  if (value.startsWith('#'))
    return [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
  const rgba = value.match(/rgb\((\d+) (\d+) (\d+) \/ (\d+)%\)/);
  assert.ok(rgba, 'Unsupported color syntax: ' + value);
  const alpha = Number(rgba[4]) / 100;
  return rgba
    .slice(1, 4)
    .map((channel) => (Number(channel) / 255) * alpha + 1 - alpha);
}
function luminance(rgb) {
  return rgb
    .map((value) =>
      value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
    )
    .reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
}
function ratio(first, second) {
  const a = luminance(resolve(first)),
    b = luminance(resolve(second));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
const report = {};
for (const color of [
  'text',
  'muted',
  'accent',
  'drift',
  'warning',
  'over-limit',
]) {
  report[color] = {};
  for (const surface of ['control', 'panel-surface', 'hud-surface']) {
    const contrast = ratio(color, surface);
    assert.ok(contrast >= 4.5, color + ' on ' + surface + ' is below 4.5:1');
    report[color][surface] = Number(contrast.toFixed(2));
  }
}
assert.ok(ratio('control-border', 'control') >= 3);
assert.ok(ratio('panel', 'accent') >= 4.5);
console.log(
  JSON.stringify(
    { result: 'PASS', whiteBackdrop: true, ratios: report },
    null,
    2,
  ),
);
