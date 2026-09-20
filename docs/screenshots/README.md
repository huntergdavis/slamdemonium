# Screenshots

Every image in this folder is generated, not hand-captured. Regenerate them all with one command after any visual change, and the docs stay in step with the game.

```sh
npm run shots
```

That builds the production bundle, serves it locally, boots headless Chromium, and captures each shot in the list below into this folder with a fixed filename. It takes about a minute. It fails if the page logs a console error.

## Conventions

| Convention | Value |
|---|---|
| Viewport | 1280 x 720, device scale factor 1, PNG |
| Browser | Headless Chromium via Playwright, software WebGL |
| Build | Production bundle (`npm run build`), no test fixture |
| Preset | Applied through `window.__game.tuning.applyPreset` per shot; stated in the table |
| Scenario | Set up through the test surface (`respawn`, `stepMany`, `setInput`); the script waits for a deterministic state, never a timer |
| Filenames | `<area>-<what>.png`, lowercase, hyphens. Stable: a renamed file breaks the doc that embeds it |
| Where the list lives | `shots/shotlist.ts` is the source of truth; this table mirrors it |

Two consecutive runs of the same commit produce byte-identical PNGs for the live shots. If a regenerated image differs from the committed one, the game changed. Look at the diff, decide whether the docs still say the right thing, and commit the new image alongside.

## Shot list

| File | Shows | Preset | Status |
|---|---|---|---|
| `scene-boot.png` | The WP1 proof scene: orange chassis box at rest on the grey pad, thin CCD test wall behind it. | Default | live |
| `lab-overview.png` | The lab from the chase camera: car on the painted ring, posts, fog, full HUD. The README hero image. | Default | pending: ring (WP3) and a camera preset hook (WP6) |
| `drift-hold.png` | Car held mid-drift with skid marks, slide angle gauge out, drift meter charging. | Drifty | pending: vehicle model (WP5), skid marks (WP6), scripted input |
| `options-quick-tune.png` | Options page open over the running game, Quick Tune at the top. | Default | pending: options panel (WP7) and a hook to open it |
| `tire-curve-plot.png` | Live tire-curve plot with front and rear operating dots. | Drifty | pending: tire-curve plot (WP7) |
| `hud-full.png` | Full HUD at speed: speedometer, slide angle gauge, G-G diagram, per-wheel bars, graphs. | Default | pending: HUD (WP8) and a hook to set HUD mode |

Pending shots are skipped by the script and listed in its output until their scenario is wired.

## Adding a shot

1. Add an entry to `shots/shotlist.ts`: filename, one sentence on what it shows, preset, scenario, status.
2. If the scenario is new, add a case to `runScenario` in `shots/shots.spec.ts`. Drive the game only through `window.__game`; wait on telemetry or a rendered frame, not on `setTimeout`. If you need a hook that is not on `window.__game`, ask developer 1 for it rather than adding one.
3. Add a row to the table above.
4. Run `npm run shots`, look at the PNG, commit the image with the code.

## Regenerating for a doc change

Screenshots are the game's output, so a doc PR that only changes prose never touches them. When a visual change lands (materials, HUD layout, camera), regenerate on that branch and commit the updated PNGs in the same PR, so the image and the code that produced it move together.
