# Visual direction: driving-feel laboratory

Owner: designer. Implementation handoff for WP3, WP6, WP7 and WP8.
Source: [vertical-slice design](../vertical-slice-design.md), especially sections 1, 8, 9, 10 and 12. That brief owns behavior, physics, parameter names and defaults. Dimensions and colors below are proposed rendering defaults, not new tuning parameters. Use `GAME_NAME` wherever the product title appears in UI.

The visual goal is a fast, legible test drive: one saturated orange box, dark textured pavement, bright repeated distance markers and a quiet instrument panel. The player must read heading, sliding, braking and suspension before reading a number. Keep the road ahead and the car unobstructed. Build with boxes, instanced markings, a procedural asphalt map and DOM/canvas instruments; no authored car model, external font, bloom or post-processing dependency.

## 1. Palette and material tokens

All hex values are sRGB display colors. Treat color textures as sRGB; data textures are linear. Use the renderer/color configuration from design 10.6. Check scene colors through its lighting and tone mapping; DOM colors are not tone mapped.

| Token | Hex | Application |
|---|---|---|
| `asphaltBase` | `#45494D` | Average asphalt texel; D2 adds restrained grain and broad blotches |
| `rubber` | `#171B20` | Wheels and skid marks |
| `body` | `#FF6B24` | Opaque saturated orange chassis |
| `nose` | `#FFF4B3` | Bright front chevron; also heading gizmo |
| `wheelWitness` | `#ABB7C0` | One narrow radial stripe on each outer wheel face |
| `paintWhite` | `#F2F4EC` | Edge lines, center dashes, skidpad circles, white curbs/posts |
| `curbRed` | `#CE3545` | Alternating curb blocks |
| `tailIdle` | `#9F2838` | Rear strip, brake released |
| `tailBrake` | `#FF6570` | Rear strip, full brake/handbrake |
| `postCyan` | `#3ED8EE` | Alternating roadside posts; velocity gizmo |
| `fogSky` | `#B8C7CC` | Matching background and exponential fog |
| `outsideGround` | `#6D7779` | Ground beyond paved disc |
| `panel` | `#121A23` | HUD cards and Options backing |
| `control` | `#253341` | Inputs, unfilled bars and button backing |
| `border` | `#516170` | Input outlines and graph grid |
| `text` | `#F2F6F8` | Main UI text |
| `mutedText` | `#ACBBC7` | Units and secondary labels |
| `accent` | `#6FE4FF` | Focus, active A/B slot, boost, front axle graph |
| `drift` | `#E1A6FF` | Drift activity and rear axle graph |
| `warning` | `#FFD166` | Pending mass update and edited-value marker |
| `overLimit` | `#FF7785` | Grip usage above 1.0, invalid input, recording indicator |

Use `panel` at 94% opacity for Options and 90% for HUD cards; give editable controls opaque `control` backgrounds. Avoid backdrop blur. Labels remain readable over the white sky and track paint. Pair every state color with text, a symbol or line style: `A ACTIVE`, `CHARGING`, `REC`, `!`, front solid/rear dashed. Do not use orange body color for body-sized UI blocks.

## 2. Box car: read the physics

Coordinate system: +X right, +Y up, -Z forward. Render one chassis box with **X = 1.8 m, Y = 1.0 m, Z = 4.0 m**. Its transform follows the interpolated physics chassis, without additional visual steering/yaw smoothing. Body material: `body`, roughness 0.72, metalness 0.0.

| Element | Geometry and behavior |
|---|---|
| Front chevron | Two flat strips on the top face, at local Y = 0.503 m; each 0.16 m wide. Segment endpoints in (X,Z): (-0.62,-0.85) to (0,-1.72), and (0,-1.72) to (+0.62,-0.85). The tip points toward -Z. Use `nose`, unlit. |
| Nose continuation | Centered 0.26 m wide stripe on the front face, Z = -2.003 m, extending from local Y = -0.25 to +0.5 m. This keeps the front distinct in hood/far views. |
| Rear light strip | Rear face at Z = +2.003 m, centered X = 0, Y = +0.08 m; width 1.44 m, height 0.14 m. Unlit color interpolates `tailIdle` to `tailBrake` with max(filtered brake, handbrake). No bloom needed. Use braking telemetry when available so reverse throttle alone does not illuminate brakes. |
| Wheel boxes | Four separate meshes, full size X = 0.24 m, Y = 0.68 m, Z = 0.68 m, `rubber`. Mount X/Z from design 6.2: ±0.8/±1.3 m. Vertical centers come from suspension/raycast wheel state, not the chassis mount Y. |
| Wheel witness stripes | One 0.05 m wide `wheelWitness` radial stripe on each outside face. It makes wheel spin/lock visible; do not texture the entire wheel white. |
| Wheel animation | Front steer pivots follow `delta` with the physics sign; child meshes spin about their local axle from wheel state. Suspension moves each steer pivot vertically. Rear wheels do not steer. Honor `spinning`/`locked` states, including stopping spin on a locked wheel. |

Top view (schematic, not to scale):

```text
                       -Z / FORWARD
                          ^
                   +------|------+
              FL []|     / \     |[] FR
                   |    /   \    |   bright nose chevron
                   |             |
                   | orange body |
              RL []|             |[] RR
                   +=============+   red rear strip
                           +Z
```

`G` toggles ground-plane gizmos: heading arrow `nose` with `H` label; velocity arrow `postCyan` with `V` label; four force vectors at tire contact points. Use an arrowhead and a tail dot so direction is unambiguous. Hide velocity direction near zero speed rather than normalizing zero. The ground arrows must remain distinct from white paint. Skid strips use `rubber`, start around 0.55 opacity, and fade over 20 s as in design 10.4; their width follows the 0.24 m tire width.

## 3. Track paint, curbs and posts

Keep the full 150 m radius disc paved, including the infield. Ring edges are **110 m / 150 m**, center line **130 m**. Free driving across the inner edge stays possible. Markings, curbs and posts are visual only; barrier collisions remain at radius 152–154 m per the brief.

Measure all spacings along the relevant circular arc, in meters. For a circle of radius R, place an item at arc distance s using theta = s/R, X = R*cos(theta), Z = -R*sin(theta), Y as below. This puts theta = 0 at +X and follows the counter-clockwise spawn direction toward -Z. Orient tangent objects with that curve. Generate the ring data once; instance repeated geometry.

| Feature | Placement and dimensions |
|---|---|
| Solid edge lines | `paintWhite`, 0.18 m radial width, centered at r = 110 and 150 m; continuous circles. |
| Dashed center line | `paintWhite`, 0.16 m radial width at r = 130 m; **3 m paint, 6 m gap**. Starts at arc distances 0, 9, 18, …; use floor(2*pi*130/9) full repeats and leave the remainder unpainted at the join. All dashes stay 3 m and ordinary gaps 6 m; the single join gap absorbs the non-integer circumference. |
| Radial ticks | **Every 10 degrees**, 36 per edge. `paintWhite`, 0.16 m tangential width by 1.2 m radial length. Point into the ring: r = 110.15–111.35 and 148.65–149.85 m. Maintain a small gap from the edge line. |
| Inner curbs | Alternating `curbRed`/`paintWhite` boxes, 2 m arc length, 0.60 m radial width, 0.06 m high, spanning r = 109.30–109.90 m. |
| Outer curbs | Same, spanning r = 150.10–150.70 m. Clip the final arc segment at the join rather than overlapping boxes. |
| Roadside posts | Two rows, at r = 108 and 151 m. Boxes 0.16 m square, 1.2 m high. Centers every **12 m of arc** from s = 0; alternate `postCyan` and `paintWhite` by index independently on each row. The final wrap gap is the remaining circumference; do not stretch every ordinary spacing. |
| Skidpad circles | r = 15 and 30 m, 0.12 m white lines. Lower opacity to 0.55 so they remain subordinate to ring edges. |
| Barrier | Preserve 128 segments, 2 m thickness and 1 m height from design 9.1. Neutral `outsideGround`; no additional warning stripes competing with posts. |

Raise paint to Y = 0.005 m above pavement or use a consistent depth bias. Paint should not flicker at chase-camera angles. Curbs are flat-topped visual cues, not additional suspension impulses. Use the same asphalt UV scale across ring and infield: **8 m per 1024 px tile** initially (128 texels/m). D2 supplies a seamless albedo texture; the material stays white so it does not multiply-darken the texture. Start at roughness 0.95 and metalness 0.0. Enable mipmaps, repeat wrapping, and maximum supported anisotropy. Do not enlarge grain to imitate painted road grit.

## 4. Fog, light and camera mood

Use cool, hazy daylight with readable tire contact and shadows. No night scene or dramatic sun glare; the laboratory must reveal slides and weight transfer.

| Setting | Proposed starting value |
|---|---|
| Background and exponential-squared fog | `fogSky`; density 0.0025 per meter. Visibility is approximately 94% at 100 m and 68% at 250 m; nearby posts remain crisp. |
| Hemisphere light | Sky `#E5F1F5`, ground `#73716A`, intensity 1.2 |
| Directional light | `#FFF1DA`, intensity 2.2; position at car + (60, 100, 40) m, target at car |
| Shadows | One 2048 px map following the car; initial orthographic coverage ±35 m and far plane 200 m. Car/wheels cast; pavement receives. Tune bias to avoid acne without floating tires. |
| Renderer | MSAA, sRGB output, ACES tone mapping, exposure 1.0 initially; pixel ratio capped at 2, dynamic scale floor 0.6 as in design 10.6 |

Preserve the section 10.1 camera defaults and formula, including velocity blend 0.5, speed FOV and boost kick. Do not replace them with an art-directed fixed camera. Camera shake follows `camShake`; zero must remove it. Required grain, dashes, ticks, posts, fog and camera response come before optional speed streaks, vignette or smoke. Optional effects must leave the center and instruments clear.

## 5. HUD layout (design section 12)

Full HUD is the default. `H` cycles **Full → Minimal → Off → Full**. Desktop reference is 1440×900 CSS px with 16 px safe margins and 12 px gaps. Use system sans-serif for labels (14 px) and a system monospace stack with tabular numerals for readings (13 px minimum). Use DOM text; graphs are canvas. The car and the central road corridor stay clear.

```text
+--------------------------------------------------------------------------+
| [GAME_NAME / FEEL LAB]                              [O Options / gear]    |
| [60 FPS | 0.42 ms/step | 2 steps | 1.00x | Default | A ACTIVE]            |
| [F9 REC 00:12 •]                                        [G gizmos ON]    |
|                                                                          |
|   G-G [180 x 180]                               WHEEL USAGE / LOAD         |
|       +a_long ^                                FL ====|== 0.82  4.8 kN    |
|          •    |                                FR ====|!! 1.08  3.9 kN    |
|    -----------+----> +a_lat                     RL === |   0.66  4.7 kN    |
|         mu*g_eff ring                          RR ====|   0.90  4.0 kN    |
|                                                                          |
|                        CLEAR DRIVING CORRIDOR                            |
|                           [ CAR / ROAD ]                                 |
|                                                                          |
| STEER   -32° ---^--- +32°      SLIDE +18°                  198 km/h        |
| T ========  B __  HB __        -90 --|--0--|--^-- +90       55.0 m/s       |
|                               drift thresholds ±12°     BOOST ===== 62%  |
|                                                         DRIFT • CHARGING |
| [ 10 s scrolling plots: speed | beta | yaw | lateral G | front/rear slip ] |
+--------------------------------------------------------------------------+
```

These values are layout examples, not expected simultaneous telemetry. Size the left G-G card to 204×232 px, wheel card to 260×168 px, input card to 244×108 px, slide card to 300×76 px and speed/meter card to 228×128 px. Speed type is 48 px with a separate 14 px unit. A graph shelf at the bottom is 132 px tall; other bottom cards sit 12 px above it in Full mode. The slide card is centered in available driving space, not behind Options.

| Instrument | Contract |
|---|---|
| Speed | Magnitude in km/h, rounded integer; smaller m/s to one decimal. Do not display reverse as negative speed; an `R` badge can use signed `v_long`. |
| Slide | Horizontal -90°…+90° gauge with centered zero and ticks at **both ±driftMinAngle**. Signed beta marker and text. Clip the marker at the visible limits, keep the true number visible. Use `drift` only when charging conditions in 6.9 are met. |
| G-G | X = lateral acceleration (right positive), Y = longitudinal acceleration (forward/up positive). Plot m/s² and label axes. Draw the section 12 reference circle at `mu * g_eff`, labeling the chosen reference mu (initially min(gripFront, gripRear) * surfaceGrip). This is a nominal reference, not the instantaneous per-wheel envelope; do not present it as including load sensitivity/downforce. |
| Wheel bars | Fixed FL/FR/RL/RR labels and order; 0–1.5 display scale, a visible threshold line at 1.0, numeric usage and Fz in kN. Past 1.0 use `overLimit` plus `!`; clip fill, not numeric readout. Airborne/zero-load wheels say `AIR`, with usage `—` instead of dividing by zero. Add `LOCK`/`SPIN` text flags. |
| Inputs | Steering indicator with signed angle and current lock limits. Throttle, brake and handbrake bars at 0–100%, labeled T/B/HB. |
| Boost/drift | Boost capacity meter and numeric percentage; separate drift meter/activity indicator. If physics exposes one shared charge value, both views read that value—UI must not invent a second stored resource. Charging pip flashes gently; a steady `CHARGING` label carries the same meaning. |
| Status | FPS, physics ms/step, steps/frame, timeScale, active preset (add `modified` when changed), and active A/B slot. Never hide timeScale changes in Full/Minimal mode. |
| Scrolling graphs | Shared 10 s time window. Five small panes: speed (m/s), beta (deg), yaw rate (deg/s), lateral acceleration (Earth G = m/s² / 9.81), front and rear slip angle together (deg). Front solid cyan, rear dashed violet; labels remain present. Use signed axes and separate scales; no unrelated values sharing an unlabeled Y axis. |
| Recording | F9 toggles physics-rate recording. Visible `REC` plus elapsed time while active; stop downloads CSV with the complete telemetry and parameter header from design 12.2. Off mode still shows a compact recording indicator while recording. |

HUD text/plots update at up to 30 Hz from current telemetry; CSV samples at physics rate independently. Keep graph buffers bounded and reuse drawing objects. `G` is independent of `H`. Minimal mode keeps speed, boost/drift, slide angle, preset/A/B, timeScale and recording status; removes G-G, wheel/input bars and the graph shelf. Off removes instruments except recording feedback and the gear affordance.

With Options open, define available driving width as viewport minus panel width minus 12 px; right-anchored HUD cards shift into that area. At narrow desktop widths below 1100 px, Full HUD uses a two-column compact instrument dock and a scrollable graph shelf, keeping every instrument available; do not silently change the H mode. At heights below 700 px, the instrument dock may scroll. Provide a toggle to collapse the dock while driving. Keep DOM text at CSS resolution even when world render scale drops.

## 6. Options layout and interaction (design section 8)

Right drawer: **380 px wide**, max-width 100vw, full viewport height; 12 px internal padding and 8 px control gaps. Open with `O`, gear button or gamepad Start. Short 140 ms slide transition; honor reduced-motion preferences. The simulation keeps running by default. A visible **Pause while open** checkbox is off initially; reflect simulation pause without writing over the timeScale slider.

```text
+-----------------------------------------------+
| OPTIONS                              [Close O] |  fixed header
| [ ] Pause while open                           |
| Preset [Default v] [Save as…]                   |
| [A ACTIVE] [B] [Copy A → B]    Tab: swap A/B     |
| [Search label or key_________________________] |
+-----------------------------------------------+
| v QUICK TUNE (14)                              |  pinned top region
| Gravity          m/s²   [20] [reset] [?]      |  internally scrolls
| [----------o---------------------]             |  all 14 quick controls
| ...                                           |
+-----------------------------------------------+
| [Collapse all]                                 |  main scroll region
| > World                         [Reset group]  |
| > Chassis                       [Reset group]  |
| > Engine                        [Reset group]  |
| > Brakes                        [Reset group]  |
| v Tires                         [Reset group]  |
|   g(x) / grip usage                            |
|   1.0 |    /\__     front solid / rear dashed  |
|       |   /    ----•-------- slide ratio       |
|   0.0 +-----------------------> slip angle °   |
|   Front grip     mu     [1.50] [reset] [?]      |
|   [-------------o------------------]           |
|   Rear grip *    mu     [1.25] [reset] [?]      |
|   [----------o---------------------]           |
| > Steering                      [Reset group]  |
| > Suspension                    [Reset group]  |
| > Boost & Drift                 [Reset group]  |
| > Collision                     [Reset group]  |
| > Camera                        [Reset group]  |
| > Tuning playbook                              |
| > Change log                                   |
+-----------------------------------------------+
| [Export JSON] [Import JSON] [Share link]        |  fixed footer
| Saved locally                  [Reset everything]|
+-----------------------------------------------+
```

The drawing is schematic; implement responsive rows within the 356 px content width. Keep header/footer fixed. Bound Quick Tune to min(240 px, 28vh) with its own scroll area so 14 controls cannot push group controls off screen; its heading stays pinned. Collapsing Quick Tune frees that space. The main group region uses the remaining height with `min-height: 0` and vertical scrolling. On short windows below 600 px high, use one scroll region with the Quick Tune section first and its heading sticky.

Each control occupies two rows, about 64 px total: row 1 label + unit + numeric input (70 px) + reset + help; row 2 full-width slider. Labels can wrap without overlapping the numeric field. Buttons have at least 28×28 px hit areas, controls at least 32 px height; visible 2 px `accent` focus outlines. Do not put essential help behind hover alone: `?` opens the same text on click/focus.

**Generate controls from the schema.** Quick Tune references the same 14 keys as design 7.2; group copies update together. Group ordering is World, Chassis, Engine, Brakes, Tires, Steering, Suspension, Boost & Drift, Collision, Camera. Advanced controls are collapsed initially inside their group and appear when search matches them. Search is case-insensitive over label/key, filters Quick Tune and groups, expands matching groups, and displays a clear `No matching controls` state. Numeric fields keep unit labels outside the value. Sliders follow schema ranges/discrete steps; retain typed precision subject to range clamping. Apply the suggested logarithmic control mapping to timeScale, tireRelaxationLength and mass while preserving numeric values and schema defaults.

**Live feedback.** Every slider input writes immediately; numeric edits apply valid numbers and show an inline error for incomplete/invalid input without pushing NaN into physics. Use `*` plus a label/tooltip for changes from the active preset, not from a save timestamp. Individual reset means schema default; Reset group restores that group's defaults. Mass-property controls have a small `rebuild` badge; while their debounced 100 ms update is pending, show `Applying…`, then clear it. Never imply that a rebuild respawns the car.

**Tire plot.** Put a 332×144 CSS px canvas at the top of Tires, scaled for pixel ratio. X is absolute slip angle in degrees, with a labeled peakSlipAngle marker; Y is normalized `g(x)`/grip usage. Draw front solid cyan and rear dashed violet. The shared normalized tire-shape parameters mean the curves can overlap; draw both styles and retain the legend, rather than inventing different curves from gripFront/gripRear. Draw current axle operating dots at the average absolute grounded-wheel slip and average valid grip usage; label F/R, and omit airborne axles. Redraw curves on parameter change and dots at ≤30 Hz.

### Interpretations

PM-approved (2026-09-20): Tab swaps A/B when the game has focus, and the game layer must call preventDefault for that Tab event. Inside Options, Tab navigates controls normally; explicit A/B swap buttons remain available.

**Focus and driving.** Pointer release on a slider returns focus to the driving surface as required by 8.1; keyboard-initiated slider interaction retains focus for editing. Text/number/search inputs consume typing and do not drive the car. When focus is on the driving surface, Tab swaps A/B and prevents browser focus movement. Inside the Options controls, Tab follows the normal focus order and explicit A/B buttons perform the same swap. This scoped shortcut implements sections 8.1 and 8.5 together; the driving shortcut must still work. O closes from the driving surface; close button/Escape dismiss the drawer while editing. Clear held driving inputs when entering text edit or losing window focus so a released throttle cannot stick.

### Persistence and comparisons

 Save as prompts for a preset name. Export includes version, name, full values and timestamped change log; Import reports ignored unknown keys and clamps through store validation. Share link copies the URL with changed-from-default values. Show `Saving…`/`Saved locally` around debounced auto-save and a truthful error if storage is unavailable. Reset everything returns to schema defaults and resets the saved working set; do not delete user-named presets incidentally. A/B buttons always identify the active slot with text, not just fill color; Copy A → B does exactly that direction. Change log shows timestamp, key, old and new values. Ship the section 7.4 playbook as collapsible help, sourced from the canonical tuning playbook.

## 7. Visual acceptance pass

1. At rest, at speed and in a slide, the front chevron and rear strip make the car's heading clear; brake state, wheel steering/spin and suspension motion remain visible from chase view.
2. At 60 m/s, ordinary center dashes pass every 0.15 s and posts every 0.20 s along their own reference arcs. Inspect repetition/markings at grazing angles: no shimmering seams, z-fighting or missing mipmaps. Verify 36 ticks on each edge and an unobstructed paved infield.
3. At 1440×900 and 1024×768, open Options while driving; reach all 69 controls, all 14 Quick Tune entries, presets, A/B, tire plot, help and persistence actions. Numeric focus, slider release and scoped Tab behavior must match the handoff.
4. Exercise Full/Minimal/Off, zero-load wheels, zero speed, excessive grip usage, altered timeScale, modified presets and F9 recording. Show truthful labels/units without NaNs, misleading color-only states or panel collisions.
5. With effects at minimum, required distance cues still carry speed. With world render scale at 0.6, DOM instrument text remains sharp. Review daylight scene colors and UI contrast in the actual renderer before treating the hex swatches as final.
