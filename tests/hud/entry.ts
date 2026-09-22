import { KeyboardInput } from '../../src/input/keyboard';
import { InputMapper } from '../../src/input/mapper';
import { TuningStore } from '../../src/tuning/store';
import { mountOptionsPanel } from '../../src/ui/optionsPanel';
import { mountHud, type HudOptions } from '../../src/ui/hud';
import type { RecordingExport } from '../../src/ui/telemetryRecorder';
import { VehicleTelemetry } from '../../src/vehicle/telemetry';

const host = document.querySelector<HTMLElement>('#app')!;
const drivingSurface = document.querySelector<HTMLCanvasElement>('canvas')!;
const animate = document.querySelector<HTMLInputElement>('#animate')!;
const store = new TuningStore();
const input = new InputMapper(new KeyboardInput());
const telemetry = new VehicleTelemetry();
telemetry.speed = 55;
telemetry.speedKmh = 198;
telemetry.vLong = 50;
telemetry.beta = 0.3;
telemetry.steerAngle = -0.06;
telemetry.throttle = 0.85;
telemetry.brake01 = 0.24;
telemetry.boostMeter = telemetry.driftMeter = 0.62;
telemetry.groundedWheels = 3;
telemetry.charging = true;
telemetry.physicsStepMs = 0.42;
telemetry.stepsPerFrame = 2;
telemetry.rpm = 6200;
telemetry.gear = 1;
telemetry.gearCount = 5;
telemetry.idleRpm = 900;
telemetry.redlineRpm = 7000;
telemetry.upshiftCount = 0;
telemetry.downshiftCount = 0;
telemetry.lateralAcceleration = 13;
telemetry.longitudinalAcceleration = 4;
for (const wheel of telemetry.wheels) {
  wheel.grounded = true;
  wheel.Fz = 3800;
  wheel.gripUsage = 0.82;
  wheel.alpha = 0.1;
}
telemetry.wheels[1].gripUsage = 1.08;
telemetry.wheels[1].locked = true;
telemetry.wheels[2].spinning = true;
telemetry.wheels[3].grounded = false;
telemetry.wheels[3].Fz = 0;
const render = {
  cameraFov: 115,
  cameraFovRequested: 140,
  cameraFovCapped: true,
  renderScale: 0.8,
  smoothedFrameMs: 16.67,
};
const state = {
  reads: 0,
  renderReads: 0,
  automatic: true,
  now: 0,
  simulation: 0,
  capture: false,
  exports: [] as RecordingExport[],
};
const panel = mountOptionsPanel({
  host,
  drivingSurface,
  store,
  readTelemetry: () => telemetry,
  persistenceOptions: { storage: null, hash: '' },
});
const hudOptions: HudOptions = {
  host: panel.root,
  store,
  session: panel.session,
  durationSeconds: 1,
  readTelemetry: () => {
    state.reads++;
    return telemetry;
  },
  readRenderTelemetry: () => {
    state.renderReads++;
    return render;
  },
  onExport: (recording) => {
    state.exports.push(recording);
    if (!state.capture) {
      const url = URL.createObjectURL(recording.blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = recording.filename;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  },
};
const hud = mountHud(hudOptions);
let previous = 0,
  accumulator = 0;
function sample(count = 1): void {
  for (let i = 0; i < count; i++) {
    const dt = 1 / store.get('physicsHz');
    state.simulation += dt;
    telemetry.speed = 40 + 10 * Math.sin(state.simulation / 2);
    telemetry.speedKmh = telemetry.speed * 3.6;
    telemetry.beta = Math.sin(state.simulation) * 0.6;
    telemetry.yawRate = Math.cos(state.simulation) * 0.5;
    telemetry.lateralAcceleration = Math.sin(state.simulation) * 20;
    telemetry.longitudinalAcceleration = Math.cos(state.simulation) * 8;
    telemetry.charging =
      (Math.abs(telemetry.beta) * 180) / Math.PI >= store.get('driftMinAngle');
    hud.recordStep(telemetry, dt, render);
  }
}
function frame(now: number): void {
  const actions = input.sampleForStep().actions;
  if (actions.hud) hud.cycleMode(actions.hud);
  if (actions.recordTelemetry % 2) hud.toggleRecording();
  if (actions.options % 2) panel.toggle();
  if (actions.swapAB % 2) panel.session.swapSlots();
  if (animate.checked) {
    accumulator += Math.min(0.1, (now - previous) / 1000);
    const dt = 1 / store.get('physicsHz');
    while (accumulator >= dt) {
      sample();
      accumulator -= dt;
    }
  }
  previous = now;
  if (state.automatic) {
    state.now = now;
    hud.update(now);
    panel.update(now);
  }
  requestAnimationFrame(frame);
}
const api = {
  hud,
  panel,
  store,
  telemetry,
  render,
  state,
  sample,
  manual: () => {
    state.automatic = false;
    state.capture = true;
  },
  useNativeDownload: () => {
    delete hudOptions.onExport;
  },
  advance: (milliseconds = 34) => {
    state.now += milliseconds;
    hud.update(state.now);
  },
};
window.__hudTest = api;
requestAnimationFrame(frame);
declare global {
  interface Window {
    __hudTest: typeof api;
  }
}
