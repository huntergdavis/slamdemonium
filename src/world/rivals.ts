import type { V3 } from '../physics/adapter';

/** A rival contests the player's line only when they run alongside. The
 * target is a half-lane move through the force controller, never a teleport. */
export function rivalLineTarget(
  position: Readonly<V3>,
  forward: Readonly<V3>,
  player: Readonly<V3>,
): number {
  const dx = player.x - position.x;
  const dz = player.z - position.z;
  const along = dx * forward.x + dz * forward.z;
  const across = dx * forward.z - dz * forward.x;
  if (Math.abs(along) > 32 || Math.abs(across) < 3 || Math.abs(across) > 11)
    return 0;
  return Math.sign(across) * 4.2;
}

export function approachRivalLine(
  current: number,
  target: number,
  dt: number,
): number {
  const step = Math.max(0, dt) * 10;
  return current + Math.max(-step, Math.min(step, target - current));
}

/** Rivals carry their own short boost pulse instead of waiting for the player
 * to use boost. Stable encounter ids stagger the four pulses across the pack. */
export function rivalBoostBonus(seconds: number, encounterId: number): number {
  const phase = (((seconds + encounterId * 1.37) % 6) + 6) % 6;
  return phase < 2.2 ? 28 : 0;
}

/** The nearest shuntable target wins. This includes other rivals; wrecked
 * rivals are excluded by the caller. The controller still eases the resulting
 * lane offset, so targeting never moves a chassis directly. */
export function rivalAttackTarget(
  position: Readonly<V3>,
  forward: Readonly<V3>,
  player: Readonly<V3>,
  opponents: readonly Readonly<V3>[],
): number {
  let target = rivalLineTarget(position, forward, player);
  let closest = target
    ? (player.x - position.x) ** 2 + (player.z - position.z) ** 2
    : Infinity;
  for (const opponent of opponents) {
    if (opponent === position) continue;
    const offset = rivalLineTarget(position, forward, opponent);
    if (!offset) continue;
    const distance =
      (opponent.x - position.x) ** 2 + (opponent.z - position.z) ** 2;
    if (distance < closest) {
      closest = distance;
      target = offset;
    }
  }
  return target;
}

/** A short closing burst converts a side move into a real contact. It only
 * applies to a car ahead within a few body lengths; the force controller
 * limits how quickly the rival can actually gain that speed. */
export function rivalRamSpeedBonus(
  position: Readonly<V3>,
  forward: Readonly<V3>,
  player: Readonly<V3>,
  opponents: readonly Readonly<V3>[],
): number {
  for (let index = -1; index < opponents.length; index++) {
    const target = index < 0 ? player : opponents[index]!;
    if (target === position) continue;
    const dx = target.x - position.x;
    const dz = target.z - position.z;
    const along = dx * forward.x + dz * forward.z;
    const across = dx * forward.z - dz * forward.x;
    if (along > 7 && along < 32 && Math.abs(across) < 11) return 24;
  }
  return 0;
}
