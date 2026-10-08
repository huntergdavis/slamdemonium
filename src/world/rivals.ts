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
  if (Math.abs(along) > 18 || Math.abs(across) < 3 || Math.abs(across) > 11)
    return 0;
  return Math.sign(across) * 4.2;
}

export function approachRivalLine(
  current: number,
  target: number,
  dt: number,
): number {
  const step = Math.max(0, dt) * 6;
  return current + Math.max(-step, Math.min(step, target - current));
}
