import type { ParamDef, ParamKey } from '../tuning/schema';
import { configureSlider, sliderToValue, valueToSlider } from './sliderMapping';
import { TuningSession } from './tuningSession';

export function node<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className = '',
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = doc.createElement(tag);
  element.className = className;
  if (text !== undefined) element.append(doc.createTextNode(text));
  return element;
}

export class ParamControl {
  readonly element: HTMLDivElement;
  readonly number: HTMLInputElement;
  readonly range: HTMLInputElement;
  readonly searchText: string;
  private readonly error: HTMLParagraphElement;
  private readonly errorText: Text;
  private readonly rebuild: HTMLSpanElement | undefined;
  private readonly rebuildText: Text | undefined;
  private invalid = false;
  private pointerEditing = false;

  constructor(
    host: HTMLElement,
    readonly definition: Readonly<ParamDef & { key: ParamKey }>,
    private readonly session: TuningSession,
    prefix: string,
    private readonly drivingSurface: HTMLElement,
  ) {
    const doc = host.ownerDocument;
    const id = `${prefix}-${definition.key}`;
    this.searchText = (definition.label + ' ' + definition.key).toLowerCase();
    this.element = node(doc, 'div', 'sl-field');
    this.element.dataset.key = definition.key;
    const label = node(doc, 'label', 'sl-field__label', definition.label + ' ');
    label.htmlFor = id + '-number';
    const edited = node(doc, 'span', 'sl-field__edited', '*');
    edited.setAttribute('aria-label', 'Modified from active preset');
    edited.title = 'Modified from active preset';
    label.append(edited, node(doc, 'span', 'sl-field__unit', definition.unit));
    if (definition.needsRebuild) {
      this.rebuild = node(doc, 'span', 'sl-badge');
      this.rebuildText = doc.createTextNode('rebuild');
      this.rebuild.append(this.rebuildText);
      label.append(this.rebuild);
    }
    this.number = node(doc, 'input', 'sl-input sl-field__number');
    this.number.id = id + '-number';
    this.number.type = 'number';
    this.number.min = String(definition.min);
    this.number.max = String(definition.max);
    this.number.step = 'any';
    this.number.setAttribute('aria-label', definition.label + ' value');
    const reset = node(
      doc,
      'button',
      'sl-button sl-button--icon sl-field__reset',
      '↺',
    );
    reset.type = 'button';
    reset.setAttribute('aria-label', 'Reset ' + definition.label);
    reset.title = 'Reset to schema default: ' + definition.default;
    const help = node(
      doc,
      'button',
      'sl-button sl-button--icon sl-field__help',
      '?',
    );
    help.type = 'button';
    help.setAttribute('aria-label', 'Help for ' + definition.label);
    help.setAttribute('aria-controls', id + '-help');
    help.setAttribute('aria-describedby', id + '-help');
    help.setAttribute('aria-expanded', 'false');
    const tooltip = node(doc, 'p', 'sl-tooltip', definition.help);
    tooltip.id = id + '-help';
    tooltip.setAttribute('role', 'tooltip');
    tooltip.hidden = true;
    this.range = node(doc, 'input', 'sl-field__range');
    this.range.id = id + '-range';
    this.range.setAttribute('aria-label', definition.label + ' slider');
    this.range.setAttribute('aria-describedby', tooltip.id);
    configureSlider(this.range, definition);
    this.error = node(doc, 'p', 'sl-field__error');
    this.error.id = id + '-error';
    this.error.hidden = true;
    this.errorText = doc.createTextNode('');
    this.error.append(this.errorText);
    this.number.setAttribute(
      'aria-describedby',
      tooltip.id + ' ' + this.error.id,
    );
    this.element.append(
      label,
      this.number,
      reset,
      help,
      this.range,
      tooltip,
      this.error,
    );
    host.append(this.element);

    this.element.addEventListener('sl-tune-step', (raw) => {
      const event = raw as CustomEvent<{ direction: number; coarse: boolean }>;
      if (event.target !== this.range && event.target !== this.number) return;
      event.preventDefault();
      const direction = Math.sign(event.detail.direction);
      const current = session.store.get(definition.key);
      let value: number;
      if (definition.discrete) {
        const index = definition.discrete.indexOf(current);
        value =
          definition.discrete[
            Math.max(
              0,
              Math.min(definition.discrete.length - 1, index + direction),
            )
          ] ?? current;
      } else {
        value = Number(
          (
            current +
            direction * definition.step * (event.detail.coarse ? 10 : 1)
          ).toPrecision(12),
        );
      }
      this.setError('');
      session.store.set(definition.key, value);
      this.sync();
    });

    this.number.addEventListener('input', () => {
      const value = this.number.valueAsNumber;
      if (this.number.value === '' || !Number.isFinite(value)) {
        this.setError('Enter a finite number.');
        return;
      }
      this.setError('');
      session.store.set(definition.key, value);
      this.sync();
    });
    this.number.addEventListener('blur', () => {
      this.setError('');
      this.sync();
    });
    this.range.addEventListener('input', () => {
      this.setError('');
      session.store.set(
        definition.key,
        sliderToValue(definition, this.range.valueAsNumber),
      );
      this.sync();
    });
    this.range.addEventListener('pointerdown', (event) => {
      this.pointerEditing = true;
      this.range.setPointerCapture(event.pointerId);
    });
    this.range.addEventListener('pointerup', () => {
      if (!this.pointerEditing) return;
      this.pointerEditing = false;
      this.range.blur();
      this.drivingSurface.focus({ preventScroll: true });
    });
    this.range.addEventListener('pointercancel', () => {
      this.pointerEditing = false;
    });
    reset.addEventListener('click', () => {
      this.setError('');
      session.store.reset(definition.key);
      this.sync();
    });
    let pinned = false;
    const showHelp = (show: boolean) => {
      tooltip.hidden = !show;
      help.setAttribute('aria-expanded', String(show));
    };
    help.addEventListener('focus', () => {
      showHelp(true);
    });
    help.addEventListener('mouseenter', () => {
      showHelp(true);
    });
    help.addEventListener('mouseleave', () => {
      if (!pinned && doc.activeElement !== help) showHelp(false);
    });
    help.addEventListener('blur', () => {
      if (!pinned) showHelp(false);
    });
    help.addEventListener('click', () => {
      pinned = !pinned;
      showHelp(pinned);
    });
    this.element.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !tooltip.hidden) {
        pinned = false;
        showHelp(false);
        event.preventDefault();
        event.stopPropagation();
      }
    });
    this.sync();
  }

  sync(): void {
    const value = this.session.store.get(this.definition.key);
    const focused = this.number.ownerDocument.activeElement === this.number;
    if (!focused || (!this.invalid && this.number.valueAsNumber !== value))
      this.number.value = String(value);
    this.range.value = String(valueToSlider(this.definition, value));
    this.range.setAttribute(
      'aria-valuetext',
      `${value} ${this.definition.unit}`.trim(),
    );
    this.element.dataset.edited = String(
      this.session.isEdited(this.definition.key),
    );
    if (this.rebuild && this.rebuildText) {
      const state = this.session.rebuildState;
      this.rebuild.hidden = state === 'idle';
      this.rebuild.dataset.state =
        state === 'pending'
          ? 'pending'
          : state === 'error' || state === 'unavailable'
            ? 'error'
            : '';
      this.rebuildText.nodeValue =
        state === 'pending'
          ? 'Applying…'
          : state === 'error'
            ? 'Update failed'
            : state === 'unavailable'
              ? 'Update unavailable'
              : 'rebuild';
    }
  }

  private setError(message: string): void {
    this.invalid = message !== '';
    this.error.hidden = !this.invalid;
    this.errorText.nodeValue = message;
    this.number.setAttribute('aria-invalid', String(this.invalid));
  }
}
