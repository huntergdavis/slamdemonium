/** A player wreck owns its slow motion and return to the road. Wall time is
 * advanced only while gameplay is unpaused; simulation time counts fixed steps. */
export const IMPACT_AUTO_SECONDS = 0.8;
export const IMPACT_MAX_WALL_SECONDS = 6;
export const IMPACT_MAX_SIM_SECONDS = 3;
export const IMPACT_TIME_SCALE = 0.4;
export const IMPACT_MAX_ADDED_LATERAL_SPEED = 5;
const LATERAL_ACCELERATION = 6;

export class ImpactTime {
  active = false;
  wallSeconds = 0;
  simulationSeconds = 0;
  private recoveryDue = false;
  private addedLateralSpeed = 0;

  start(): void {
    this.active = true;
    this.wallSeconds = 0;
    this.simulationSeconds = 0;
    this.recoveryDue = false;
    this.addedLateralSpeed = 0;
  }

  get timeScale(): number {
    return this.active ? IMPACT_TIME_SCALE : 1;
  }

  advanceWall(dt: number, held: boolean): void {
    if (!this.active) return;
    this.wallSeconds += Math.max(0, dt);
    if (
      this.wallSeconds >= IMPACT_MAX_WALL_SECONDS ||
      (this.wallSeconds >= IMPACT_AUTO_SECONDS && !held)
    )
      this.finish();
  }

  advanceSimulation(dt: number): void {
    if (!this.active) return;
    this.simulationSeconds += Math.max(0, dt);
    if (this.simulationSeconds >= IMPACT_MAX_SIM_SECONDS) this.finish();
  }

  /** Signed velocity increment for this step; the whole episode adds at most
   * five metres per second of player-directed lateral motion. */
  steerDeltaVelocity(steer: number, dt: number): number {
    if (!this.active || !Number.isFinite(steer) || dt <= 0) return 0;
    const increment = Math.min(
      Math.max(0, IMPACT_MAX_ADDED_LATERAL_SPEED - this.addedLateralSpeed),
      Math.abs(Math.max(-1, Math.min(1, steer))) * LATERAL_ACCELERATION * dt,
    );
    this.addedLateralSpeed += increment;
    return Math.sign(steer) * increment;
  }

  consumeRecovery(): boolean {
    const due = this.recoveryDue;
    this.recoveryDue = false;
    if (due) this.addedLateralSpeed = 0;
    return due;
  }

  reset(): void {
    this.active = false;
    this.wallSeconds = 0;
    this.simulationSeconds = 0;
    this.recoveryDue = false;
    this.addedLateralSpeed = 0;
  }

  private finish(): void {
    this.active = false;
    this.recoveryDue = true;
  }
}
