# Screenshots

Every image in this folder is generated, not hand-captured. Regenerate them all with one command after any visual change, and the docs stay in step with the game.

```sh
npm run shots
```

That builds the production bundle, serves it locally, boots headless Chromium, and captures each shot in the list below into this folder with a fixed filename. It takes about ten minutes, most of it software-rendered frames. It fails if the page logs a console error.

While iterating on a shot, skip the rebuild: run `npm run preview -- --port 4179 --strictPort` in another terminal, then `SHOTS_REUSE=1 npx playwright test --config playwright.shots.config.ts --grep <file>`.

## Conventions

| Convention | Value |
|---|---|
| Viewport | 1280 x 720 CSS px by default; the full-HUD and tire-curve shots use 1280 x 1000 so nothing is cut off |
| Device scale factor | 1.5, so PNGs are 1920 px wide. Dynamic resolution floors the 3D view at 0.6 under software WebGL, and 1.5 x 0.6 keeps it sharp |
| Browser | Headless Chromium via Playwright, software WebGL |
| Build | Production bundle (`npm run build`), no test fixture |
| Preset | Applied through `window.__game.tuning.applyPreset` per shot. A replay shot takes its parameters from the script header instead |
| Simulation | Paused through `window.__game.perf.pauseSimulation(true)` before anything else, so the only physics that runs is `stepMany`. Scenario, camera, HUD and panel are set in one synchronous call so no animation frame can slip in between |
| Waits | Animation frames and DOM state, never a timer |
| Filenames | `<area>-<what>.png`, lowercase, hyphens. Stable: a renamed file breaks the doc that embeds it |
| Where the list lives | `shots/shotlist.ts` is the source of truth; the table below mirrors it |

**The frame counter is not representative.** Captures come from a headless, software-rendered harness that runs at about one frame per second, so the FPS and frame-time readout in any HUD shot describes the capture machine, not the game. That is why the README hero is the HUD-off frame.

**What is and is not stable.** Car, track, camera and panel are byte-stable for a given build. Two readouts are not, because they measure the capture machine rather than the game: the FPS and frame-time text in the HUD status bar (headless software rendering runs at about one frame per second, so it reads `1 FPS`), and the `Render x0.60` scale. The scrolling HUD graphs sample on real frames, so after a `stepMany` they show a flat line. Treat differences in those areas as noise; treat any other difference as a change in the game.

## Shot list

| File | Shows | Preset | Scenario | Hooks used | Status |
|---|---|---|---|---|---|
| `lab-overview.png` | Car at speed on the painted ring from the chase camera, posts and fog, minimal HUD. | Default | Respawn, throttle 1 and steer 0.11 for 540 steps (4.5 s): 46 m/s on the 130 m centre line | `respawn`, `setInput`, `stepMany`, `setCameraPreset('chase')`, `setHudMode('minimal')` | live |
| `lab-overview-clean.png` | Same moment with the HUD off. **The README hero**, because the HUD frame counter would mislead. | Default | as above | as above with `setHudMode('off')` | live |
| `options-quick-tune.png` | Options page open over the running game, Quick Tune at the top. | Default | as above | as above plus `setOptionsOpen(true)` | live |
| `hud-full.png` | Full HUD: speed, G-G diagram, per-wheel grip and load, pedals, slide gauge, graphs. 1280 x 1000. | Default | as above | as above with `setHudMode('full')` | live |
| `drift-hold.png` | Car mid-slide after a handbrake turn, slide angle 37 degrees, drift meter charging. 1280 x 1000. | Default (from the script header) | `scripts.load(handbrake-turn.json, {tuning: 'apply'})`, then `stepMany(372)` | `scripts.load`, `perf.pauseSimulation`, `stepMany`, `setCameraPreset('chase')`, `setHudMode('full')` | live |
| `tire-curve-plot.png` | The live tire-curve plot in the Tires group with front and rear operating dots. 1280 x 1000. | Drifty | as the hero | as the hero plus `setOptionsOpen(true)`, then clicks the Quick Tune summary shut and scrolls `.sl-graph--tire` to centre | live |
| `scene-boot.png` | Historical: the empty proof scene before the track and car existed. Not embedded anywhere. | Default | retired | none | frozen |

## Adding a shot

1. Add an entry to `shots/shotlist.ts`: filename, one sentence on what it shows, preset, scenario, camera, HUD mode, whether the panel is open, and viewport if it needs the tall one.
2. If the scenario is new, add a case to `runScenario` in `shots/shots.spec.ts`. Drive the game only through `window.__game`; wait on frames or DOM state, not on `setTimeout`. If you need a hook that is not on `window.__game`, ask developer 1 for it rather than adding one.
3. Add a row to the table above, including the hooks it uses.
4. Run `npm run shots`, look at the PNG, commit the image with the code.

## Regenerating for a doc change

Screenshots are the game's output, so a doc PR that only changes prose never touches them. When a visual change lands (materials, HUD layout, camera, panel), regenerate on that branch and commit the updated PNGs in the same PR, so the image and the code that produced it move together.
