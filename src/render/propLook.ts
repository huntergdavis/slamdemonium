import { MeshStandardMaterial } from 'three';
import type { Material } from 'three';

/** The two independent controls of the small-prop visibility prototype.
 * Measured before this existed (2026-09-24): a 1 m prop is drawn at every
 * distance but its camera-facing side is in the sun's shade, so it rendered
 * dark brown on dark asphalt, contrast 0.28 at 70 m and 0.01 at 112 m, 3 to
 * 5 pixels tall; a human picks it out only from about 50 to 60 m. Glow lifts
 * the contrast, the impostor lifts the pixels; the target is contrast above
 * 0.3 and 4 or more pixels at about 150 m. */

/** Self-light as a fraction of the base colour; applied identically to the
 * near (physics) and far (streamed) prop materials so the swap between them
 * stays invisible. */
export function applyPropGlow(material: Material, glow: number): void {
  if (!(material instanceof MeshStandardMaterial)) return;
  const value = Math.min(1, Math.max(0, glow));
  material.emissive.copy(material.color);
  material.emissiveIntensity = value;
}

/** Larger-than-life factor for a far prop at `distance`: true size at or
 * inside `nearRadius` (the physics promotion radius, so the swap is size
 * matched), `farScale` at or beyond `farRadius`, linear between. */
export function impostorScale(
  distance: number,
  farScale: number,
  nearRadius: number,
  farRadius: number,
): number {
  if (!(farScale > 1) || !(farRadius > nearRadius)) return 1;
  if (distance <= nearRadius) return 1;
  if (distance >= farRadius) return farScale;
  return (
    1 + ((farScale - 1) * (distance - nearRadius)) / (farRadius - nearRadius)
  );
}

/** The honest statement of the lie, for the record and the driver. */
export function describeImpostor(
  farScale: number,
  nearRadius: number,
  farRadius: number,
): string {
  return farScale > 1
    ? `true size inside ${nearRadius} m, ${farScale.toFixed(1)}x at ${farRadius} m and beyond, linear between`
    : 'true size everywhere';
}
