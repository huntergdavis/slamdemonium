/** The prize belongs to this opponent on this route, not to any generic race win. */
import type { RaceState } from './raceEvent';
export const FACE_OFF_REWARD_KEY = 'slamdemonium.face-off.circuit-vesper.v1';
export type FaceOffPaint = 'orange' | 'vesper-gold';

export function createFaceOffReward(
  storage: Pick<Storage, 'getItem' | 'setItem'> | null,
) {
  let unlocked = false;
  let selected: FaceOffPaint = 'orange';
  try {
    const saved = storage?.getItem(FACE_OFF_REWARD_KEY);
    if (saved) {
      const data: unknown = JSON.parse(saved);
      if (
        data &&
        typeof data === 'object' &&
        'unlocked' in data &&
        (data as { unlocked: unknown }).unlocked === true
      ) {
        unlocked = true;
        selected =
          (data as { selected?: unknown }).selected === 'vesper-gold'
            ? 'vesper-gold'
            : 'orange';
      }
    }
  } catch {
    /* Session-only reward if storage is blocked or malformed. */
  }
  function persist(): void {
    try {
      storage?.setItem(
        FACE_OFF_REWARD_KEY,
        JSON.stringify({ unlocked, selected }),
      );
    } catch {
      /* Preserve the current session's prize. */
    }
  }
  return {
    get unlocked() {
      return unlocked;
    },
    get selected() {
      return selected;
    },
    unlock(): boolean {
      if (unlocked) return false;
      unlocked = true;
      persist();
      return true;
    },
    select(paint: FaceOffPaint): boolean {
      if (paint === 'vesper-gold' && !unlocked) return false;
      selected = paint;
      persist();
      return true;
    },
  };
}

export function awardFaceOffWin(
  race: Readonly<RaceState>,
  reward: ReturnType<typeof createFaceOffReward>,
): boolean {
  return race.phase === 'finished' &&
    race.fieldSize === 2 &&
    race.position === 1
    ? reward.unlock()
    : false;
}
