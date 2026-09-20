import type { ParamDef } from '../tuning/schema';

const LOG_STEPS = 1000;

/** Positive spans above 20x, plus mass as explicitly recommended in the visual brief. */
export function usesLogSlider(definition: Readonly<ParamDef>): boolean {
  return (
    !definition.discrete &&
    definition.min > 0 &&
    (definition.max / definition.min > 20 || definition.key === 'mass')
  );
}

export function configureSlider(
  input: HTMLInputElement,
  definition: Readonly<ParamDef>,
): void {
  input.type = 'range';
  input.min = String(
    definition.discrete || usesLogSlider(definition) ? 0 : definition.min,
  );
  input.max = String(
    definition.discrete
      ? definition.discrete.length - 1
      : usesLogSlider(definition)
        ? LOG_STEPS
        : definition.max,
  );
  input.step = String(
    definition.discrete || usesLogSlider(definition) ? 1 : definition.step,
  );
}

export function valueToSlider(
  definition: Readonly<ParamDef>,
  value: number,
): number {
  if (definition.discrete)
    return Math.max(0, definition.discrete.indexOf(value));
  if (!usesLogSlider(definition)) return value;
  return (
    (LOG_STEPS * Math.log(value / definition.min)) /
    Math.log(definition.max / definition.min)
  );
}

export function sliderToValue(
  definition: Readonly<ParamDef>,
  position: number,
): number {
  if (definition.discrete)
    return definition.discrete[Math.round(position)] ?? definition.default;
  if (!usesLogSlider(definition))
    return Math.max(definition.min, Math.min(definition.max, position));
  const value =
    definition.min *
    (definition.max / definition.min) ** (position / LOG_STEPS);
  const snapped =
    definition.min +
    Math.round((value - definition.min) / definition.step) * definition.step;
  return Math.max(
    definition.min,
    Math.min(definition.max, Number(snapped.toPrecision(12))),
  );
}
