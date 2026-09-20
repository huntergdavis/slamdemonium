# UI kit (D3): direct handoff to WP7 and WP8

Import **[src/ui/ui.css](../../../src/ui/ui.css)** once from the application entry or UI module. Put UI descendants under a **.sl-ui** ancestor. The stylesheet does not import fonts, frameworks, images or other CSS, reset the host body/canvas, or use backdrop blur. The plain DOM controls work with the existing schema/store; this PR does not mount an application UI or replace developer 2's controller.

Open [index.html](index.html) directly from disk for the component review page. It links the production stylesheet. Its separate [demo.js](demo.js) supplies sample values, search, field editing, A/B examples and optional fake telemetry. Save/import/export buttons are deliberately disabled because the real persistence operations belong to WP7. Preset selection previews the dropdown only. Do not import demo.js into the game.

Source contracts: [D1 visual direction](../visual-direction.md), design sections [8](../../vertical-slice-design.md#8-options-page-tuning-ui) and [12](../../vertical-slice-design.md#12-hud-and-telemetry). D1's PM-approved focus rule is preserved: Tab swaps A/B and prevents default when the game has focus; inside Options it follows the ordinary browser focus order.

Class names and custom properties below are the published, stable contract for WP7/WP8 (PM ruling, 2026-09-20). Consumers adapt their markup to these names.

## Tokens and scope

Every palette color from D1 is a custom property on .sl-ui. UI colors are --sl-panel, --sl-control, --sl-border, --sl-text, --sl-muted, --sl-accent, --sl-drift, --sl-warning and --sl-over-limit. World reference swatches are included as --sl-asphalt, --sl-body, --sl-nose, --sl-rubber and the remaining named scene colors at the top of the file. All color values are sRGB.

--sl-panel-surface is 94% opaque; --sl-hud-surface is 90% opaque. Actual controls use opaque --sl-control. --sl-border is decorative; **--sl-control-border uses --sl-muted** so actionable outlines meet contrast requirements. Focus is a 2 px accent outline with 3 px offset. --sl-panel-width defaults to 380px, --sl-safe to 16px and --sl-gap to 12px. Override these on the .sl-ui ancestor if needed. The final .sl-kit* stylesheet rules only arrange this review page.

## Options components

| Class / attribute | Contract |
|---|---|
| .sl-options | Fixed right drawer, full dynamic viewport height, 380 px maximum width; header and footer stay visible. |
| data-open="true" | Opens the drawer with a 140 ms slide. Controller also synchronizes inert, aria-hidden and opener aria-expanded. Closed controls must not receive focus. |
| .sl-options__header / __body / __footer | Header/footer do not shrink. Body owns the scroll regions. |
| .sl-options__quick | Native details element; heading sticky, bounded to min(240px, 28vh), independently scrollable. At heights ≤600 px, the body becomes one scroll region. |
| .sl-options__groups | Remaining vertical space, scrollable; min-height:0 prevents footer overflow. |
| .sl-group / .sl-group__body / .sl-group__actions | Native details/summary sections with controls and a Reset group action. Keep buttons out of summary so their interactions stay independent. |
| .sl-field | Four columns: wrapping label, 70 px number, reset, help. The range occupies the second full-width row. data-key maps to a schema key. |
| .sl-field__label / __unit / __number / __range / __reset / __help | Use real label, number/range inputs and buttons. Numeric input uses step="any" to preserve typed precision; the range uses the schema step or discrete-index mapping. |
| data-edited="true" + .sl-field__edited | Shows the warning-colored * marker. Compare to the active preset baseline, not the last autosave. Include an accessible text label. |
| .sl-tooltip | Descriptive help associated with the trigger via aria-describedby and aria-controls. Toggle hidden and aria-expanded. It expands inline across the row, avoiding clipping by the drawer's scroll region; hover, focus and click all expose the same text. Escape dismisses it. |
| .sl-field__error + aria-invalid="true" | Inline error and pink input outline. Keep invalid/incomplete text out of the store; associate the message using aria-describedby. |
| .sl-input / .sl-select / .sl-button / .sl-button--icon | Search, preset dropdown, general and 32 px icon buttons. Use actual disabled attributes. |
| .sl-slot[aria-pressed="true"] | Active A/B state; update button text to A ACTIVE/B ACTIVE as well as the attribute. |
| .sl-badge[data-state] | edited/pending → warning, error/recording → pink, charging → violet; default → accent. Always include a word/symbol, not color alone. |

Copy the semantic markup from the demo. Generate all 69 controls and 14 Quick Tune entries from the schema in production. IDs must be unique: if a parameter appears in Quick Tune and its group, prefix each occurrence's range/number/help IDs and bind both rows to the same store key. The demo only shows representative fields and all group types.

For pointer slider release, return focus to the game; keyboard editing retains focus. Text/number/search inputs must suppress driving input. Help, inline errors and search should not rebuild the row. Native details handles accessible group expansion. Treat the drawer as a nonmodal region: no backdrop or focus trap; changing settings while driving is intentional. Respect the existing pause state separately from timeScale.

## HUD components and live updates

| Class / property | Contract |
|---|---|
| .sl-card / .sl-card__title | Reusable translucent instrument backing; use semantic section headings outside visual-only graphs. |
| .sl-speed__value / __unit / __secondary | 48 px speed, km/h unit, smaller m/s. Update the existing text nodes. |
| .sl-status | Wrapping monospace block for FPS, physics time, steps/frame, timeScale, preset and A/B. |
| .sl-meter / .sl-meter__label / __track / __fill / __value | Shared boost, drift, wheel and input bar. Set **--sl-fill to a unitless 0…1** on .sl-meter; the fill uses transform:scaleX, clamped for presentation. Text retains the true value. |
| .sl-meter--drift / --brake / --handbrake | Violet, pink and amber variants. Normal boost/throttle uses accent. |
| .sl-meter[data-state="over"] | Pink fill and number; append ! or OVER in text. Wheel scale is 0…1.5, so fill = usage/1.5. |
| .sl-meter__threshold | Fixed 1.0 wheel threshold, at 66.6667% of that scale. |
| .sl-meter[data-state="air"] / .sl-wheel__meta | Empty bar plus AIR and normal-load text. Use role=group for an unavailable reading, not a meter with a fabricated zero-grip measurement. |
| .sl-gauge / .sl-gauge__marker | Slide or steering bar. Set **--sl-position to a percentage**. Beta position = (betaDegrees+90)/180*100%; preserve signed numeric text. |
| --sl-threshold-low / --sl-threshold-high | Percent positions of ±driftMinAngle. Defaults 43.3333% / 56.6667% represent ±12° on -90…+90. |
| .sl-graph / .sl-graph__canvas / .sl-graph__legend | Responsive canvas wrapper with a textual accessible description. Standard canvas is 112 CSS px high; --tire is 144 px, --gg square. Size the backing buffer for pixel ratio separately. |
| .sl-legend-key / .sl-legend-key--rear | Front solid cyan, rear dashed violet; retain labels even when curves overlap. |
| .sl-graph-shelf | Five panes with horizontal scrolling at constrained widths. Keep per-pane units/scales and a shared 10 s window. |

Use role=meter with aria-valuemin/max/now and a readable label for valid measurements. Update aria-valuenow with the visible number. For over-range values, clamp aria-valuenow to the meter's semantic bounds and put the true reading in aria-valuetext and the visible text. Use signed aria-valuetext for angles. Do not put the live HUD in an aria-live region; 30 Hz announcements would overwhelm assistive technology. Reserve polite live announcements for discrete actions such as recording, saved/imported settings and errors.

The optional .sl-hud overlay positions .sl-hud__status, __gg, __wheels, __bottom and __graphs. Put the input, slide and speed cards inside __bottom. Mark removable detailed instruments with data-hud-detail="full"; data-mode="minimal" hides those, data-mode="off" hides direct children except data-hud-persistent (for a recording indicator). Persistent feedback must be a direct child. Set data-options-open="true" on .sl-ui to reserve drawer width. Below 1100 px or 700 px high the overlay becomes a scrollable dock; below 700 px wide an open drawer hides it until closure. These are layout styles; H cycling and recording remain WP8 behavior.

Cache nodes once, throttle **reads as well as writes** to at most 30 Hz, and mutate in place:

```ts
const speedText = speedElement.firstChild!; // Existing text node.
let lastHudMs = -Infinity;
function updateHud(nowMs: number) {
  if (nowMs - lastHudMs < 1000 / 30) return;
  lastHudMs = nowMs;
  const telemetry = readTelemetry(); // The rate gate precedes the read.
  speedText.nodeValue = String(Math.round(telemetry.speed * 3.6));
  boostMeter.style.setProperty('--sl-fill', String(telemetry.boostMeter));
  boostMeter.setAttribute('aria-valuenow', String(telemetry.boostMeter * 100));
}
```

Do not use innerHTML or replaceChildren on updates. Sliders write to the store on every input event; throttling telemetry does not throttle tuning inputs. The review page's optional animation uses the same gate, cached text nodes and meter elements. CSV recording remains independent at physics rate.

## Contrast and verification

Ratios below use relative sRGB luminance. Translucent surfaces are composited over pure white before measurement, the worst bright scene case for these light colors. Every text/state color clears 4.5:1; no opacity is applied to text.

| Foreground | Opaque controls | Options over white | HUD over white |
|---|---:|---:|---:|
| Text | 11.86 | 13.74 | 12.12 |
| Muted / units | 6.56 | 7.61 | 6.70 |
| Accent / active | 8.73 | 10.12 | 8.92 |
| Drift / charging | 6.82 | 7.90 | 6.96 |
| Warning / edited | 8.94 | 10.36 | 9.14 |
| Error / over-limit / recording | 5.05 | 5.86 | 5.16 |

Primary-button dark text on accent is 11.87:1. Functional outlines against controls are 6.56:1 (above 3:1); graph grid/decorative card borders are intentionally quieter. World-only swatches are not approved UI text colors.

Run from the repository root after npm ci:

```sh
node docs/design/ui-kit/contrast.mjs
node docs/design/ui-kit/verify.mjs
npm run lint
npm run build
```

The browser check uses Playwright Chromium. Set CHROMIUM_PATH to an existing Chromium binary if Playwright's default browser is not installed. It checks drawer width/closure, stable field nodes, invalid input, edit/reset, scoped Tab behavior, help, search, throttled sample updates, narrow/short viewports, reduced motion and zero remote requests/page errors. Review the actual scene overlay again when WP7/WP8 bind these components to game telemetry; this component gallery does not claim to test game input or real telemetry.

Verification on Chromium 153.0.8010.12 passed at 1440×900, 1024×768, 390×680 and 320×480. The animation made 23 text updates during a 1.15 s observation (below the 30 Hz cap); the original range element survived edits and reset. No remote requests or page errors were observed.
