import type { ImpactSeverity } from './impactSeverity';

/** Everything that reacts to an impact, fed from one place. */
export interface ImpactConsumers<Profile> {
  readonly camera: { addImpact(impact: Readonly<ImpactSeverity>): void };
  readonly haptics: { onImpact(impact: Readonly<ImpactSeverity>): void };
  readonly audio: {
    onImpact(
      otherBodyId: number,
      profile: Profile | null,
      impact: Readonly<ImpactSeverity>,
    ): void;
  };
}

/** The single fan-out for impact feedback, with the per-step seam between the
 * two sources that can describe the same event. A chassis-ground contact
 * during a hard landing arrives through the physics contact callback AND the
 * landing counter in the same step; the contact is the more specific report,
 * so a landing only fires when no contact already did this step. Boot calls
 * `endStep` once per physics step. Allocation free. */
export class ImpactFeedback<Profile> {
  private contactsThisStep = 0;

  constructor(private readonly consumers: ImpactConsumers<Profile>) {}

  /** From the physics contact callback, inside the step: always fires. */
  onContact(
    otherBodyId: number,
    profile: Profile | null,
    impact: Readonly<ImpactSeverity>,
  ): void {
    this.contactsThisStep++;
    this.consumers.camera.addImpact(impact);
    this.consumers.haptics.onImpact(impact);
    this.consumers.audio.onImpact(otherBodyId, profile, impact);
  }

  /** After the step, for a counted landing: fires unless a contact already
   * reported this step. Returns whether it fired. */
  onLanding(
    groundBodyId: number,
    profile: Profile | null,
    impact: Readonly<ImpactSeverity>,
  ): boolean {
    if (this.contactsThisStep > 0) return false;
    this.consumers.camera.addImpact(impact);
    this.consumers.haptics.onImpact(impact);
    this.consumers.audio.onImpact(groundBodyId, profile, impact);
    return true;
  }

  /** Once per physics step, after landings have been considered. */
  endStep(): void {
    this.contactsThisStep = 0;
  }
}
