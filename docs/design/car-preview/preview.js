/* global document, window, requestAnimationFrame, cancelAnimationFrame */
import { Vector3 } from 'three';
import { KeyboardInput } from '../../../src/input/keyboard.ts';
import { InputMapper } from '../../../src/input/mapper.ts';
import { createCarVisual } from '../../../src/render/carVisual.ts';
import { createRenderer } from '../../../src/render/renderer.ts';
import { createTestTrack } from '../../../src/world/track.ts';

const view = createRenderer(document.querySelector('#app'));
view.renderer.shadowMap.enabled = true;
const track = createTestTrack(view.scene, {
  maxAnisotropy: view.renderer.capabilities.getMaxAnisotropy(),
});
const car = createCarVisual(view.scene);
const keyboard = new KeyboardInput();
const input = new InputMapper(keyboard);
const state = {
  position: { x: 130, y: 0.86, z: 0 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  velocityWorld: { x: 0, y: 0, z: -12 },
  brake01: 0,
  handbrake01: 0,
  wheels: [0, 1, 2, 3].map((index) => ({
    centerLocal: {
      x: index % 2 ? 0.8 : -0.8,
      y: -0.52,
      z: index < 2 ? -1.3 : 1.3,
    },
    steerAngle: 0,
    spinAngle: 0,
    grounded: true,
    spinning: false,
    locked: false,
    contactPointWorld: {
      x: 130 + (index % 2 ? 0.8 : -0.8),
      y: 0,
      z: index < 2 ? -1.3 : 1.3,
    },
    tireForceWorld: { x: 0, y: 0, z: -2000 },
  })),
};
const modeControl = document.querySelector('#mode');
const animateControl = document.querySelector('#animate');
const steerControl = document.querySelector('#steer');
const steerValue = document.querySelector('#steer-value');
const gizmoButton = document.querySelector('#gizmos');
const status = document.querySelector('#status');
const offsets = {
  front: [5, 4.5, -7],
  rear: [-5, 4.5, 7],
  side: [7, 1.6, 0],
  top: [0, 12, 0.01],
};
let cameraMode = 'front';
let debugVisible = true;
let frameId = 0;
let previousMs = 0;
let simulationTime = 0;
let statusMs = -Infinity;
const target = new Vector3(130, 0.4, 0);
const tau = 2 * Math.PI;
car.setDebugVisible(true);

function syncGizmoButton() {
  gizmoButton.setAttribute('aria-pressed', String(debugVisible));
  gizmoButton.textContent = debugVisible ? 'G · gizmos on' : 'G · gizmos off';
}
function setCamera(mode) {
  cameraMode = mode;
}
for (const button of document.querySelectorAll('[data-camera]'))
  button.addEventListener('click', () => setCamera(button.dataset.camera));
gizmoButton.addEventListener('click', () => {
  debugVisible = !debugVisible;
  car.toggleDebug();
  syncGizmoButton();
});
steerControl.addEventListener('input', () => {
  steerValue.value = steerControl.value + '°';
});

function frame(nowMs) {
  const dt =
    previousMs && animateControl.checked
      ? Math.min((nowMs - previousMs) / 1000, 0.05)
      : 0;
  previousMs = nowMs;
  simulationTime += dt;
  // Exercise the actual WP4 action routing, including editing/repeat filtering.
  if (input.sampleForStep().actions.gizmos % 2) {
    debugVisible = !debugVisible;
    car.toggleDebug();
    syncGizmoButton();
  }
  const mode = modeControl.value;
  const speed = mode === 'reverse' ? -8 : mode === 'brake' ? 0 : 12;
  state.velocityWorld.x = mode === 'drift' ? 9 : 0;
  state.velocityWorld.z = -speed;
  state.brake01 = mode === 'brake' || mode === 'lock' ? 1 : 0;
  state.handbrake01 = mode === 'drift' ? 0.8 : 0;
  state.position.y = mode === 'air' ? 2 : 0.86;
  for (let index = 0; index < 4; index++) {
    const wheel = state.wheels[index];
    const rear = index >= 2;
    wheel.steerAngle = rear ? 0 : (Number(steerControl.value) * Math.PI) / 180;
    wheel.centerLocal.y =
      mode === 'air'
        ? -0.7
        : -0.52 + 0.055 * Math.sin(simulationTime * 3 + (index * Math.PI) / 2);
    wheel.locked = rear && (mode === 'lock' || mode === 'drift');
    wheel.spinning = rear && mode === 'spin';
    wheel.grounded = mode !== 'air';
    const angularVelocity = wheel.locked
      ? 0
      : (-speed / 0.34) * (wheel.spinning ? 2.5 : 1);
    wheel.spinAngle =
      (((wheel.spinAngle + angularVelocity * dt) % tau) + tau) % tau;
    wheel.tireForceWorld.x = mode === 'drift' ? -3500 : 0;
    wheel.tireForceWorld.z =
      mode === 'brake' || mode === 'lock'
        ? 4000
        : mode === 'reverse'
          ? 2000
          : -2000;
  }
  car.update(state);
  track.updateLighting(state.position);
  const offset = offsets[cameraMode];
  view.camera.position.set(130 + offset[0], offset[1], offset[2]);
  view.camera.lookAt(target);
  view.render();
  // DOM telemetry is throttled independently of render animation, at <=30 Hz.
  if (nowMs - statusMs >= 1000 / 30) {
    statusMs = nowMs;
    status.textContent =
      Math.hypot(state.velocityWorld.x, state.velocityWorld.z).toFixed(1) +
      ' m/s · brake ' +
      Math.round(state.brake01 * 100) +
      '% · handbrake ' +
      Math.round(state.handbrake01 * 100) +
      '% · rear ' +
      (state.wheels[2].locked
        ? 'LOCK'
        : state.wheels[2].spinning
          ? 'SPIN'
          : state.wheels[2].grounded
            ? 'ROLL'
            : 'AIR');
  }
  window.__carPreview.ready = true;
  frameId = requestAnimationFrame(frame);
}
window.__carPreview = { ready: false, car, state, view, track, setCamera };
frameId = requestAnimationFrame(frame);
import.meta.hot?.dispose(() => {
  cancelAnimationFrame(frameId);
  keyboard.dispose();
  car.dispose();
  track.dispose();
  view.dispose();
});
