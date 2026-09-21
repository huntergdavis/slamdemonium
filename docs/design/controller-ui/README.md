# Controller UI styling contract (WP19)

Import the existing `src/ui/ui.css` once. All components live under `.sl-ui`.
The input owner builds DOM once and updates text, visibility, values and selection
in place. These styles add no keyboard listeners, frame work or input behavior.

## Persistent selection

The active focus owner sets `data-selected="true"` on exactly one actual control,
removes it from the previous control, and initializes it when opening a view.
Shared Options, pause, and controller-keyboard controls use the same 4px cyan
outline with a dark separation ring. Buttons also use solid cyan with dark text.
`:focus-visible` provides the native-keyboard fallback. Keep actual DOM focus and
selection together; do not select the field container instead of its input.

The existing palette is unchanged. Accent `#6fe4ff` against panel `#121a23` is
11.87:1; selected button text has the same ratio. A solid dark ring separates the
outline from the game background. Selection includes an outline and, for pause
entries, the existing triangular marker, rather than relying on color alone.

## Driving wrapper and flow hints

| Class | Contract |
| --- | --- |
| `.sl-controller-overlay` | Separate `#app > div.sl-ui.sl-controller-overlay`; only this wrapper has fixed positioning. Hide the whole wrapper while Options or a menu captures input. |
| `.sl-controller-legend` | Flow section, hidden unless left bumper is held while driving. |
| `.sl-controller-legend__title` | Heading: “Hold Left bumper for commands”. |
| `.sl-controller-legend__items` / `__item` | Seven command rows, each containing a glyph and positional text. |
| `.sl-input-prompts` | Flow container of live hints; also reused in Options header and pause menu. |
| `.sl-input-prompts__item` / `__label` | Inline prompt and text span. |
| `.sl-keycap` / `.sl-controller-glyph` | Keyboard key and positional SVG presentation. |

The desktop driving wrapper occupies the center gap between G-G and wheel cards,
below status/recording text and above bottom instruments. At the HUD's existing
1100px width / 820px height breakpoints, the wrapper moves above the bottom dock,
which is capped at 55vh. The held legend replaces its redundant sibling driving
hints using CSS; it does not hide the HUD. Overflow remains scrollable for smaller
or zoomed viewports.

At widths up to 500px, the driving legend uses two compact text columns. The
seven labels must retain their physical positions (D-pad Up/Right/Down/Left,
Bottom, Left, Top); SVGs are hidden in this compact legend only. Base prompt and
legend classes do not apply fixed positioning to Options or pause content. The
direct Options header has a 45% height cap and scrolls, so longer device hints
cannot collapse the parameter area or push the footer offscreen. Pause retains
its existing desktop-header / narrow-dialog scroll ownership.

## Positional glyph sprite

Import one external vector sprite, ensuring Vite does not inline the URL:

~~~ts
import glyphsUrl from '../../assets/ui/controller-glyphs.svg?url&no-inline';
~~~

~~~html
<svg class="sl-controller-glyph" viewBox="0 0 40 40"
     aria-hidden="true" focusable="false">
  <use href="SPRITE_URL#button-bottom"></use>
</svg>
<span class="sl-input-prompts__label">Bottom (standard A): select</span>
~~~

Set `use.href` from `glyphsUrl + '#button-bottom'` at construction. Every symbol
uses `0 0 40 40`. IDs: `button-bottom`, `button-right`, `button-left`,
`button-top`, `lb`, `rb`, `lt`, `rt`, `dpad`, `dpad-up-down`,
`dpad-left-right`. Shapes and text inherit `currentColor`.

Face glyphs emphasize the active position in the four-button diamond; A/B/X/Y
are secondary standard-layout references, not controller-brand detection.
Bumpers and triggers show both sides with the active side emphasized. Visible and
accessible prompt text must name the physical position first, because printed
controller labels differ. Decorative SVGs stay hidden from assistive technology;
never make the letter or glyph the only accessible instruction.

The sprite contains no raster or embedded data. Its original handoff measurement
is 4,132 raw / 770 gzip bytes (gzip level 6, timestamp zero). The combined feature
must still run the production bundle check with the sprite actually imported.

## Text-entry keyboard

Append `section.sl-controller-keyboard[role="dialog"][aria-label]` as a direct
child of the existing `.sl-options`. This is the same element whether Options is
a driving drawer or reparented into pause. Use `hidden` while inactive; make the
Options header/body/footer inert while the keyboard owns focus. No nested native
dialog or new pause owner is needed.

| Class | Element |
| --- | --- |
| `.sl-controller-keyboard__title` | Heading naming Search or preset name entry. |
| `.sl-controller-keyboard__value` | Text input, also `.sl-input`. |
| `.sl-controller-keyboard__keys` | Equal-width grid of character buttons. |
| `.sl-controller-keyboard__key` | Also `.sl-button`; one grid cell, at least 48px high. |
| `.sl-controller-keyboard__actions` | Space / Backspace / Clear / Done / Cancel buttons outside the character grid. |
| `.sl-controller-keyboard__hint` | Live keyboard/controller instructions in flow. |

`--sl-keyboard-columns` on the keyboard is 10, 6 when the actual Options container
is at most 640px wide, and 5 at most 420px. The 380px driving drawer therefore
uses five columns even on a desktop screen. Navigation reads this property on
navigation/resize, never through a per-frame layout read. No spanning keys.
The keyboard covers its Options host, with its own vertical scroll area and a
viewport height cap. Focus movement must scroll the selected key/action into view.
