import type { Page } from '@playwright/test';

declare global {
  interface Window {
    __controllerPad: {
      set(buttons: number[], x?: number, y?: number): void;
      tap(buttons: number[], x?: number, y?: number): Promise<void>;
      hold(buttons: number[], x?: number, y?: number): Promise<void>;
      connect(value: boolean): Promise<void>;
      effects: GamepadEffectParameters[];
      resets: number;
    };
  }
}

/** Browser API stub only: all mapping, UI, feedback and physics are the built app. */
export async function installController(page: Page): Promise<void> {
  await page.addInitScript(() => {
    let polls = 0;
    const effects: GamepadEffectParameters[] = [];
    const pad = {
      id: 'Standard controller test',
      index: 0,
      connected: true,
      mapping: 'standard',
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({
        pressed: false,
        touched: false,
        value: 0,
      })),
      vibrationActuator: {
        playEffect: async (_type: string, params: GamepadEffectParameters) => {
          effects.push({ ...params });
          return 'complete';
        },
        reset: async () => {
          window.__controllerPad.resets++;
          return 'complete';
        },
      },
    };
    Object.defineProperty(navigator, 'getGamepads', {
      value: () => {
        polls++;
        return pad.connected ? [pad] : [];
      },
    });
    const set = (buttons: number[], x = 0, y = 0) => {
      pad.axes[0] = x;
      pad.axes[1] = y;
      pad.buttons.forEach((button, index) => {
        button.pressed = buttons.includes(index);
        button.value = button.pressed ? 1 : 0;
      });
    };
    const nextPoll = () =>
      new Promise<void>((resolve) => {
        const before = polls;
        const check = () => {
          if (polls > before) resolve();
          else requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
      });
    window.__controllerPad = {
      set,
      effects,
      resets: 0,
      async tap(buttons, x = 0, y = 0) {
        set(buttons, x, y);
        await nextPoll();
        set([]);
        await nextPoll();
      },
      async hold(buttons, x = 0, y = 0) {
        set(buttons, x, y);
        await nextPoll();
      },
      async connect(value) {
        pad.connected = value;
        await nextPoll();
      },
    };
  });
}

export async function tap(page: Page, buttons: number[]): Promise<void> {
  await page.evaluate(
    (buttons) => window.__controllerPad.tap(buttons),
    buttons,
  );
}

/** Traverse actual pad navigation to an accessible control; no focus() shortcut. */
export async function padFocus(page: Page, selector: string): Promise<void> {
  await page.evaluate(async (selector) => {
    const target = document.querySelector<HTMLElement>(selector);
    if (!target) throw new Error('Missing control: ' + selector);
    for (let index = 0; index < 100; index++) {
      if (document.activeElement === target) return;
      await window.__controllerPad.tap([13]);
    }
    throw new Error('Controller could not reach ' + selector);
  }, selector);
}

export async function keyboardKey(page: Page, label: string): Promise<void> {
  await page.evaluate(async (label) => {
    const root = document.querySelector<HTMLElement>(
      '.sl-controller-keyboard:not([hidden])',
    )!;
    const keys = Array.from(
      root.querySelectorAll<HTMLElement>(
        '.sl-controller-keyboard__keys button',
      ),
    );
    const actions = Array.from(
      root.querySelectorAll<HTMLElement>(
        '.sl-controller-keyboard__actions button',
      ),
    );
    const target = [...keys, ...actions].find(
      (button) => button.textContent === label,
    );
    if (!target) throw new Error('Missing keyboard key ' + label);
    const columns =
      Number(
        getComputedStyle(root).getPropertyValue('--sl-keyboard-columns'),
      ) || 10;
    for (let tries = 0; tries < 50; tries++) {
      const active = document.activeElement as HTMLElement;
      if (active === target) {
        await window.__controllerPad.tap([0]);
        return;
      }
      const from = keys.indexOf(active),
        to = keys.indexOf(target);
      let button = 13;
      if (from >= 0 && to >= 0) {
        if (from % columns !== to % columns)
          button = from % columns < to % columns ? 15 : 14;
        else button = from < to ? 13 : 12;
      } else if (actions.includes(active) && actions.includes(target))
        button = actions.indexOf(active) < actions.indexOf(target) ? 15 : 14;
      await window.__controllerPad.tap([button]);
    }
    throw new Error('Controller keyboard could not reach ' + label);
  }, label);
}
