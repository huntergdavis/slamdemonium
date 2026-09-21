import type { GamepadState } from '../input/gamepad';
import { ControllerKeyboard } from './controllerKeyboard';
import {
  activateFocused,
  adjustFocused,
  focusableControls,
  moveFocus,
} from './menuNavigation';
import type { OptionsPanel } from './optionsPanel';

/** Reads the mapper's already-polled state. No browser polling or pause ownership. */
export class ControllerOptions {
  readonly keyboard: ControllerKeyboard;
  private active = false;
  private selected: HTMLElement | null = null;
  private connection = -1;
  private confirm = 0;
  private back = 0;
  private reset = 0;
  private search = 0;
  private previousSection = 0;
  private nextSection = 0;
  private x = 0;
  private y = 0;
  private repeatAt = Infinity;

  constructor(
    private readonly options: OptionsPanel,
    private readonly readPad: () => Readonly<GamepadState>,
    private readonly onBack: () => void,
  ) {
    this.keyboard = new ControllerKeyboard(options.element);
    options.element.addEventListener('focusin', this.focusin);
    options.element.addEventListener('focusout', this.focusout);
    options.element.addEventListener('keydown', this.keydown);
  }

  update(nowMs: number, active: boolean, padActive: boolean): void {
    const pad = this.readPad();
    if (!active) {
      if (this.active) {
        this.keyboard.close(false);
        this.selected?.removeAttribute('data-selected');
        this.selected = null;
      }
      this.active = false;
      this.snapshot(pad);
      return;
    }
    if (
      !this.active ||
      this.connection !== pad.connectionSequence ||
      !pad.connected
    ) {
      this.active = true;
      this.snapshot(pad);
      if (padActive) this.ensureFocus();
      return;
    }
    if (padActive) this.ensureFocus();
    const back = pad.backPresses > this.back;
    const confirm = pad.confirmPresses > this.confirm;
    const reset = pad.resetPresses > this.reset;
    const search = pad.searchPresses > this.search;
    const section =
      Number(pad.nextSectionPresses > this.nextSection) -
      Number(pad.previousSectionPresses > this.previousSection);
    this.confirm = pad.confirmPresses;
    this.back = pad.backPresses;
    this.reset = pad.resetPresses;
    this.search = pad.searchPresses;
    this.previousSection = pad.previousSectionPresses;
    this.nextSection = pad.nextSectionPresses;
    if (back) {
      if (this.keyboard.isOpen) this.keyboard.close(false);
      else this.onBack();
      return;
    }
    const changed = pad.menuX !== this.x || pad.menuY !== this.y;
    this.x = pad.menuX;
    this.y = pad.menuY;
    if ((this.x || this.y) && (changed || nowMs >= this.repeatAt)) {
      if (this.keyboard.isOpen) this.keyboard.move(this.x, this.y);
      else if (this.y) moveFocus(this.options.element, this.y);
      else adjustFocused(this.options.element, this.x, pad.coarse);
      this.repeatAt = nowMs + (changed ? 350 : 110);
    }
    if (!this.keyboard.isOpen) {
      if (section) this.moveSection(section);
      if (search)
        this.options.element
          .querySelector<HTMLInputElement>('input[type="search"]')
          ?.focus();
      if (reset) {
        const active = this.options.element.ownerDocument.activeElement;
        if (active && this.options.element.contains(active))
          active
            .closest('.sl-field')
            ?.querySelector<HTMLButtonElement>('.sl-field__reset')
            ?.click();
      }
    }
    if (confirm) this.activate();
  }

  dispose(): void {
    this.options.element.removeEventListener('focusin', this.focusin);
    this.options.element.removeEventListener('focusout', this.focusout);
    this.options.element.removeEventListener('keydown', this.keydown);
    this.selected?.removeAttribute('data-selected');
    this.keyboard.dispose();
  }

  private activate(): void {
    if (this.keyboard.isOpen) {
      activateFocused(this.keyboard.element);
      return;
    }
    const root = this.options.element;
    const active = root.ownerDocument.activeElement;
    if (
      !(active instanceof root.ownerDocument.defaultView!.HTMLElement) ||
      !root.contains(active)
    )
      return;
    if (active.matches('[data-controller-text="preset"]')) {
      this.keyboard.open(
        'Name this tuning preset',
        'My tune',
        (value) => this.options.savePresetAs(value),
        active,
      );
    } else if (
      active instanceof root.ownerDocument.defaultView!.HTMLInputElement &&
      active.type === 'search'
    ) {
      this.keyboard.open(
        'Search tuning controls',
        active.value,
        (value) => {
          active.value = value;
          active.dispatchEvent(new Event('input', { bubbles: true }));
        },
        active,
      );
    } else activateFocused(root);
  }

  private moveSection(direction: number): void {
    const root = this.options.element;
    const sections = Array.from(
      root.querySelectorAll<HTMLElement>(
        '.sl-options__header, .sl-options__quick, .sl-options__groups > .sl-group, .sl-options__footer',
      ),
    ).filter(
      (element) => !element.hidden && element.getClientRects().length > 0,
    );
    const active = root.ownerDocument.activeElement;
    const index = sections.findIndex((section) => section.contains(active));
    const next =
      sections[(index + direction + sections.length) % sections.length];
    if (!next) return;
    focusableControls(next)[0]?.focus();
  }

  private snapshot(pad: Readonly<GamepadState>): void {
    this.connection = pad.connectionSequence;
    this.confirm = pad.confirmPresses;
    this.back = pad.backPresses;
    this.reset = pad.resetPresses;
    this.search = pad.searchPresses;
    this.previousSection = pad.previousSectionPresses;
    this.nextSection = pad.nextSectionPresses;
    this.x = this.y = 0;
    this.repeatAt = Infinity;
  }

  private ensureFocus(): void {
    const root = this.keyboard.isOpen
      ? this.keyboard.element
      : this.options.element;
    const active = root.ownerDocument.activeElement;
    if (
      active instanceof root.ownerDocument.defaultView!.HTMLElement &&
      root.contains(active) &&
      !active.closest('[hidden], [inert]') &&
      active.getClientRects().length > 0
    ) {
      this.select(active);
      return;
    }
    if (
      this.selected &&
      root.contains(this.selected) &&
      !this.selected.closest('[hidden], [inert]') &&
      this.selected.getClientRects().length > 0
    )
      this.selected.focus();
    else moveFocus(root, 1);
  }
  private select(element: HTMLElement): void {
    if (element === this.selected) return;
    this.selected?.removeAttribute('data-selected');
    this.selected = element;
    element.dataset.selected = 'true';
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  private readonly focusin = (event: FocusEvent): void => {
    if (!this.active) return;
    const target = event.target;
    if (
      target instanceof
      this.options.element.ownerDocument.defaultView!.HTMLElement
    )
      this.select(target);
  };
  private readonly focusout = (event: FocusEvent): void => {
    const next = event.relatedTarget;
    if (
      next instanceof this.options.element.ownerDocument.defaultView!.Node &&
      this.options.element.contains(next)
    )
      return;
    this.selected?.removeAttribute('data-selected');
    this.selected = null;
  };
  private readonly keydown = (event: KeyboardEvent): void => {
    // The text-entry section is a focus scope in both drawer and modal layouts.
    if (!this.keyboard.isOpen || event.key !== 'Tab') return;
    event.preventDefault();
    event.stopPropagation();
    moveFocus(this.keyboard.element, event.shiftKey ? -1 : 1);
  };
}
