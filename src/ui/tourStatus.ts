import type { TourMedal } from '../core/tourProgress';
import type { TourEvent } from '../world/tourCatalogue';
import './ui.css';

/** One persistent objective, then the mode's validated result. */
export function mountTourStatus(host: HTMLElement, event: TourEvent) {
  const doc = host.ownerDocument;
  const root = doc.createElement('section');
  root.className = 'sl-tour-status';
  root.dataset.phase = 'objective';
  root.setAttribute('aria-live', 'polite');
  const title = doc.createElement('strong');
  title.textContent = `${event.title} · ${event.venue}`;
  const detail = doc.createElement('span');
  detail.textContent = `${event.objective} · ${event.medalTarget}`;
  root.append(title, detail);
  host.append(root);
  return {
    showObjective(): void {
      root.dataset.phase = 'objective';
      detail.textContent = `${event.objective} · ${event.medalTarget}`;
    },
    showResult(medal: TourMedal, unlocked: boolean): void {
      root.dataset.phase = 'result';
      detail.textContent =
        medal === 'none'
          ? 'NO MEDAL · Retry to earn the next event'
          : `${medal.toUpperCase()} EARNED${unlocked ? ' · NEW EVENT UNLOCKED' : ''}`;
    },
    dispose(): void {
      root.remove();
    },
  };
}
