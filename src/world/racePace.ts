/** Circuit-race opponents have an ordinary 50 m/s pace and short, staggered
 * boost pulses. Catch-up may add at most 8 m/s to that moment's target. */
export function racePaceTarget(
  baseSpeed: number,
  playerSpeed: number,
  signedGap: number,
  seconds: number,
  id: number,
): number {
  const phase = (((seconds + id * 1.37) % 7) + 7) % 7;
  const ordinary = baseSpeed + (phase < 1.8 ? 12 : 0);
  const behind = Math.max(0, -signedGap - 40);
  const catchUp = Math.min(
    8,
    Math.max(0, playerSpeed - baseSpeed) * 0.2 + behind * 0.04,
  );
  const easeAhead = Math.min(12, Math.max(0, signedGap - 80) * 0.08);
  return Math.max(18, ordinary + catchUp - easeAhead);
}
