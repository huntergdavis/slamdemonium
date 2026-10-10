export type EliminatorMedal = 'none' | 'bronze' | 'silver' | 'gold';

/** A cut the player loses on does not count as one they survived. */
export function eliminatorMedal(
  survivedCuts: number,
  won: boolean,
): EliminatorMedal {
  if (won) return 'gold';
  if (survivedCuts >= 4) return 'silver';
  if (survivedCuts >= 2) return 'bronze';
  return 'none';
}
