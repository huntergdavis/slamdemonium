/* global document, window, requestAnimationFrame, cancelAnimationFrame */
import { createRenderer } from '../../../src/render/renderer.ts';
import { createCarVisual } from '../../../src/render/carVisual.ts';
import { createSpeedCues } from '../../../src/render/speedCues.ts';
import { createTestTrack } from '../../../src/world/track.ts';
import { TuningStore } from '../../../src/tuning/store.ts';
import { mountOptionsPanel } from '../../../src/ui/optionsPanel.ts';

const host = document.querySelector('#app');
const view = createRenderer(host);
view.renderer.shadowMap.enabled = true;
const track = createTestTrack(view.scene, {
  maxAnisotropy: view.renderer.capabilities.getMaxAnisotropy(),
});
const fog = view.scene.fog;
const car = createCarVisual(view.scene);
const cues = createSpeedCues(host);
const store = new TuningStore();
let panelPaused = false;
const panel = mountOptionsPanel({
  host,
  drivingSurface: view.renderer.domElement,
  store,
  persistenceOptions: { storage: null, hash: '' },
  onPauseChange: (paused) => {
    panelPaused = paused;
  },
});
const speedInput = document.querySelector('#speed');
const boostInput = document.querySelector('#boost');
const animateInput = document.querySelector('#animate');
const fogInput = document.querySelector('#fog');
const status = document.querySelector('#status');
const state = { speed: 60, topSpeed: store.get('topSpeed'), boostEnvelope: 0 };
const options = {
  speedLinesStrength: store.get('speedLinesStrength'),
  vignetteStrength: store.get('vignetteStrength'),
};
const pose = {
  position: { x: 130, y: 0.86, z: 0 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  velocityWorld: { x: 0, y: 0, z: -60 },
  brake01: 0,
  handbrake01: 0,
  wheels: [0, 1, 2, 3].map((i) => ({
    centerLocal: { x: i % 2 ? 0.8 : -0.8, y: -0.52, z: i < 2 ? -1.3 : 1.3 },
    steerAngle: i < 2 ? 0.02 : 0,
    spinAngle: 0,
    grounded: true,
    spinning: false,
    locked: false,
    contactPointWorld: { x: 0, y: 0, z: 0 },
    tireForceWorld: { x: 0, y: 0, z: 0 },
  })),
};
let theta = 0,
  previous = 0,
  frameId = 0,
  dirty = true,
  lastStatus = -Infinity;
const unsubscribe = store.onChange(() => {
  options.speedLinesStrength = store.get('speedLinesStrength');
  options.vignetteStrength = store.get('vignetteStrength');
  state.topSpeed = store.get('topSpeed');
  cues.setOptions(options);
  dirty = true;
});
for (const input of [speedInput, boostInput, animateInput, fogInput])
  input.addEventListener('input', () => {
    dirty = true;
  });
document
  .querySelector('#off')
  .addEventListener('click', () =>
    store.patch({ speedLinesStrength: 0, vignetteStrength: 0 }),
  );
document.querySelector('#defaults').addEventListener('click', () => {
  store.reset('speedLinesStrength');
  store.reset('vignetteStrength');
});
function resize() {
  cues.resize(host.clientWidth, host.clientHeight, window.devicePixelRatio);
  dirty = true;
}
window.addEventListener('resize', resize);
resize();
function frame(now) {
  const dt =
    previous && animateInput.checked && !panelPaused
      ? Math.min(0.1, (now - previous) / 1000) * store.get('timeScale')
      : 0;
  previous = now;
  panel.update(now);
  if (dt > 0 || dirty) {
    state.speed = Number(speedInput.value);
    state.boostEnvelope = boostInput.checked ? 1 : 0;
    theta = (theta + (state.speed * dt) / 130) % (2 * Math.PI);
    pose.position.x = 130 * Math.cos(theta);
    pose.position.z = -130 * Math.sin(theta);
    pose.rotation.y = Math.sin(theta / 2);
    pose.rotation.w = Math.cos(theta / 2);
    for (const wheel of pose.wheels)
      wheel.spinAngle =
        (((wheel.spinAngle - (state.speed / 0.34) * dt) % (2 * Math.PI)) +
          2 * Math.PI) %
        (2 * Math.PI);
    car.update(pose);
    track.updateLighting(pose.position);
    fog.density = fogInput.checked ? track.config.fogDensity : 0;
    view.camera.position.set(
      pose.position.x + Math.sin(theta) * 7.5,
      3.46,
      pose.position.z + Math.cos(theta) * 7.5,
    );
    view.camera.lookAt(
      pose.position.x - Math.sin(theta) * 10,
      1.66,
      pose.position.z - Math.cos(theta) * 10,
    );
    view.render();
    cues.update(state, dt);
    window.__speedPreview.ready = true;
    if (now - lastStatus >= 1000 / 30) {
      lastStatus = now;
      document.querySelector('#speed-value').value = state.speed + ' m/s';
      status.textContent =
        Math.round((state.speed / state.topSpeed) * 100) +
        '% top speed · strengths ' +
        options.speedLinesStrength.toFixed(2) +
        ' / ' +
        options.vignetteStrength.toFixed(2);
    }
    dirty = false;
  }
  frameId = requestAnimationFrame(frame);
}
window.__speedPreview = {
  ready: false,
  view,
  track,
  car,
  cues,
  state,
  store,
  panel,
  fog,
};
frameId = requestAnimationFrame(frame);
import.meta.hot?.dispose(() => {
  cancelAnimationFrame(frameId);
  window.removeEventListener('resize', resize);
  unsubscribe();
  panel.dispose();
  cues.dispose();
  car.dispose();
  track.dispose();
  view.dispose();
});
