import type { createFaceOffReward } from '../core/faceOffReward';

/** An Options control, not a driving-screen prompt. Locked prize is visible. */
export function mountFaceOffPaintChoice(
  optionsElement: HTMLElement,
  reward: ReturnType<typeof createFaceOffReward>,
  onChange: () => void,
): { refresh(): void } {
  const doc = optionsElement.ownerDocument;
  const row = doc.createElement('label');
  row.className = 'sl-caption';
  row.style.cssText = 'display:flex;align-items:center;gap:8px;margin:8px 0';
  row.append(doc.createTextNode('Car paint'));
  const select = doc.createElement('select');
  select.className = 'sl-select';
  select.setAttribute('aria-label', 'Car paint');
  const orange = doc.createElement('option');
  orange.value = 'orange';
  orange.textContent = 'Orange';
  const gold = doc.createElement('option');
  gold.value = 'vesper-gold';
  gold.textContent = 'Vesper Gold — win Face Off';
  select.append(orange, gold);
  select.addEventListener('change', () => {
    reward.select(select.value === 'vesper-gold' ? 'vesper-gold' : 'orange');
    select.value = reward.selected;
    onChange();
  });
  row.append(select);
  optionsElement.querySelector('.sl-options__header')?.append(row);
  const refresh = () => {
    gold.disabled = !reward.unlocked;
    gold.textContent = reward.unlocked
      ? 'Vesper Gold'
      : 'Vesper Gold — win Face Off';
    select.value = reward.selected;
  };
  refresh();
  return { refresh };
}
