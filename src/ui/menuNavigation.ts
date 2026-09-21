/** DOM navigation only: input sampling and simulation pause remain boot-owned. */
export function focusableControls(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button, input:not([type="hidden"]):not([type="file"]), select, summary, a[href], [tabindex="0"]',
    ),
  ).filter(
    (element) =>
      !element.matches(':disabled') &&
      !element.closest('[hidden], [inert]') &&
      element.getClientRects().length > 0,
  );
}

export function moveFocus(root: HTMLElement, direction: number): void {
  const controls = focusableControls(root);
  if (!controls.length) return;
  const index = controls.indexOf(
    root.ownerDocument.activeElement as HTMLElement,
  );
  const next =
    index < 0
      ? direction > 0
        ? 0
        : controls.length - 1
      : (index + direction + controls.length) % controls.length;
  controls[next]?.focus();
}

export function adjustFocused(
  root: HTMLElement,
  direction: number,
  coarse = false,
): void {
  const active = root.ownerDocument.activeElement;
  if (!active || !root.contains(active)) return;
  const win = root.ownerDocument.defaultView!;
  if (active instanceof win.HTMLSelectElement) {
    const next = Math.max(
      0,
      Math.min(active.options.length - 1, active.selectedIndex + direction),
    );
    if (next === active.selectedIndex) return;
    active.selectedIndex = next;
    active.dispatchEvent(new Event('change', { bubbles: true }));
  } else if (
    active instanceof win.HTMLInputElement &&
    (active.type === 'range' || active.type === 'number')
  ) {
    // ParamControl owns schema units, discrete lists and logarithmic mapping.
    if (
      !active.dispatchEvent(
        new win.CustomEvent('sl-tune-step', {
          bubbles: true,
          cancelable: true,
          detail: { direction, coarse },
        }),
      )
    )
      return;
    const step = Number(active.step) > 0 ? Number(active.step) : 1;
    const min = active.min === '' ? -Infinity : Number(active.min);
    const max = active.max === '' ? Infinity : Number(active.max);
    const value = Number.isFinite(active.valueAsNumber)
      ? active.valueAsNumber
      : 0;
    active.value = String(
      Math.max(min, Math.min(max, value + direction * step)),
    );
    active.dispatchEvent(new Event('input', { bubbles: true }));
    active.dispatchEvent(new Event('change', { bubbles: true }));
  } else if (
    active instanceof win.HTMLElement &&
    active.tagName === 'SUMMARY'
  ) {
    const details = active.parentElement as HTMLDetailsElement;
    details.open = direction > 0;
  }
}

export function activateFocused(root: HTMLElement): void {
  const active = root.ownerDocument.activeElement;
  if (
    active instanceof root.ownerDocument.defaultView!.HTMLElement &&
    root.contains(active)
  )
    active.click();
}
