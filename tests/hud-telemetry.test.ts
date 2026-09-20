import { describe, expect, it } from 'vitest';
import { TuningStore } from '../src/tuning/store';
import { VehicleTelemetry } from '../src/vehicle/telemetry';
import {
  HudHistory,
  axleSlip,
  type HudRenderTelemetry,
} from '../src/ui/hudTelemetry';
import { CSV_COLUMNS, TelemetryRecorder } from '../src/ui/telemetryRecorder';

async function rows(recorder: TelemetryRecorder) {
  const result = recorder.takeExport()!;
  const lines = (await result.blob.text()).trim().split('\n');
  return {
    result,
    header: JSON.parse(lines[0]!.slice(2)),
    columns: lines[1]!.split(','),
    samples: lines.slice(2).map((line) => line.split(',')),
  };
}

describe('physics-rate CSV', () => {
  it('copies scalars from the same accelerating source object, including render/wheel state', async () => {
    const store = new TuningStore();
    const recorder = new TelemetryRecorder(store, { durationSeconds: 1 });
    const telemetry = new VehicleTelemetry();
    const render: {
      -readonly [K in keyof HudRenderTelemetry]: HudRenderTelemetry[K];
    } = {
      cameraFov: 70,
      cameraFovRequested: 70,
      cameraFovCapped: false,
      renderScale: 1,
      smoothedFrameMs: 16,
    };
    recorder.start();
    expect(recorder.capacity).toBe(store.get('physicsHz'));
    for (let i = 1; i <= 4; i++) {
      telemetry.speed = i * 3;
      // Two samples in each synthetic frame; the producer changes this only
      // after a frame completes, never to its partial catch-up counter.
      telemetry.stepsPerFrame = i <= 2 ? 3 : 5;
      telemetry.speedKmh = telemetry.speed * 3.6;
      telemetry.wheels[0].Fz = 1000 * i;
      telemetry.wheels[0].spinning = i === 3;
      render.cameraFov = 70 + i;
      recorder.sample(telemetry, 1 / 120, render);
    }
    telemetry.speed = 999;
    telemetry.wheels[0].Fz = 999;
    render.cameraFov = 999;
    recorder.stop();
    const data = await rows(recorder);
    const column = (name: string) =>
      data.samples.map((row) => Number(row[data.columns.indexOf(name)]));
    expect(column('speed_m_s')).toEqual([3, 6, 9, 12]);
    expect(column('FL_Fz_N')).toEqual([1000, 2000, 3000, 4000]);
    expect(column('FL_spinning')).toEqual([0, 0, 1, 0]);
    expect(column('camera_fov_deg')).toEqual([71, 72, 73, 74]);
    expect(column('steps_per_frame')).toEqual([3, 3, 5, 5]);
    expect(data.header.stepsPerFrameSemantics).toContain(
      'last completed rendered frame',
    );
    expect(column('time_s')[3]).toBeCloseTo(4 / 120);
    expect(data.header.parameters).toEqual(store.snapshot());
    expect(data.columns).toHaveLength(53);
    expect(data.samples.every((row) => row.length === CSV_COLUMNS.length)).toBe(
      true,
    );
    expect(recorder.takeExport()).toBeNull();
    recorder.dispose();
  });

  it('stops visibly at capacity without replacing the first sample', async () => {
    const store = new TuningStore({ physicsHz: 60 });
    const recorder = new TelemetryRecorder(store, { durationSeconds: 0.05 });
    const telemetry = new VehicleTelemetry();
    recorder.start();
    expect(recorder.capacity).toBe(3);
    for (let i = 1; i <= 5; i++) {
      telemetry.speed = i;
      recorder.sample(telemetry, 1 / 60);
    }
    expect(recorder.recording).toBe(false);
    expect(recorder.stopReason).toBe('capacity');
    const data = await rows(recorder);
    expect(data.header.stopReason).toBe('capacity');
    expect(data.header.sampleCount).toBe(3);
    expect(data.samples.map((row) => row[3])).toEqual(['1', '2', '3']);
    expect(data.samples[0]![25]).toBe(''); // Missing camera data is not fabricated.
    recorder.dispose();
  });

  it('stops before mixing rates, preserving the initial parameter header and live changes', async () => {
    const store = new TuningStore();
    const recorder = new TelemetryRecorder(store, { durationSeconds: 1 });
    recorder.start();
    recorder.sample(new VehicleTelemetry(), 1 / 120);
    store.set('gripFront', 2);
    store.set('physicsHz', 60);
    recorder.sample(new VehicleTelemetry(), 1 / 60);
    expect(recorder.recording).toBe(false);
    const data = await rows(recorder);
    expect(data.header.stopReason).toBe('physics-rate-changed');
    expect(data.header.parameters.physicsHz).toBe(120);
    expect(data.header.physicsHz).toBe(120);
    expect(
      data.header.parameterChanges.map((c: { key: string }) => c.key),
    ).toEqual(['gripFront', 'physicsHz']);
    expect(data.samples).toHaveLength(1);
    recorder.start();
    expect(recorder.capacity).toBe(60);
    recorder.sample(new VehicleTelemetry(), 1 / 120);
    expect(recorder.stopReason).toBe('step-rate-mismatch');
    recorder.dispose();
  });
});

describe('bounded HUD history', () => {
  it('retains ten seconds without aliasing and preserves signed axle slip / missing contact', () => {
    const history = new HudHistory();
    const telemetry = new VehicleTelemetry();
    const first = telemetry.wheels[0];
    first.grounded = true;
    first.Fz = 1000;
    first.alpha = -Math.PI / 6;
    expect(axleSlip(telemetry, 0)).toBeCloseTo(-30);
    expect(axleSlip(telemetry, 2)).toBeNaN();
    const storage = history.values;
    for (let i = 0; i <= 600; i++) {
      telemetry.speed = i;
      history.push(i / 30, telemetry);
    }
    telemetry.speed = -1;
    expect(history.values).toBe(storage);
    expect(history.count).toBe(301);
    expect(history.times[history.index(0)]).toBe(10);
    expect(history.times[history.index(300)]).toBe(20);
    expect(history.values[history.index(0) * history.stride]).toBe(300);
    expect(history.values[history.index(300) * history.stride]).toBe(600);
  });
});
