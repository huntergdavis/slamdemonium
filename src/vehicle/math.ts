export function clamp(x: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, x));
}
export function moveToward(
  value: number,
  target: number,
  amount: number,
): number {
  return value + clamp(target - value, -amount, amount);
}
export function smoothstep(low: number, high: number, value: number): number {
  const t = clamp((value - low) / (high - low), 0, 1);
  return t * t * (3 - 2 * t);
}
export function wrapPi(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}
