import type { AudioStatus } from '../audio/types';
import type { GamepadState } from '../input/gamepad';
import type { OptionsPanel } from './optionsPanel';
import { activateFocused, adjustFocused, moveFocus } from './menuNavigation';
import { node } from './paramControl';
import { createAudioCredits } from './audioCredits';
import './ui.css';

export interface PauseMenuOptions {
  host: HTMLElement;
  drivingSurface: HTMLElement;
  readPaused: () => boolean;
  /** Boot combines this menu request with P, visibility, Options, perf and replay. */
  onPauseChange: (paused: boolean) => void;
  onRespawn: () => void;
  options: Pick<OptionsPanel, 'element' | 'isOpen' | 'setOpen'>;
  /** Already sampled by InputMapper. This component never polls the browser. */
  readGamepad: () => Readonly<GamepadState>;
  /** Preformatted immutable build identity; no frame-loop work or focus target. */
  buildLabel?: string;
  readAudioState?: () =>
    Readonly<{ masterMuted: boolean; status: AudioStatus }> | undefined;
  onToggleAudioMute?: () => void;
}

export function mountPauseMenu(options: PauseMenuOptions): PauseMenu {
  return new PauseMenu(options);
}

const MAPPINGS: readonly (readonly [string, string, string])[] = [
  ['Throttle', 'W / ↑', 'Right trigger'],
  ['Brake / reverse', 'S / ↓', 'Left trigger'],
  ['Steer', 'A / D or ← / →', 'Left stick'],
  ['Handbrake', 'Space', 'A / bottom face button'],
  ['Boost', 'Left Shift', 'X / left face button'],
  ['Restart / respawn', 'R', 'Y / top face button'],
  ['Pause menu', 'Escape', 'Start / Menu'],
  [
    'Mute all audio',
    'M (outside text editing)',
    'Hold LB + fresh Right bumper',
  ],
  ['Pause toggle', 'P (press again to clear)', '—'],
  ['Options', 'O / gear', 'View / Back, or Pause menu → Options'],
  ['HUD / debug gizmos', 'H / G', 'LB + D-pad Up / LB + X'],
  ['Camera / slow motion', 'C / T', 'LB + D-pad Right / Down'],
  ['A/B tune swap', 'Tab while driving', 'LB + D-pad Left; Options A / B'],
  ['Latency probe / telemetry CSV', 'L / F9', 'LB + Y / LB + A'],
];

export class PauseMenu {
  readonly root: HTMLDivElement;
  readonly element: HTMLDialogElement;
  private readonly menu: HTMLDivElement;
  private readonly controls: HTMLDivElement;
  private readonly resume: HTMLButtonElement;
  private readonly muteAudio: HTMLButtonElement;
  private readonly message: Text;
  private selected: HTMLElement | null = null;
  private opened = false;
  private externalOptionsNavigation = false;
  private view: 'menu' | 'controls' | 'options' = 'menu';
  private optionsParent: Node | null = null;
  private optionsNext: Node | null = null;
  private confirm = 0;
  private back = 0;
  private padIndex = -1;
  private directionX = 0;
  private directionY = 0;
  private nextRepeat = Infinity;

  constructor(private readonly deps: PauseMenuOptions) {
    const doc = deps.host.ownerDocument;
    this.root = node(doc, 'div', 'sl-ui');
    this.element = node(doc, 'dialog', 'sl-pause');
    this.element.setAttribute('aria-label', 'Pause menu');
    this.element.dataset.view = 'menu';
    this.root.append(this.element);
    deps.host.append(this.root);
    this.menu = node(doc, 'div', 'sl-pause__menu');
    const title = node(doc, 'h2', 'sl-heading', 'Paused');
    const status = node(doc, 'p', 'sl-caption');
    status.setAttribute('role', 'status');
    this.message = doc.createTextNode('');
    status.append(this.message);
    this.resume = this.button('Resume', () => this.setOpen(false));
    this.muteAudio = this.button('Mute all audio', () => {
      this.deps.onToggleAudioMute?.();
      this.updateAudio();
    });
    this.muteAudio.hidden = !deps.onToggleAudioMute;
    this.muteAudio.setAttribute('aria-pressed', 'false');
    const navigationHint = node(
      doc,
      'p',
      'sl-caption',
      '↑ / ↓ or D-pad / stick: move · Enter / A: select · Escape / Start: resume · B: back',
    );
    navigationHint.dataset.controllerReplaced = '';
    this.menu.append(
      title,
      status,
      this.resume,
      this.button('Restart', () => {
        try {
          this.deps.onRespawn();
          this.setOpen(false);
        } catch (error) {
          this.message.nodeValue =
            error instanceof Error ? error.message : 'Restart failed.';
        }
      }),
      this.button('Options', () => this.showOptions()),
      this.muteAudio,
      this.button('Controls', () => this.showView('controls')),
      navigationHint,
    );
    if (deps.buildLabel) {
      this.menu.append(
        node(doc, 'p', 'sl-caption sl-pause__build', deps.buildLabel),
      );
    }
    this.controls = node(doc, 'div', 'sl-pause__controls');
    this.controls.hidden = true;
    const table = node(doc, 'table', 'sl-pause__mappings');
    const head = node(doc, 'thead');
    const headings = node(doc, 'tr');
    for (const text of ['Action', 'Keyboard', 'Gamepad']) {
      const cell = node(doc, 'th', '', text);
      cell.scope = 'col';
      headings.append(cell);
    }
    head.append(headings);
    const body = node(doc, 'tbody');
    for (const mapping of MAPPINGS) {
      const row = node(doc, 'tr');
      for (const text of mapping) row.append(node(doc, 'td', '', text));
      body.append(row);
    }
    table.append(head, body);
    this.controls.append(
      node(doc, 'h2', 'sl-heading', 'Controls'),
      this.button('Back', () => this.showView('menu')),
      node(
        doc,
        'p',
        'sl-caption',
        'Controller not responding? Focus the game, then press a controller button to wake it. A standard-mapped controller is required. Keyboard and controller can both be connected.',
      ),
      table,
      node(
        doc,
        'p',
        'sl-caption',
        'In menus: D-pad / left stick moves focus, A selects, B goes back. In Options: left / right adjusts sliders, numbers and presets. RB makes larger adjustments; LT / RT changes section; X resets a parameter; Y finds search. A opens controller text entry for search and preset names. File pickers remain browser-owned.',
      ),
      node(
        doc,
        'p',
        'sl-caption',
        'Escape exits fullscreen or releases pointer lock first; press it again for the pause menu. P is a separate pause toggle and stays active until pressed again.',
      ),
      createAudioCredits(doc),
    );
    this.element.append(this.menu, this.controls);
    this.element.addEventListener('focusin', this.focusin);
    this.element.addEventListener('keydown', this.keydown);
    this.element.addEventListener('cancel', this.cancel);
  }

  /** ControllerSupport owns Options navigation in BOTH drawer and modal views. */
  attachOptionsNavigation(): () => void {
    this.externalOptionsNavigation = true;
    return () => {
      this.externalOptionsNavigation = false;
    };
  }

  navigateBack(): void {
    this.goBack();
  }

  get isOpen(): boolean {
    return this.opened;
  }

  toggle(): void {
    this.setOpen(!this.opened);
  }

  setOpen(open: boolean): void {
    if (open === this.opened) return;
    this.opened = open;
    if (open) {
      this.deps.onPauseChange(true);
      this.message.nodeValue = this.deps.readPaused()
        ? 'Simulation paused. If you also paused with P or in Options, clear that pause to drive.'
        : 'Pause requested.';
      this.showView('menu');
      this.element.showModal();
      this.resume.focus();
      this.resetPad();
    } else {
      if (this.view === 'options') {
        // Resume releases only our pause. Leave the existing nonmodal Options
        // drawer (and its own pause checkbox) in the state the user chose.
        this.restoreOptions();
        this.view = 'menu';
      }
      this.element.close();
      this.selected?.removeAttribute('data-selected');
      this.selected = null;
      this.deps.onPauseChange(false);
      this.deps.drivingSurface.focus({ preventScroll: true });
    }
  }

  /** Call once per RAF, also while paused; no physics sample or extra Gamepad API poll. */
  update(nowMs: number): void {
    this.updateAudio();
    if (!this.opened) return;
    if (this.view === 'options' && !this.deps.options.isOpen)
      this.showView('menu');
    if (this.view === 'options' && this.externalOptionsNavigation) return;
    this.ensureSelection();
    const pad = this.deps.readGamepad();
    if (pad.index !== this.padIndex || !pad.connected) {
      this.resetPad();
      return;
    }
    const back = pad.backPresses > this.back;
    const confirm = pad.confirmPresses > this.confirm;
    this.back = pad.backPresses;
    this.confirm = pad.confirmPresses;
    if (back) {
      this.goBack();
      return;
    }
    const root = this.navigationRoot();
    const changed =
      pad.menuX !== this.directionX || pad.menuY !== this.directionY;
    this.directionX = pad.menuX;
    this.directionY = pad.menuY;
    if ((pad.menuX || pad.menuY) && (changed || nowMs >= this.nextRepeat)) {
      if (pad.menuY && this.view === 'controls')
        this.element.scrollTop += pad.menuY * 100;
      else if (pad.menuY) moveFocus(root, pad.menuY);
      else adjustFocused(root, pad.menuX);
      this.nextRepeat = nowMs + (changed ? 350 : 110);
    }
    if (confirm) activateFocused(root);
  }

  dispose(): void {
    this.setOpen(false);
    this.element.removeEventListener('focusin', this.focusin);
    this.element.removeEventListener('keydown', this.keydown);
    this.element.removeEventListener('cancel', this.cancel);
    this.root.remove();
  }

  private updateAudio(): void {
    const state = this.deps.readAudioState?.();
    const muted = state?.masterMuted === true;
    const label = muted ? 'Unmute audio' : 'Mute all audio';
    if (this.muteAudio.textContent !== label) {
      this.muteAudio.firstChild!.nodeValue = label;
      this.muteAudio.setAttribute('aria-pressed', String(muted));
    }
  }

  private button(label: string, action: () => void): HTMLButtonElement {
    const button = node(
      this.root.ownerDocument,
      'button',
      'sl-button sl-pause__entry',
      label,
    );
    button.type = 'button';
    button.addEventListener('click', action);
    return button;
  }

  private select(control: HTMLElement): void {
    if (control === this.selected) return;
    this.selected?.removeAttribute('data-selected');
    this.selected = control;
    control.dataset.selected = 'true';
    control.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  /** Native dialogs can focus their background after a pointer click. Keep the
   * next keyboard/pad activation on the visible selection, never on the dialog. */
  private ensureSelection(): void {
    const root = this.navigationRoot();
    const active = root.ownerDocument.activeElement;
    if (
      active instanceof root.ownerDocument.defaultView!.HTMLElement &&
      active !== root &&
      root.contains(active) &&
      !active.closest('[hidden], [inert]')
    ) {
      this.select(active);
      return;
    }
    if (
      this.selected &&
      root.contains(this.selected) &&
      !this.selected.matches(':disabled') &&
      !this.selected.closest('[hidden], [inert]')
    )
      this.selected.focus();
    else moveFocus(root, 1);
  }

  private readonly focusin = (event: FocusEvent): void => {
    if (this.view === 'options' && this.externalOptionsNavigation) return;
    const target = event.target;
    const root = this.navigationRoot();
    if (
      target instanceof root.ownerDocument.defaultView!.HTMLElement &&
      target !== root &&
      root.contains(target)
    )
      this.select(target);
  };

  private resetPad(): void {
    const pad = this.deps.readGamepad();
    this.padIndex = pad.index;
    this.confirm = pad.confirmPresses;
    this.back = pad.backPresses;
    this.directionX = this.directionY = 0;
    this.nextRepeat = Infinity;
  }

  private navigationRoot(): HTMLElement {
    return this.view === 'options'
      ? this.deps.options.element
      : this.view === 'controls'
        ? this.controls
        : this.menu;
  }

  private showOptions(): void {
    const element = this.deps.options.element;
    this.optionsParent = element.parentNode;
    this.optionsNext = element.nextSibling;
    // Keep the SAME panel and its listeners/store, inside the native modal's
    // focus scope. Restore its original position when returning to the menu.
    this.element.append(element);
    this.showView('options');
    this.deps.options.setOpen(true);
    moveFocus(element, 1);
  }

  private restoreOptions(): void {
    if (!this.optionsParent) return;
    this.optionsParent.insertBefore(
      this.deps.options.element,
      this.optionsNext,
    );
    this.optionsParent = this.optionsNext = null;
  }

  private showView(view: 'menu' | 'controls' | 'options'): void {
    if (this.view === 'options' && view !== 'options') {
      this.deps.options.setOpen(false);
      this.restoreOptions();
    }
    if (view === 'options' && this.externalOptionsNavigation) {
      this.selected?.removeAttribute('data-selected');
      this.selected = null;
    }
    this.view = view;
    this.element.dataset.view = view;
    this.element.setAttribute(
      'aria-label',
      view === 'menu'
        ? 'Pause menu'
        : view === 'options'
          ? 'Paused — Options'
          : 'Controls',
    );
    this.menu.hidden = view !== 'menu';
    this.controls.hidden = view !== 'controls';
    if (view === 'menu') this.resume.focus();
    else if (view === 'controls')
      this.controls.querySelector('button')?.focus({ preventScroll: true });
    if (view === 'controls') this.element.scrollTop = 0;
    this.resetPad();
  }

  private goBack(): void {
    if (this.view === 'menu') this.setOpen(false);
    else this.showView('menu');
  }

  private readonly cancel = (event: Event): void => {
    event.preventDefault();
    this.setOpen(false);
  };

  private readonly keydown = (event: KeyboardEvent): void => {
    if (
      event.defaultPrevented ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    )
      return;
    if (event.key === 'Tab') {
      event.preventDefault();
      moveFocus(this.navigationRoot(), event.shiftKey ? -1 : 1);
      return;
    }
    if (
      this.view !== 'options' &&
      (event.key === 'ArrowDown' || event.key === 'ArrowUp')
    ) {
      event.preventDefault();
      if (this.view === 'controls')
        this.element.scrollTop += event.key === 'ArrowDown' ? 100 : -100;
      else moveFocus(this.navigationRoot(), event.key === 'ArrowDown' ? 1 : -1);
    }
    // Escape is consumed by KeyboardInput as pauseMenu, except Options' own
    // close/help handlers. Native dialog cancel is only a platform fallback.
  };
}
