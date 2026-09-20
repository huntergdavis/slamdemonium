/* global document, window, requestAnimationFrame, cancelAnimationFrame, performance */
import { BoxGeometry, Mesh, MeshStandardMaterial } from 'three';
import { createRenderer } from '../../../src/render/renderer.ts';
import { createTestTrack } from '../../../src/world/track.ts';
const view = createRenderer(document.querySelector('#app'));
view.renderer.shadowMap.enabled = true;
const start = performance.now();
const track = createTestTrack(view.scene, {
  maxAnisotropy: view.renderer.capabilities.getMaxAnisotropy(),
});
const generationMs = performance.now() - start;
const marker = new Mesh(
  new BoxGeometry(1.8, 1, 4),
  new MeshStandardMaterial({ color: 0xff6b24, roughness: 0.72 }),
);
marker.position.set(track.spawn.position.x, track.spawn.position.y, 0);
marker.castShadow = true;
view.scene.add(marker);
let touring = false,
  mode = 'chase',
  frameId = 0,
  previousMs = 0,
  theta = 0;
function scheduleRender() {
  if (!frameId) frameId = requestAnimationFrame(frame);
}
function setView(next) {
  scheduleRender();
  mode = next;
  touring = false;
  document.querySelector('#tour').setAttribute('aria-pressed', 'false');
}
for (const name of ['chase', 'overview', 'infield'])
  document
    .querySelector('#' + name)
    .addEventListener('click', () => setView(name));
document.querySelector('#tour').addEventListener('click', (event) => {
  mode = 'chase';
  touring = !touring;
  scheduleRender();
  event.target.setAttribute('aria-pressed', String(touring));
});
function frame(nowMs) {
  frameId = 0;
  const dt = Math.min((nowMs - previousMs) / 1000, 0.1);
  previousMs = nowMs;
  if (touring) theta += (40 / track.config.centerLineRadius) * dt;
  marker.position.set(130 * Math.cos(theta), 0.86, -130 * Math.sin(theta));
  marker.rotation.y = theta;
  if (mode === 'overview') {
    view.camera.position.set(250, 245, 285);
    view.camera.lookAt(0, 0, 0);
  } else if (mode === 'infield') {
    view.camera.position.set(36, 16, 40);
    view.camera.lookAt(0, 0, 0);
  } else {
    view.camera.position.set(
      marker.position.x + Math.sin(theta) * 10,
      4.5,
      marker.position.z + Math.cos(theta) * 10,
    );
    view.camera.lookAt(
      marker.position.x - Math.sin(theta) * 25,
      0.5,
      marker.position.z - Math.cos(theta) * 25,
    );
  }
  track.updateLighting(marker.position);
  view.render();
  window.__trackPreview.ready = true;
  if (touring) scheduleRender();
}
window.__trackPreview = {
  ready: false,
  track,
  view,
  marker,
  counts: Object.fromEntries(
    ['dashes', 'ticks', 'curbs', 'posts', 'barriers'].map((name) => [
      name,
      track.root.getObjectByName('track.' + name).count,
    ]),
  ),
  generationMs,
};
document.querySelector('#status').textContent =
  'Track construction ' +
  generationMs.toFixed(0) +
  ' ms · 1024 px asphalt · 8 m tiles';
const defaultFog = view.scene.fog;
document.querySelector('#fog').addEventListener('click', (event) => {
  view.scene.fog = view.scene.fog ? null : defaultFog;
  event.target.setAttribute('aria-pressed', String(Boolean(view.scene.fog)));
  event.target.textContent = view.scene.fog ? 'Fog on' : 'Fog off';
  scheduleRender();
});
window.addEventListener('resize', scheduleRender);
scheduleRender();
import.meta.hot?.dispose(() => {
  cancelAnimationFrame(frameId);
  window.removeEventListener('resize', scheduleRender);
  track.dispose();
  marker.geometry.dispose();
  marker.material.dispose();
  view.dispose();
});
