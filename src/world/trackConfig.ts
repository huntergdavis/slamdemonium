/** World defaults from design 9 and docs/design/visual-direction.md. SI units. */
export interface TrackConfig {
  pavedRadius: number;
  ringInnerRadius: number;
  centerLineRadius: number;
  groundExtent: number;
  groundThickness: number;
  circleSegments: number;
  edgeWidth: number;
  centerLineWidth: number;
  dashLength: number;
  dashGap: number;
  tickDegrees: number;
  tickLength: number;
  tickWidth: number;
  tickInset: number;
  curbLength: number;
  curbWidth: number;
  curbHeight: number;
  curbClearance: number;
  postSpacing: number;
  postWidth: number;
  postHeight: number;
  innerPostOffset: number;
  outerPostOffset: number;
  barrierInnerRadius: number;
  barrierThickness: number;
  barrierHeight: number;
  barrierSegments: number;
  wallFriction: number;
  restitution: number;
  surfaceId: number;
  skidpadRadii: readonly number[];
  skidpadWidth: number;
  paintHeight: number;
  tileMeters: number;
  fogDensity: number;
  killY: number;
  spawnHeight: number;
}
export const DEFAULT_TRACK_CONFIG: Readonly<TrackConfig> = Object.freeze({
  pavedRadius: 150,
  ringInnerRadius: 110,
  centerLineRadius: 130,
  groundExtent: 1000,
  groundThickness: 1,
  circleSegments: 720,
  edgeWidth: 0.18,
  centerLineWidth: 0.16,
  dashLength: 3,
  dashGap: 6,
  tickDegrees: 10,
  tickLength: 1.2,
  tickWidth: 0.16,
  tickInset: 0.15,
  curbLength: 2,
  curbWidth: 0.6,
  curbHeight: 0.06,
  curbClearance: 0.1,
  postSpacing: 12,
  postWidth: 0.16,
  postHeight: 1.2,
  innerPostOffset: 2,
  outerPostOffset: 1,
  barrierInnerRadius: 152,
  barrierThickness: 2,
  barrierHeight: 1,
  barrierSegments: 128,
  wallFriction: 0.05,
  restitution: 0.25,
  surfaceId: 0,
  skidpadRadii: Object.freeze([15, 30]),
  skidpadWidth: 0.12,
  paintHeight: 0.005,
  tileMeters: 8,
  fogDensity: 0.0025,
  killY: -50,
  spawnHeight: 0.86,
});

export function resolveTrackConfig(
  overrides: Partial<TrackConfig> = {},
): Readonly<TrackConfig> {
  const config = { ...DEFAULT_TRACK_CONFIG, ...overrides };
  for (const [key, value] of Object.entries(config)) {
    if (typeof value === 'number' && !Number.isFinite(value))
      throw new RangeError(key + ' must be finite');
  }
  for (const key of [
    'pavedRadius',
    'ringInnerRadius',
    'centerLineRadius',
    'groundExtent',
    'groundThickness',
    'circleSegments',
    'edgeWidth',
    'centerLineWidth',
    'dashLength',
    'dashGap',
    'tickDegrees',
    'tickLength',
    'tickWidth',
    'curbLength',
    'curbWidth',
    'curbHeight',
    'postSpacing',
    'postWidth',
    'postHeight',
    'barrierThickness',
    'barrierHeight',
    'barrierSegments',
    'tileMeters',
    'spawnHeight',
  ] as const) {
    if (config[key] <= 0) throw new RangeError(key + ' must be positive');
  }
  if (!(
    config.ringInnerRadius < config.centerLineRadius &&
    config.centerLineRadius < config.pavedRadius &&
    config.pavedRadius < config.barrierInnerRadius &&
    config.barrierInnerRadius + config.barrierThickness < config.groundExtent
  ))
    throw new RangeError(
      'Track radii must be nested inside the surrounding ground',
    );
  if (
    !Number.isInteger(config.circleSegments) ||
    config.circleSegments < 32 ||
    !Number.isInteger(config.barrierSegments) ||
    config.barrierSegments < 8
  )
    throw new RangeError(
      'Circle/barrier segment counts must be integers (minimum 32/8)',
    );
  if (
    config.tickDegrees > 180 ||
    Math.abs(360 / config.tickDegrees - Math.round(360 / config.tickDegrees)) >
      1e-8
  )
    throw new RangeError('tickDegrees must divide 360');
  if (
    config.killY >= 0 ||
    config.fogDensity < 0 ||
    config.wallFriction < 0 ||
    config.restitution < 0 ||
    config.restitution > 1
  )
    throw new RangeError('Invalid kill plane, fog or contact coefficients');
  if (
    config.skidpadRadii.some(
      (radius) =>
        !Number.isFinite(radius) ||
        radius <= 0 ||
        radius >= config.ringInnerRadius,
    )
  )
    throw new RangeError('Skidpad circles must lie inside the infield');
  if (
    [
      config.tickInset,
      config.curbClearance,
      config.innerPostOffset,
      config.outerPostOffset,
      config.paintHeight,
    ].some((value) => value < 0)
  )
    throw new RangeError('Offsets must be nonnegative');
  if (
    config.innerPostOffset >= config.ringInnerRadius ||
    config.pavedRadius + config.outerPostOffset + config.postWidth / 2 >=
      config.barrierInnerRadius
  )
    throw new RangeError('Posts must stay between the infield and barrier');
  if (
    config.ringInnerRadius <= config.curbClearance + config.curbWidth ||
    config.pavedRadius + config.curbClearance + config.curbWidth >=
      config.barrierInnerRadius
  )
    throw new RangeError('Curbs must fit beside ring edges');
  if (!Number.isInteger(config.surfaceId) || config.surfaceId < 0)
    throw new RangeError('surfaceId must be a nonnegative integer');
  return Object.freeze({
    ...config,
    skidpadRadii: Object.freeze([...config.skidpadRadii]),
  });
}
