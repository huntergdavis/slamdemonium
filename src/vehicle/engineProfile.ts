/** What makes this engine this engine. Data, not code: a different car is a
 * different profile consumed by the same rpm model, audio worklet and
 * tachometer. Everything here is presentation: the drivetrain (design 6.7.1,
 * one automatic gear) never reads it, so gears cannot change how the car
 * accelerates or brakes. Live-tunable shape (rev lift, exhaust length and
 * feedback, firing unevenness, engine character) lives in the tuning schema
 * instead; these values are identity that a gauge or another system may
 * depend on and that only make sense moved together. */
export interface EngineProfile {
  readonly idleRpm: number;
  /** Upshift when the gear's speed-derived rpm reaches this. */
  readonly shiftRpm: number;
  /** Ceiling without boost; the tachometer's red band starts here. */
  readonly redlineRpm: number;
  /** Ceiling under full boost. */
  readonly boostRpm: number;
  /** Speed (m/s) at which first gear reaches shiftRpm. */
  readonly firstGearSpeed: number;
  /** Each higher gear is this much longer than the one below; the default
   * for the live `gearSpacing` tuning. */
  readonly gearRatio: number;
  readonly gearCount: number;
  /** Downshift below this fraction of the lower gear's upshift speed. */
  readonly downshiftHysteresis: number;
  readonly shiftCooldownSeconds: number;
  /** A shift cuts throttle for this long: an interruption, not a crossfade. */
  readonly shiftCutSeconds: number;
  /** Time constants (s) for rpm following its target, up and down. */
  readonly rpmAttack: number;
  readonly rpmRelease: number;
  /** Time constants (s) for the throttle rev lift, up and down. */
  readonly revLiftAttack: number;
  readonly revLiftRelease: number;
  /** Firing events per crank revolution. */
  readonly firingsPerRevolution: number;
  /** Per-firing strength and spacing over one pattern (eight firings, two
   * crank turns, crossplane-style paired pulses and long gaps). Spacing
   * values average 1; strengths swing 1 to 0.25 for real troughs. */
  readonly firingStrength: readonly number[];
  readonly firingGap: readonly number[];
  /** Exhaust pipe round trip (s), feedback and radiation-loss corner (Hz);
   * then the shorter non-inverting muffler section. */
  readonly pipeSeconds: number;
  readonly pipeFeedback: number;
  readonly pipeLossHz: number;
  readonly mufflerSeconds: number;
  readonly mufflerFeedback: number;
  readonly mufflerLossHz: number;
}

export const DEFAULT_ENGINE: EngineProfile = {
  idleRpm: 900,
  shiftRpm: 6850,
  redlineRpm: 7135,
  boostRpm: 8585,
  // Four gears spaced 1.8 apart: upshifts at 12, 21.6 and 38.9 m/s, so each
  // gear lasts long enough to hear the note climb (about 1, 1, 2 seconds and
  // then top gear to top speed without pinning). Five gears at 1.5 blurred
  // past: gear four by 117 km/h within five seconds of a standing start.
  firstGearSpeed: 12,
  gearRatio: 1.8,
  gearCount: 4,
  downshiftHysteresis: 0.8,
  shiftCooldownSeconds: 0.4,
  shiftCutSeconds: 0.15,
  rpmAttack: 0.08,
  rpmRelease: 0.16,
  revLiftAttack: 0.03,
  revLiftRelease: 0.1,
  firingsPerRevolution: 2,
  firingStrength: [1, 0.3, 0.85, 0.5, 0.7, 0.25, 0.45, 0.35],
  firingGap: [1.4, 0.6, 1.25, 0.75, 1.1, 0.9, 1.35, 0.65],
  pipeSeconds: 0.009,
  pipeFeedback: 0.72,
  pipeLossHz: 1400,
  mufflerSeconds: 0.0031,
  mufflerFeedback: 0.42,
  mufflerLossHz: 900,
};
