import { BUILTIN_PRESETS, type BuiltinPresetName } from '../tuning/presets';
import type { TuningStore } from '../tuning/store';
import { OptionsGroups } from './optionsGroups';
import { node } from './paramControl';
import type { TirePlotTelemetry } from './tireCurvePlot';
import { TuningSession, type TuningSessionOptions } from './tuningSession';
import './ui.css';

export interface OptionsPanelOptions extends TuningSessionOptions {
  host: HTMLElement;
  drivingSurface: HTMLElement;
  store: TuningStore;
  readTelemetry?: () => TirePlotTelemetry | undefined;
  onPauseChange?: (paused: boolean) => void;
}

export function mountOptionsPanel(options: OptionsPanelOptions): OptionsPanel {
  return new OptionsPanel(options);
}

/** Nonmodal Options region. The simulation owns keyboard sampling and calls toggle/swap. */
export class OptionsPanel {
  readonly session: TuningSession;
  readonly element: HTMLElement;
  readonly opener: HTMLButtonElement;
  readonly root: HTMLDivElement;
  private readonly groups: OptionsGroups;
  private readonly preset: HTMLSelectElement;
  private readonly slots: Record<'A' | 'B', HTMLButtonElement>;
  private readonly slotLabels: Record<'A' | 'B', Text>;
  private readonly pause: HTMLInputElement;
  private readonly saved: Text;
  private readonly edited: HTMLSpanElement;
  private readonly message: Text;
  private readonly shared: HTMLInputElement;
  private readonly unsubscribe: () => void;
  private notice = '';
  private open = false;
  private lastFeedbackMs = -Infinity;

  constructor(private readonly options: OptionsPanelOptions) {
    const { host, drivingSurface, store } = options;
    const doc = host.ownerDocument;
    this.session = new TuningSession(store, options);
    this.root = node(doc, 'div', 'sl-ui');
    this.root.dataset.optionsOpen = 'false';
    host.append(this.root);
    this.opener = node(doc, 'button', 'sl-button', '⚙ Options');
    this.opener.type = 'button';
    this.opener.style.cssText =
      'position:fixed;top:var(--sl-safe);right:var(--sl-safe);z-index:19';
    this.opener.setAttribute('aria-controls', 'sl-options');
    this.opener.setAttribute('aria-expanded', 'false');
    this.opener.addEventListener('click', () => {
      this.setOpen(!this.open);
    });
    this.element = node(doc, 'section', 'sl-options');
    this.element.id = 'sl-options';
    this.element.dataset.optionsPanel = 'true';
    this.element.dataset.open = 'false';
    this.element.setAttribute('role', 'region');
    this.element.setAttribute('aria-labelledby', 'sl-options-title');
    this.element.setAttribute('aria-hidden', 'true');
    this.element.inert = true;
    this.root.append(this.opener, this.element);
    const header = node(doc, 'header', 'sl-options__header');
    const heading = node(doc, 'div', 'sl-options__title');
    const title = node(doc, 'h2', 'sl-heading', 'Options');
    title.id = 'sl-options-title';
    const close = node(doc, 'button', 'sl-button sl-button--icon', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close Options');
    close.addEventListener('click', () => {
      this.setOpen(false);
    });
    heading.append(title, close);
    header.append(heading);
    const presets = node(doc, 'div', 'sl-options__preset');
    this.preset = node(doc, 'select', 'sl-select');
    this.preset.setAttribute('aria-label', 'Preset');
    for (const name of Object.keys(BUILTIN_PRESETS)) {
      const option = node(doc, 'option', '', name);
      option.value = 'builtin:' + name;
      this.preset.append(option);
    }
    this.preset.addEventListener('change', () => {
      this.run(() => {
        const value = this.preset.value;
        if (value.startsWith('builtin:'))
          this.session.applyBuiltin(value.slice(8) as BuiltinPresetName);
        else if (value.startsWith('user:'))
          this.session.applyUser(value.slice(5));
      });
    });
    const save = node(doc, 'button', 'sl-button', 'Save as…');
    save.type = 'button';
    save.dataset.controllerText = 'preset';
    save.addEventListener('click', () => {
      const name = doc.defaultView?.prompt(
        'Name this tuning preset',
        'My tune',
      );
      if (name !== null && name !== undefined)
        this.run(() => {
          this.session.saveAs(name);
        });
    });
    this.edited = node(doc, 'span', 'sl-badge', 'Edited');
    this.edited.dataset.state = 'edited';
    this.preset.id = 'sl-preset';
    const presetLabel = node(doc, 'label');
    presetLabel.htmlFor = this.preset.id;
    presetLabel.append(
      node(doc, 'span', 'sl-caption', 'Preset '),
      this.edited,
      this.preset,
    );
    presets.append(presetLabel, save);
    header.append(presets);
    const comparison = node(doc, 'div', 'sl-toolbar');
    const a = node(doc, 'button', 'sl-button sl-slot');
    const b = node(doc, 'button', 'sl-button sl-slot');
    this.slots = { A: a, B: b };
    this.slotLabels = {
      A: doc.createTextNode('A ACTIVE'),
      B: doc.createTextNode('B'),
    };
    for (const slot of ['A', 'B'] as const) {
      const button = this.slots[slot];
      button.type = 'button';
      button.setAttribute('aria-label', 'Activate slot ' + slot);
      button.append(this.slotLabels[slot]);
      button.addEventListener('click', () => {
        this.session.switchSlot(slot);
      });
      comparison.append(button);
    }
    const copy = node(doc, 'button', 'sl-button', 'Copy A to B');
    copy.type = 'button';
    copy.addEventListener('click', () => {
      this.session.copyAToB();
    });
    comparison.append(copy);
    const pauseLabel = node(doc, 'label', 'sl-checkbox');
    this.pause = node(doc, 'input');
    this.pause.type = 'checkbox';
    this.pause.addEventListener('change', () => {
      options.onPauseChange?.(this.open && this.pause.checked);
    });
    pauseLabel.append(this.pause, doc.createTextNode('Pause while open'));
    const search = node(doc, 'input', 'sl-input');
    search.type = 'search';
    search.placeholder = 'Search label or key';
    search.setAttribute('aria-label', 'Search tuning controls');
    search.addEventListener('input', () => {
      this.groups.search(search.value);
    });
    header.append(
      comparison,
      node(
        doc,
        'p',
        'sl-caption',
        'O opens Options. Tab swaps A/B while driving; inside Options, Tab moves between controls.',
      ),
      pauseLabel,
      search,
    );
    header
      .querySelector('p.sl-caption')
      ?.setAttribute('data-controller-replaced', '');
    const body = node(doc, 'div', 'sl-options__body');
    this.element.append(header, body);
    this.groups = new OptionsGroups(
      body,
      this.session,
      drivingSurface,
      options.readTelemetry,
    );
    const footer = node(doc, 'footer', 'sl-options__footer');
    const toolbar = node(doc, 'div', 'sl-toolbar');
    const file = node(doc, 'input');
    file.type = 'file';
    file.accept = '.json,application/json';
    file.hidden = true;
    file.addEventListener('change', () => {
      const selected = file.files?.[0];
      if (!selected) return;
      void selected
        .text()
        .then((json) => {
          this.run(() => {
            this.session.importJSON(json);
          });
        })
        .catch(() => {
          this.notice = 'Could not read this file.';
          this.sync();
        });
      file.value = '';
    });
    const actions: readonly [string, () => void][] = [
      [
        'Export',
        () => {
          this.download();
        },
      ],
      [
        'Import',
        () => {
          file.click();
        },
      ],
      [
        'Share link',
        () => {
          void this.share();
        },
      ],
      [
        'Reset everything',
        () => {
          this.session.resetEverything();
          const win = doc.defaultView;
          if (win) {
            const url = new URL(win.location.href);
            url.hash = '';
            win.history.replaceState(win.history.state, '', url.href);
          }
          this.shared.hidden = true;
        },
      ],
    ];
    for (const [label, action] of actions) {
      const button = node(doc, 'button', 'sl-button', label);
      button.type = 'button';
      button.addEventListener('click', () => {
        this.run(action);
      });
      toolbar.append(button);
    }
    const saved = node(doc, 'span', 'sl-caption');
    this.saved = doc.createTextNode('');
    saved.append(this.saved);
    const status = node(doc, 'p', 'sl-caption');
    status.setAttribute('role', 'status');
    this.message = doc.createTextNode('');
    status.append(this.message);
    this.shared = node(doc, 'input', 'sl-input');
    this.shared.type = 'text';
    this.shared.readOnly = true;
    this.shared.hidden = true;
    this.shared.setAttribute('aria-label', 'Share link');
    footer.append(toolbar, saved, status, this.shared, file);
    this.element.append(footer);
    this.element.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.setOpen(false);
      }
    });
    this.unsubscribe = this.session.onUpdate((key) => {
      this.groups.sync(key);
      this.sync();
    });
    doc.defaultView?.addEventListener('pagehide', this.flush);
    this.sync();
  }

  savePresetAs(name: string): void {
    this.run(() => this.session.saveAs(name));
  }

  get isOpen(): boolean {
    return this.open;
  }
  toggle(): void {
    this.setOpen(!this.open);
  }

  setOpen(open: boolean): void {
    if (open === this.open) return;
    this.open = open;
    this.root.dataset.optionsOpen = String(open);
    this.element.dataset.open = String(open);
    this.element.setAttribute('aria-hidden', String(!open));
    this.element.inert = !open;
    this.opener.setAttribute('aria-expanded', String(open));
    this.opener.hidden = open;
    this.options.onPauseChange?.(open && this.pause.checked);
    if (!open) this.options.drivingSurface.focus({ preventScroll: true });
  }

  update(nowMs: number): void {
    if (this.open && nowMs - this.lastFeedbackMs >= 1000 / 30) {
      this.lastFeedbackMs = nowMs;
      this.session.updateRebuildState();
    }
    this.groups.plot.update(
      nowMs,
      this.open && this.groups.tires.open && !this.groups.tires.hidden,
    );
  }

  dispose(): void {
    this.root.ownerDocument.defaultView?.removeEventListener(
      'pagehide',
      this.flush,
    );
    this.unsubscribe();
    this.groups.dispose();
    this.session.dispose();
    if (this.open && this.pause.checked) this.options.onPauseChange?.(false);
    this.root.remove();
  }

  private readonly flush = (): void => {
    this.session.persistence.flush();
  };

  private sync(): void {
    const { session } = this;
    for (const name of session.persistence.listPresets()) {
      const value = 'user:' + name;
      if (
        Array.from(this.preset.options).some((option) => option.value === value)
      )
        continue;
      const option = node(this.preset.ownerDocument, 'option', '', name);
      option.value = value;
      this.preset.append(option);
    }
    const builtin = Object.hasOwn(BUILTIN_PRESETS, session.presetName);
    const value = (builtin ? 'builtin:' : 'user:') + session.presetName;
    if (
      Array.from(this.preset.options).some((option) => option.value === value)
    )
      this.preset.value = value;
    else {
      let imported =
        this.preset.querySelector<HTMLOptionElement>('[data-imported]');
      if (!imported) {
        imported = node(this.preset.ownerDocument, 'option');
        imported.dataset.imported = 'true';
        imported.append(this.preset.ownerDocument.createTextNode(''));
        this.preset.append(imported);
      }
      imported.value = 'current';
      if (imported.firstChild)
        imported.firstChild.nodeValue = session.presetName;
      this.preset.value = 'current';
    }
    this.edited.hidden = !session.modified;
    for (const slot of ['A', 'B'] as const) {
      const active = slot === session.activeSlot;
      this.slots[slot].setAttribute('aria-pressed', String(active));
      this.slotLabels[slot].nodeValue = slot + (active ? ' ACTIVE' : '');
    }
    const labels = {
      idle: 'Autosave ready',
      saving: 'Saving…',
      saved: 'Saved locally',
      unavailable: 'Local storage unavailable · export to keep this tune',
      error: 'Save failed · export to keep this tune',
    };
    this.saved.nodeValue = labels[session.persistence.status];
    this.message.nodeValue =
      this.notice || session.message || session.rebuildError || '';
  }

  private run(action: () => void): void {
    this.notice = '';
    try {
      action();
    } catch (error) {
      this.notice =
        error instanceof Error ? error.message : 'Unable to apply this action.';
    }
    this.sync();
  }

  private download(): void {
    const url = URL.createObjectURL(
      new Blob([this.session.exportJSON()], { type: 'application/json' }),
    );
    const link = node(this.root.ownerDocument, 'a');
    link.href = url;
    link.download = 'slamdemonium-tuning.json';
    link.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 0);
  }

  private async share(): Promise<void> {
    const win = this.root.ownerDocument.defaultView;
    if (!win) return;
    const url = this.session.shareURL(win.location.href);
    this.shared.value = url;
    this.shared.hidden = false;
    win.history.replaceState(win.history.state, '', url);
    try {
      if (!win.navigator.clipboard) throw new Error('Clipboard unavailable');
      await win.navigator.clipboard.writeText(url);
      this.notice = 'Share link copied.';
    } catch {
      this.notice = 'Share link ready to copy.';
      this.shared.focus();
      this.shared.select();
    }
    this.sync();
  }
}
