# Options integration (WP7)

`mountOptionsPanel` from `./optionsPanel` imports the canonical D3 stylesheet and returns one `OptionsPanel`. Boot remains owned by developer 1; this work package exports the component without changing `main.ts`.

```ts
const options = mountOptionsPanel({
  host,                        // HTMLElement containing the game
  drivingSurface: canvas,      // focusable canvas: set tabIndex = 0
  store: tuning,               // the ONE live TuningStore owned by boot
  applyMassProperties,         // update existing body; preserve pose and velocities
  readTelemetry: () => vehicle.telemetry, // optional until WP5 is available
  onPauseChange: paused => { optionsPaused = paused; syncPause(); },
});
```

- Replace the old immediate `needsRebuild` subscriber with this callback. The panel session owns the trailing 100 ms debounce, including mass changes during localStorage/hash restoration. Read the latest store values inside the callback. Do not recreate, teleport, respawn, or stop the body.
- If persistence must restore before body creation, create `TuningStorage(tuning)` first and pass it as `persistence`. The panel then leaves its disposal to the caller. Otherwise the panel creates and disposes persistence, using the same injected store.
- After sampling input, call `options.toggle()` for an odd `actions.options` count and `options.session.swapSlots()` for an odd `actions.swapAB` count. Keep UI command sampling alive while the simulation is paused. Do not add a second keyboard handler: WP4 already scopes Tab and editing correctly.
- Call `options.update(nowMs)` from the animation frame. Its gate precedes the optional telemetry getter and caps reads at 30 Hz; hidden/collapsed tire plots do not sample. Telemetry is `{ wheels: readonly { Fz: number; alpha: number; gripUsage: number }[] }`, ordered FL, FR, RL, RR. `alpha` is radians and only finite, positive-load wheels produce dots. With no data it says so instead of plotting fabricated zeros.
- Combine the pause callback with visibility/user pause. Do not change `timeScale` to pause. Closing Options releases only the Options pause request.
- Route automated preset changes through `options.session.applyBuiltin(name)` to keep the active preset baseline and selector in sync. Scalar changes still go directly through `tuning.set`.
- Read `options.session.activeSlot` for the future HUD. Listen with `session.onUpdate` if needed; it returns an unsubscribe callback. A/B slots are session snapshots; the active working set and named presets persist locally.
- Call `options.dispose()` on teardown. It cancels pending rebuilds, disconnects observers/subscriptions, and flushes owned persistence. Page hide also flushes pending saves.

All 69 schema fields are present once in groups, with 14 additional Quick Tune views sharing the same values. Sliders follow schema steps (discrete physics rates use index positions); typed numeric values retain precision within bounds. Logarithmic mapping applies to positive ranges over 20× and the explicitly recommended mass control. Edited markers compare against the selected preset, so autosave does not clear them.

The browser tests compile `tests/options/index.html` with Vite and serve its built JS/CSS. This isolated consumer exercises the same exported component without touching boot or shipping its test driver. `e2e/options.spec.ts` covers controls, native focus behavior, A/B, persistence, import/export/share, 100 ms rebuilds, plot telemetry gating, and narrow viewports.
