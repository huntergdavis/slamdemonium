import type { AudioDirector } from '../audio/director';
import { node } from './paramControl';

/** The browser requires a trusted key/click/touch. Controller polling and
 * synthetic click() are intentionally never presented as an unlock mechanism. */
export class AudioPrompt {
  private readonly wrapper: HTMLElement;
  private readonly button: HTMLButtonElement;
  private readonly hint: Text;
  private readonly ownedOverlay: HTMLElement | null;
  private lastStatus = '';

  constructor(
    host: HTMLElement,
    private readonly director: AudioDirector,
  ) {
    const doc = host.ownerDocument;
    let overlay = host.querySelector<HTMLElement>('.sl-controller-overlay');
    this.ownedOverlay = overlay
      ? null
      : node(doc, 'div', 'sl-ui sl-controller-overlay');
    if (!overlay) {
      overlay = this.ownedOverlay!;
      host.append(overlay);
    }
    this.wrapper = node(doc, 'div', 'sl-audio-unlock');
    this.button = node(doc, 'button', 'sl-button');
    this.button.type = 'button';
    this.button.append(
      node(doc, 'span', 'sl-audio-unlock__label', 'Enable sound'),
    );
    const hint = node(doc, 'span', 'sl-audio-unlock__hint sl-caption');
    this.hint = doc.createTextNode('Click or press a key');
    hint.append(this.hint);
    this.button.append(hint);
    this.wrapper.append(this.button);
    overlay.prepend(this.wrapper);
    this.button.addEventListener('click', this.clicked);
    doc.defaultView?.addEventListener('keydown', this.activate, true);
    doc.defaultView?.addEventListener('pointerdown', this.activate, true);
    doc.defaultView?.addEventListener('touchend', this.activate, true);
    // A real focus click may precede async game/audio construction. Sticky
    // activation is evidence of that gesture; resume still handles rejection.
    if (doc.defaultView?.navigator.userActivation?.hasBeenActive)
      director.unlock();
  }
  update(): void {
    const status = this.director.outputState.status;
    if (status === this.lastStatus) return;
    this.lastStatus = status;
    this.wrapper.dataset.audioStatus = status;
    this.wrapper.hidden = status === 'ready';
    this.button.disabled = status === 'error' || status === 'unavailable';
    this.hint.nodeValue = this.button.disabled
      ? 'Sound unavailable — reload to retry'
      : 'Click or press a key';
  }
  dispose(): void {
    const win = this.wrapper.ownerDocument.defaultView;
    win?.removeEventListener('keydown', this.activate, true);
    win?.removeEventListener('pointerdown', this.activate, true);
    win?.removeEventListener('touchend', this.activate, true);
    this.button.removeEventListener('click', this.clicked);
    this.wrapper.remove();
    this.ownedOverlay?.remove();
  }
  private readonly activate = (event: Event): void => {
    if (!event.isTrusted || this.director.outputState.status === 'ready')
      return;
    if (
      event instanceof KeyboardEvent &&
      (event.key === 'Escape' || event.ctrlKey || event.metaKey || event.altKey)
    )
      return;
    this.director.unlock();
  };
  private readonly clicked = (event: MouseEvent): void => {
    if (!event.isTrusted) return;
    this.director.unlock();
    // Do not leave driving keys targeted at this button after the focus click.
    this.wrapper.ownerDocument
      .querySelector<HTMLCanvasElement>('canvas')
      ?.focus({ preventScroll: true });
  };
}
