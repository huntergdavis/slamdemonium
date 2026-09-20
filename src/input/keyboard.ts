import {
  createActionCounts,
  type ActionCounts,
  type InputAction,
} from './types';

const KEY_ACTIONS = {
  KeyW: null,
  ArrowUp: null,
  KeyS: null,
  ArrowDown: null,
  KeyA: null,
  ArrowLeft: null,
  KeyD: null,
  ArrowRight: null,
  Space: null,
  ShiftLeft: null,
  KeyR: 'respawn',
  KeyO: 'options',
  KeyH: 'hud',
  KeyG: 'gizmos',
  KeyC: 'camera',
  KeyT: 'slowMotion',
  KeyP: 'pause',
  Escape: 'pauseMenu',
  KeyL: 'latencyProbe',
  Tab: 'swapAB',
  F9: 'recordTelemetry',
} as const satisfies Record<string, InputAction | null>;
export type InputKeyCode = keyof typeof KEY_ACTIONS;
export const PROBE_QUEUE_CAPACITY = 128;

export interface KeyboardState {
  readonly held: Readonly<Record<InputKeyCode, boolean>>;
  readonly presses: Readonly<ActionCounts>;
  readonly probeTimes: Float64Array;
  readonly probeSequence: number;
  readonly lastEventTime: number;
}
export interface KeyboardOptions {
  /** Options should be marked data-options-panel; dialogs and native controls also qualify. */
  isOptionsTarget?: (target: EventTarget | null) => boolean;
  isEditingTarget?: (target: EventTarget | null) => boolean;
  visibilityTarget?: Document | null;
}

function isKnownKey(code: string): code is InputKeyCode {
  return Object.prototype.hasOwnProperty.call(KEY_ACTIONS, code);
}

function closest(target: EventTarget | null, selector: string): boolean {
  const element = target as Element | null;
  return (
    typeof element?.closest === 'function' && element.closest(selector) !== null
  );
}

export function isEditingTarget(target: EventTarget | null): boolean {
  return closest(
    target,
    'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
  );
}

export function isOptionsTarget(target: EventTarget | null): boolean {
  return closest(
    target,
    '[data-options-panel], [role="dialog"], input, textarea, select, button, a[href], [contenteditable]:not([contenteditable="false"])',
  );
}

/** Handlers only update this preallocated event state (plus required preventDefault).
 * Sampling never clears event state; monotonic command counters have independent readers.
 */
export class KeyboardInput {
  private readonly raw = {
    held: Object.fromEntries(
      Object.keys(KEY_ACTIONS).map((code) => [code, false]),
    ) as Record<InputKeyCode, boolean>,
    presses: createActionCounts(),
    probeTimes: new Float64Array(PROBE_QUEUE_CAPACITY),
    probeSequence: 0,
    lastEventTime: 0,
  };
  private readonly editingTarget: (target: EventTarget | null) => boolean;
  private readonly optionsTarget: (target: EventTarget | null) => boolean;
  private readonly visibilityTarget: Document | null;
  private browserModeActive = false;
  private browserExitTime = -Infinity;
  private browserEscapeHeld = false;

  constructor(
    private readonly target: EventTarget | null = typeof window === 'undefined'
      ? null
      : window,
    options: KeyboardOptions = {},
  ) {
    this.editingTarget = options.isEditingTarget ?? isEditingTarget;
    this.optionsTarget = options.isOptionsTarget ?? isOptionsTarget;
    this.visibilityTarget =
      options.visibilityTarget === undefined
        ? typeof document === 'undefined'
          ? null
          : document
        : options.visibilityTarget;
    this.browserModeActive = this.browserOwnsEscape();
    target?.addEventListener('keydown', this.browserEscape, true);
    target?.addEventListener('keyup', this.browserEscapeRelease, true);
    this.visibilityTarget?.addEventListener(
      'fullscreenchange',
      this.browserModeChanged,
    );
    this.visibilityTarget?.addEventListener(
      'pointerlockchange',
      this.browserModeChanged,
    );
    target?.addEventListener('keydown', this.keydown);
    target?.addEventListener('keyup', this.keyup);
    target?.addEventListener('blur', this.blur);
    target?.addEventListener('focusin', this.focusin);
    this.visibilityTarget?.addEventListener(
      'visibilitychange',
      this.visibilitychange,
    );
  }

  get state(): KeyboardState {
    return this.raw;
  }

  dispose(): void {
    this.target?.removeEventListener('keydown', this.browserEscape, true);
    this.target?.removeEventListener('keyup', this.browserEscapeRelease, true);
    this.visibilityTarget?.removeEventListener(
      'fullscreenchange',
      this.browserModeChanged,
    );
    this.visibilityTarget?.removeEventListener(
      'pointerlockchange',
      this.browserModeChanged,
    );
    this.target?.removeEventListener('keydown', this.keydown);
    this.target?.removeEventListener('keyup', this.keyup);
    this.target?.removeEventListener('blur', this.blur);
    this.target?.removeEventListener('focusin', this.focusin);
    this.visibilityTarget?.removeEventListener(
      'visibilitychange',
      this.visibilitychange,
    );
  }

  private readonly keydown = (rawEvent: Event): void => {
    const event = rawEvent as KeyboardEvent;
    const code = event.code;
    if (!isKnownKey(code)) return;
    // Options/help can handle Escape locally. Other bound keys retain their
    // independent-reader behavior: the live mapper and bundled input fixture
    // both observe the event even after one prevents the browser default.
    if (code === 'Escape' && event.defaultPrevented) return;
    if (
      (code !== 'Escape' &&
        (this.editingTarget(event.target) ||
          this.optionsTarget(event.target))) ||
      event.isComposing
    )
      return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    if (event.repeat || this.raw.held[code]) return;
    this.raw.held[code] = true;
    this.raw.lastEventTime = event.timeStamp;
    const action = KEY_ACTIONS[code];
    if (action !== null) this.raw.presses[action]++;
    if (code === 'KeyL') {
      this.raw.probeTimes[this.raw.probeSequence % PROBE_QUEUE_CAPACITY] =
        event.timeStamp;
      this.raw.probeSequence++;
    }
  };

  private readonly keyup = (rawEvent: Event): void => {
    const event = rawEvent as KeyboardEvent;
    if (!isKnownKey(event.code)) return;
    // Releases are accepted even if focus/modifiers changed since the keydown.
    this.raw.held[event.code] = false;
    this.raw.lastEventTime = event.timeStamp;
  };

  private readonly blur = (): void => {
    this.clearHeld();
  };
  private readonly focusin = (event: Event): void => {
    if (this.editingTarget(event.target) || this.optionsTarget(event.target))
      this.clearHeld();
  };
  private readonly visibilitychange = (): void => {
    if (this.visibilityTarget?.hidden) this.clearHeld();
  };

  private browserOwnsEscape(): boolean {
    return Boolean(
      this.visibilityTarget?.fullscreenElement ||
      this.visibilityTarget?.pointerLockElement,
    );
  }

  private readonly browserModeChanged = (event: Event): void => {
    const active = this.browserOwnsEscape();
    if (this.browserModeActive && !active)
      this.browserExitTime = event.timeStamp;
    this.browserModeActive = active;
  };

  // Browser exit can precede its key event. Preserve native Escape, including
  // repeats, and prevent the same gesture reaching an Options/menu listener.
  // No preventDefault: the browser must retain its unlock/fullscreen gesture.
  private readonly browserEscape = (rawEvent: Event): void => {
    const event = rawEvent as KeyboardEvent;
    if (event.code !== 'Escape') return;
    if (
      this.browserOwnsEscape() ||
      event.timeStamp - this.browserExitTime < 150 ||
      (event.repeat && this.browserEscapeHeld)
    ) {
      this.browserEscapeHeld = true;
      event.stopImmediatePropagation();
    }
  };

  private readonly browserEscapeRelease = (rawEvent: Event): void => {
    if ((rawEvent as KeyboardEvent).code !== 'Escape') return;
    this.browserEscapeHeld = false;
    this.browserExitTime = -Infinity;
  };

  private clearHeld(): void {
    for (const code in this.raw.held) {
      if (isKnownKey(code)) this.raw.held[code] = false;
    }
  }
}
