# Options integration (WP7)

`mountOptionsPanel` from `./optionsPanel` imports the canonical D3 stylesheet and returns one `OptionsPanel`. Boot remains owned by developer 1; this work package exports the component without changing `main.ts`.

```ts
const options = mountOptionsPanel({
  host,                        // HTMLElement containing the game
  drivingSurface: canvas,      // focusable canvas: set tabIndex = 0
  store: tuning,               // the ONE live TuningStore owned by boot
  readRebuildState: () => massRebuild.state, // reporting only; boot owns updates
  readTelemetry: () => vehicle.telemetry, // optional until WP5 is available
  onPauseChange: paused => { optionsPaused = paused; syncPause(); },
});
```

- Boot owns the single headless-safe `DebouncedMassRebuild` and its 100 ms debounce, flush, cancel, and disposal. Construct it before mounting Options so restoration changes also reach it. Remove the old immediate `needsRebuild` subscriber. Options never applies or schedules mass updates.
- `readRebuildState` returns a stable readonly `{ status: 'idle' | 'pending' | 'error' | 'unavailable', error: string | null }`. The panel polls it at most 30 Hz while open and updates existing badges/text only when it changes. Omit the getter to display unavailable. Script loading must flush/cancel through the boot-owned controller, including when no panel is mounted.
- If persistence must restore before body creation, create `TuningStorage(tuning)` first and pass it as `persistence`. The panel then leaves its disposal to the caller. Otherwise the panel creates and disposes persistence, using the same injected store.
- After sampling input, call `options.toggle()` for an odd `actions.options` count and `options.session.swapSlots()` for an odd `actions.swapAB` count. Keep UI command sampling alive while the simulation is paused. Do not add a second keyboard handler: WP4 already scopes Tab and editing correctly.
- Call `options.update(nowMs)` from the animation frame. Its gate precedes the optional telemetry getter and caps reads at 30 Hz; hidden/collapsed tire plots do not sample. Telemetry is `{ wheels: readonly { Fz: number; alpha: number; gripUsage: number }[] }`, ordered FL, FR, RL, RR. `alpha` is radians and only finite, positive-load wheels produce dots. With no data it says so instead of plotting fabricated zeros.
- Combine the pause callback with visibility/user pause. Do not change `timeScale` to pause. Closing Options releases only the Options pause request.
- Route automated preset changes through `options.session.applyBuiltin(name)` to keep the active preset baseline and selector in sync. Scalar changes still go directly through `tuning.set`.
- Read `options.session.activeSlot` for the future HUD. Listen with `session.onUpdate` if needed; it returns an unsubscribe callback. A/B slots are session snapshots; the active working set and named presets persist locally.
- Call `options.dispose()` on teardown. It disconnects observers/subscriptions and flushes owned persistence. Page hide also flushes pending saves. Neither action cancels or applies physics work.

All schema fields are present once in groups, with 14 additional Quick Tune views sharing the same values. Sliders follow schema steps (discrete physics rates use index positions); typed numeric values retain precision within bounds. Logarithmic mapping applies to positive ranges over 20× and the explicitly recommended mass control. Edited markers compare against the selected preset, so autosave does not clear them.

The browser tests compile `tests/options/index.html` with Vite and serve its built JS/CSS. This isolated consumer exercises the same exported component without touching boot or shipping its test driver. `e2e/options.spec.ts` covers controls, native focus behavior, A/B, persistence, import/export/share, externally reported rebuild states, 30 Hz read limits, and narrow viewports. The boot controller's tests own debounce/flush/cancel behavior.

## Pause menu (WP16)

`mountPauseMenu` from `./pauseMenu` consumes the existing Options instance and
boot's existing pause coordinator:

```ts
const pauseMenu = mountPauseMenu({
  host,
  drivingSurface: canvas,
  options, // same OptionsPanel; never create a second store or panel
  readPaused: isPaused,
  onPauseChange(paused) { menuPaused = paused; syncPause(); },
  onRespawn: respawn,
  readGamepad: () => input.gamepad.state,
});
```

Add `menuPaused` to the existing aggregate used by `loop.setPaused`. It is a
pause reason, not another pause mechanism. A menu close clears only this reason:
P, Options' checkbox, hidden-tab, performance and replay pauses remain owned by
boot. Restart calls the same synchronous respawn operation as R, then closes the
menu. It must also work while physics is stopped.

Dispatch odd `actions.pauseMenu` counts to `pauseMenu.toggle()`. Escape and
standard gamepad button 9 (Start/Menu) produce this action; P remains `pause`.
Start now opens the pause menu, where Options is reachable, instead of directly
opening Options. O and the gear keep their direct Options behavior.

Call `pauseMenu.update(nowMs)` once per RAF **after** action polling, including
paused frames. Continue WP14's `input.sampleActions()` on paused frames; never
sample a script's driving state without its matching completed physics step.
The menu reads preallocated gamepad state and never adds a Gamepad API poll.
D-pad/left stick navigates, A selects, B returns, and left/right adjusts existing
Options sliders/numbers/selects. Text entry and native file dialogs still use the
keyboard/browser UI. A held stick repeats after 350 ms, then every 110 ms.

The native dialog isolates focus. When Options is selected, the existing panel
element is temporarily moved into that dialog's focus scope, retaining all its
nodes/listeners/store. Closing Options returns to the paused menu; resuming
restores the element to its original DOM position and focuses the driving
surface. Dispose the menu **before** disposing Options.

KeyboardInput gives native fullscreen/pointer-lock Escape priority, without
calling preventDefault for that gesture. It also guards an exit event arriving
before its keydown and ignores repeats until release. The following Escape
opens the menu. This follows the browser's required unlock/exit ownership:
[Pointer Lock requirements](https://www.w3.org/TR/pointerlock-2/#requirements)
and [Fullscreen UI](https://fullscreen.spec.whatwg.org/#ui).

`e2e/pauseMenu.spec.ts` compiles a separate Vite consumer of the actual
mapper/loop/Options/menu. It tests keyboard and gamepad use, stable stopped
physics/script-sample counts, preserved external pause reasons, Options DOM
identity, native fullscreen/pointer-lock exit and a 320×480 viewport.
