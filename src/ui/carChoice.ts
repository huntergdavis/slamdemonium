import { HERO_PAINTS, type HeroPaint } from '../vehicle/vehicleDefinition';

const STORAGE_KEY = 'slamdemonium.heroPaint';

/** A visual choice in Options; it never changes the vehicle body or tuning. */
export function mountCarChoice(
  options: HTMLElement,
  onChange: (paint: HeroPaint) => void,
) {
  const doc = options.ownerDocument;
  const label = doc.createElement('label');
  label.className = 'sl-caption';
  label.textContent = 'Car colour ';
  const select = doc.createElement('select');
  select.className = 'sl-select';
  select.dataset.carChoice = 'true';
  select.setAttribute('aria-label', 'Car colour');
  for (const paint of HERO_PAINTS) {
    const choice = doc.createElement('option');
    choice.value = paint;
    choice.textContent = paint[0]!.toUpperCase() + paint.slice(1);
    select.append(choice);
  }
  let initial: HeroPaint = 'orange';
  try {
    const saved = doc.defaultView?.localStorage.getItem(STORAGE_KEY);
    if (saved && HERO_PAINTS.some((paint) => paint === saved))
      initial = saved as HeroPaint;
  } catch {
    // Private browsing may deny storage; the selector still works for the run.
  }
  select.value = initial;
  onChange(initial);
  select.addEventListener('change', () => {
    const paint = select.value as HeroPaint;
    onChange(paint);
    try {
      doc.defaultView?.localStorage.setItem(STORAGE_KEY, paint);
    } catch {
      // The selected colour still applies for this run.
    }
  });
  label.append(select);
  (options.querySelector('.sl-options__header') ?? options).append(label);
  return { dispose: () => label.remove() };
}
