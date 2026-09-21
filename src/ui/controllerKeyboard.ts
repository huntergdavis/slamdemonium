import { node } from './paramControl';

/** Only search and preset names use this keyboard. It reuses the Options owner;
 * it never opens another native modal or owns a simulation pause. */
export class ControllerKeyboard {
  readonly element: HTMLElement;
  private readonly title: Text;
  private readonly value: HTMLInputElement;
  private readonly keys: HTMLDivElement;
  private readonly hint: Text;
  private inputDevice = '';
  private readonly actions: HTMLDivElement;
  private readonly siblings = new Map<HTMLElement, boolean>();
  private commit: ((value: string) => void) | undefined;
  private returnFocus: HTMLElement | null = null;

  constructor(private readonly options: HTMLElement) {
    const doc = options.ownerDocument;
    this.element = node(doc, 'section', 'sl-controller-keyboard');
    this.element.hidden = true;
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-label', 'Controller text entry');
    const heading = node(doc, 'h2', 'sl-controller-keyboard__title');
    this.title = doc.createTextNode('');
    heading.append(this.title);
    this.value = node(doc, 'input', 'sl-input sl-controller-keyboard__value');
    this.value.type = 'text';
    this.value.maxLength = 80;
    this.value.setAttribute('aria-label', 'Text to enter');
    this.keys = node(doc, 'div', 'sl-controller-keyboard__keys');
    for (const character of 'abcdefghijklmnopqrstuvwxyz0123456789-_.') {
      this.keys.append(
        this.button(
          character,
          () => this.insert(character),
          'sl-controller-keyboard__key',
        ),
      );
    }
    this.actions = node(doc, 'div', 'sl-controller-keyboard__actions');
    this.actions.append(
      this.button('Space', () => this.insert(' ')),
      this.button('Backspace', () => {
        this.value.value = this.value.value.slice(0, -1);
      }),
      this.button('Clear', () => {
        this.value.value = '';
      }),
      this.button('Done', () => this.close(true)),
      this.button('Cancel', () => this.close(false)),
    );
    const hint = node(doc, 'p', 'sl-controller-keyboard__hint');
    this.hint = doc.createTextNode('');
    hint.append(this.hint);
    this.element.append(heading, this.value, this.keys, this.actions, hint);
    this.setInputDevice('gamepad');
    options.append(this.element);
    this.element.addEventListener('keydown', this.keydown);
  }

  setInputDevice(device: 'keyboard' | 'gamepad'): void {
    if (device === this.inputDevice) return;
    this.inputDevice = device;
    this.hint.nodeValue =
      device === 'gamepad'
        ? 'D-pad / stick: move · Bottom (A): select · Right (B): cancel'
        : 'Tab: move · Enter: select · Escape: cancel · Type directly in the text field';
  }

  get isOpen(): boolean {
    return !this.element.hidden;
  }

  open(
    title: string,
    value: string,
    commit: (value: string) => void,
    returnFocus: HTMLElement,
  ): void {
    if (this.isOpen) this.close(false);
    this.title.nodeValue = title;
    this.value.value = value;
    this.commit = commit;
    this.returnFocus = returnFocus;
    for (const child of this.options.children) {
      if (
        !(
          child instanceof this.options.ownerDocument.defaultView!.HTMLElement
        ) ||
        child === this.element
      )
        continue;
      this.siblings.set(child, child.inert);
      child.inert = true;
    }
    this.element.hidden = false;
    this.keys.querySelector('button')?.focus();
  }

  close(apply = false): void {
    if (!this.isOpen) return;
    const commit = this.commit;
    const value = this.value.value;
    this.element.hidden = true;
    for (const [element, inert] of this.siblings) element.inert = inert;
    this.siblings.clear();
    this.commit = undefined;
    this.returnFocus?.focus();
    this.returnFocus = null;
    if (apply) commit?.(value);
  }

  /** Grid movement uses the designer's responsive column count on input only. */
  move(x: number, y: number): void {
    const active = this.element.ownerDocument
      .activeElement as HTMLElement | null;
    const keys = Array.from(this.keys.querySelectorAll('button'));
    const actions = Array.from(this.actions.querySelectorAll('button'));
    const keyIndex = keys.indexOf(active as HTMLButtonElement);
    const actionIndex = actions.indexOf(active as HTMLButtonElement);
    const columns =
      Number(
        this.element.ownerDocument
          .defaultView!.getComputedStyle(this.element)
          .getPropertyValue('--sl-keyboard-columns'),
      ) || 10;
    if (keyIndex >= 0) {
      const next = keyIndex + (y ? y * columns : x);
      if (next < 0) actions[actions.length - 1]?.focus();
      else if (next >= keys.length) actions[0]?.focus();
      else keys[next]?.focus();
    } else if (actionIndex >= 0) {
      if (y < 0) keys[keys.length - 1]?.focus();
      else if (y > 0) keys[0]?.focus();
      else
        actions[(actionIndex + x + actions.length) % actions.length]?.focus();
    } else keys[0]?.focus();
  }

  dispose(): void {
    this.close(false);
    this.element.removeEventListener('keydown', this.keydown);
    this.element.remove();
  }

  private insert(character: string): void {
    if (this.value.value.length < this.value.maxLength)
      this.value.value += character;
  }
  private button(
    label: string,
    action: () => void,
    extra = '',
  ): HTMLButtonElement {
    const button = node(
      this.options.ownerDocument,
      'button',
      'sl-button ' + extra,
      label,
    );
    button.type = 'button';
    button.addEventListener('click', action);
    return button;
  }
  private readonly keydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.close(false);
    } else if (event.key === 'Enter' && event.target === this.value) {
      event.preventDefault();
      this.close(true);
    }
  };
}
