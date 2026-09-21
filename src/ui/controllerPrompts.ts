import glyphUrl from '../../assets/ui/controller-glyphs.svg?url&no-inline';
import { PAD_COMMANDS, type GamepadState } from '../input/gamepad';
import type { HapticsState } from '../input/haptics';
import { node } from './paramControl';

interface PromptRow {
  element: HTMLElement;
  label: Text;
  glyph: SVGSVGElement;
  key: HTMLElement;
  keyboard: string;
  pad: string;
  symbol: string;
}
const SYMBOLS: Record<number, readonly [string, string]> = {
  12: ['dpad-up-down', 'D-pad Up'],
  15: ['dpad-left-right', 'D-pad Right'],
  13: ['dpad-up-down', 'D-pad Down'],
  14: ['dpad-left-right', 'D-pad Left'],
  0: ['button-bottom', 'Bottom (A)'],
  2: ['button-left', 'Left (X)'],
  3: ['button-top', 'Top (Y)'],
  5: ['rb', 'Right bumper'],
};

/** Build once; activity changes only update text/visibility, never replace DOM. */
export class ControllerPrompts {
  readonly root: HTMLElement;
  private readonly legend: HTMLElement;
  private readonly driving: HTMLElement;
  private readonly options: HTMLElement;
  private readonly menu: HTMLElement;
  private readonly rows: PromptRow[] = [];
  private readonly hiddenHints: HTMLElement[] = [];
  private readonly status: Text;
  private readonly hapticStatus: Text;
  private readonly hapticCaption: HTMLElement;
  private keyboardTime = -Infinity;
  private mode: 'keyboard' | 'gamepad' = 'keyboard';
  private lastStatus = '';
  private initialized = false;

  constructor(host: HTMLElement, options: HTMLElement, pauseMenu: HTMLElement) {
    const doc = host.ownerDocument;
    this.root = node(doc, 'div', 'sl-ui sl-controller-overlay');
    this.legend = node(doc, 'section', 'sl-controller-legend');
    this.legend.hidden = true;
    this.legend.setAttribute('aria-label', 'Controller commands');
    this.legend.append(
      node(
        doc,
        'h2',
        'sl-controller-legend__title',
        'Hold Left bumper for commands',
      ),
    );
    const items = node(doc, 'div', 'sl-controller-legend__items');
    for (const command of PAD_COMMANDS) {
      const [symbol, position] = SYMBOLS[command.button]!;
      const item = node(doc, 'div', 'sl-controller-legend__item');
      item.append(
        this.glyph(symbol),
        node(doc, 'span', '', position + ': ' + command.label),
      );
      items.append(item);
    }
    this.legend.append(items);
    this.driving = node(doc, 'div', 'sl-input-prompts');
    this.add(this.driving, 'Escape: menu', 'Start: menu', '');
    this.add(this.driving, 'O: Options', 'View / Back: Options', '');
    this.add(this.driving, 'H: HUD', 'Hold Left bumper: commands', 'lb');
    const status = node(doc, 'span', 'sl-caption');
    status.setAttribute('role', 'status');
    this.status = doc.createTextNode('');
    status.append(this.status);
    this.driving.append(status);
    this.root.append(this.legend, this.driving);
    host.append(this.root);
    this.hapticCaption = node(doc, 'p', 'sl-caption');
    this.hapticStatus = doc.createTextNode('');
    this.hapticCaption.append(this.hapticStatus);
    options
      .querySelector('[data-group=Input] .sl-group__actions')
      ?.append(this.hapticCaption);
    this.options = node(doc, 'div', 'sl-input-prompts');
    this.add(
      this.options,
      'Tab: next control',
      'D-pad / stick: move',
      'dpad-up-down',
    );
    this.add(
      this.options,
      'Arrow keys: adjust',
      'Left / Right: adjust · Right bumper: coarse',
      'rb',
    );
    this.add(
      this.options,
      'Enter: select',
      'Bottom (A): select / edit text',
      'button-bottom',
    );
    this.add(this.options, 'Escape: close', 'Right (B): back', 'button-right');
    this.add(
      this.options,
      'Search by label or key',
      'Top (Y): search · Left (X): reset · Triggers: section',
      'button-top',
    );
    options.querySelector('.sl-options__header')?.append(this.options);
    this.menu = node(doc, 'div', 'sl-input-prompts');
    this.add(
      this.menu,
      'Up / Down: move',
      'D-pad / stick: move',
      'dpad-up-down',
    );
    this.add(this.menu, 'Enter: select', 'Bottom (A): select', 'button-bottom');
    this.add(
      this.menu,
      'Escape: resume',
      'Start: resume · Right (B): back',
      'button-right',
    );
    pauseMenu.querySelector('.sl-pause__menu')?.append(this.menu);
    for (const root of [options, pauseMenu]) {
      for (const hint of root.querySelectorAll<HTMLElement>(
        '[data-controller-replaced]',
      )) {
        if (!hint.hidden) {
          hint.hidden = true;
          this.hiddenHints.push(hint);
        }
      }
    }
    doc.defaultView?.addEventListener('keydown', this.keyboardActivity, true);
    doc.defaultView?.addEventListener(
      'pointerdown',
      this.keyboardActivity,
      true,
    );
  }

  get device(): 'keyboard' | 'gamepad' {
    return this.mode;
  }

  update(
    pad: Readonly<GamepadState>,
    captured: boolean,
    haptics: Readonly<HapticsState>,
  ): void {
    const mode =
      pad.connected && pad.lastActivityTime > this.keyboardTime
        ? 'gamepad'
        : 'keyboard';
    if (!this.initialized || mode !== this.mode) {
      this.initialized = true;
      this.mode = mode;
      for (const row of this.rows) {
        row.label.nodeValue =
          mode === 'gamepad'
            ? row.pad
            : row.keyboard.includes(':')
              ? row.keyboard.slice(row.keyboard.indexOf(':') + 1).trim()
              : row.keyboard;
        row.glyph.style.display =
          mode !== 'gamepad' || !row.symbol ? 'none' : '';
        row.key.hidden = mode === 'gamepad' || !row.keyboard.includes(':');
        row.element.dataset.inputDevice = mode;
      }
    }
    this.root.hidden = captured;
    this.legend.hidden = captured || mode !== 'gamepad' || !pad.modifier;
    const status = !pad.connected
      ? 'Controller disconnected / not detected'
      : haptics.status === 'unavailable' || haptics.status === 'error'
        ? 'Controller connected · vibration unavailable'
        : haptics.status === 'off'
          ? 'Controller connected · vibration off'
          : 'Controller connected';
    if (status !== this.lastStatus) {
      this.lastStatus = status;
      this.status.nodeValue = status;
      this.hapticStatus.nodeValue = status;
    }
  }

  dispose(): void {
    const win = this.root.ownerDocument.defaultView;
    win?.removeEventListener('keydown', this.keyboardActivity, true);
    win?.removeEventListener('pointerdown', this.keyboardActivity, true);
    for (const hint of this.hiddenHints) hint.hidden = false;
    this.root.remove();
    this.options.remove();
    this.menu.remove();
    this.hapticCaption.remove();
  }

  private add(
    parent: HTMLElement,
    keyboard: string,
    pad: string,
    symbol: string,
  ): void {
    const doc = parent.ownerDocument;
    const element = node(doc, 'span', 'sl-input-prompts__item');
    const glyph = this.glyph(symbol);
    const key = node(doc, 'kbd', 'sl-keycap');
    key.setAttribute('aria-hidden', 'true');
    key.textContent = keyboard.split(':')[0] ?? '';
    const labelElement = node(doc, 'span', 'sl-input-prompts__label');
    const label = doc.createTextNode(keyboard);
    labelElement.append(label);
    element.append(glyph, key, labelElement);
    parent.append(element);
    this.rows.push({ element, label, glyph, key, keyboard, pad, symbol });
  }
  private glyph(symbol: string): SVGSVGElement {
    const doc = this.root.ownerDocument;
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'sl-controller-glyph');
    svg.setAttribute('viewBox', '0 0 40 40');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const use = doc.createElementNS(svg.namespaceURI, 'use');
    use.setAttribute('href', glyphUrl + '#' + symbol);
    svg.append(use);
    return svg;
  }
  private readonly keyboardActivity = (event: Event): void => {
    this.keyboardTime = event.timeStamp;
  };
}
