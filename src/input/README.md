# Input integration

Create one `KeyboardInput`, `GamepadInput`, and `InputMapper` at startup. Pass the mapper into the loop rather than sharing a singleton. It returns a stable `StepInput` extending `GameInput` from `core/gameApi.ts`.

- Call `mapper.sampleForStep()` immediately before every vehicle step. It polls the Gamepad API exactly once and reads the latest keyboard event state. The returned object and its `actions` object are reused. Copy recordings outside the hot path.
- Steering is positive left. Keyboard steering is digital; gamepad axes and triggers retain their raw analog values. Vehicle code applies deadzone, expo, steering ramp, and pedal filters using tuning values.
- Held keyboard driving keys take priority over the selected gamepad for that step. Otherwise the first connected standard controller is used, retaining its selection until disconnected. Both devices' command presses contribute to `actions`.
- `actions` contains counts since the previous step, not held flags. Toggle actions use odd/even parity; one-shot commands can handle each count. Keyboard repeat is suppressed and short taps between steps are preserved. F9 maps to `recordTelemetry` (design 12.2).
- Dispose the keyboard on teardown to remove event listeners. Blur, hidden-tab, and editing-focus handlers clear held keys. Text, number, range, select, and contenteditable controls retain native key handling. Browser modifier shortcuts and composition are ignored.

## Options focus contract

Mark the Options root with `data-options-panel` (a dialog also works). Tab on the driving surface emits `swapAB` and calls `preventDefault`; Tab in Options or native controls navigates normally. Options provides explicit A/B buttons. Keyboard slider interaction retains focus; Options should return focus to the driving surface after pointer slider interaction. A custom DOM can supply `isOptionsTarget` and `isEditingTarget` predicates to `KeyboardInput`.

## Latency probe

`L` immediately writes `event.timeStamp` into the keyboard's preallocated event ring. Sampling marks which events reached a physics step. After rendering, call `mapper.framePresented(rafTimestamp)` with that frame's `requestAnimationFrame` timestamp. Events are counted only after they were sampled and the frame timestamp is at least their event timestamp.

`mapper.latency.stats` reports the latest 100 measurements: count, mean, min, p95, max, target status, and dropped events if the input ring overflowed. The default target is two 60 Hz frames; pass a `LatencyProbe(keyboard.state, displayFrameMs)` to the mapper for another display rate. rAF is the specified presentation proxy; this does not measure physical monitor scanout.

The optional `LatencyProbeView` mounts a screen-border flash, separate EVENT/FRAME indicators, and the summary. Call its `render(rafTimestamp)` on every render, including frames without a physics step. Event handlers perform no DOM work: the event indicator paints on the first available frame, and the frame indicator paints after that event has reached a sampled/rendered step. Dispose the view on teardown. All sampling buffers and state objects are preallocated; only the optional debug display formats text when new measurements arrive.

```ts
const keyboard = new KeyboardInput(window);
const mapper = new InputMapper(keyboard);
const probeView = new LatencyProbeView(mapper.latency, document.body);

// FixedStepLoop.sampleForStep hook:
const controls = mapper.sampleForStep();
// Vehicle reads controls in preStep(dt), including controls.source for filtering.

// After rendering, in the existing rAF callback:
mapper.framePresented(rafTimestamp);
probeView.render(rafTimestamp);
```
