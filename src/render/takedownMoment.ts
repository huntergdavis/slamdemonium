import { PerspectiveCamera, Quaternion, Vector3 } from 'three';
import type { V3 } from '../physics/adapter';
import type { TrafficCarState } from '../world/traffic';

/** Wall time, not slowed simulation time: the player regains the chase view promptly. */
export const TAKEDOWN_MOMENT_MS = 750;
const SLOW_MS = 450;
const SLOW_SCALE = 0.4;
const MAX_FOCUS_DISTANCE = 60;

/** Keep the camera on an immediate, nearby wreck in the player's forward view. */
export function canFocusTakedown(
  victim: Readonly<TrafficCarState>,
  player: Readonly<V3>,
  playerForward: Readonly<Pick<V3, 'x' | 'z'>>,
): boolean {
  const dx = victim.position.x - player.x;
  const dz = victim.position.z - player.z;
  return (
    dx * dx + dz * dz <= MAX_FOCUS_DISTANCE * MAX_FOCUS_DISTANCE &&
    dx * playerForward.x + dz * playerForward.z >= 0
  );
}

/** Short visual focus on a wreck, leaving the physics and camera rig unchanged. */
export class TakedownMoment {
  private startedMs = -Infinity;
  private victimId = -1;
  private readonly normalRotation = new Quaternion();
  private readonly focusRotation = new Quaternion();
  private readonly normalUp = new Vector3();
  private readonly normalPosition = new Vector3();
  private readonly focus = new Vector3();
  private readonly focusPosition = new Vector3();

  start(victimId: number, nowMs: number): void {
    this.victimId = victimId;
    this.startedMs = nowMs;
  }

  get timeScale(): number {
    return this.timeScaleAt(performance.now());
  }

  timeScaleAt(nowMs: number): number {
    const elapsed = nowMs - this.startedMs;
    if (elapsed < 0 || elapsed >= TAKEDOWN_MOMENT_MS) return 1;
    if (elapsed <= SLOW_MS) return SLOW_SCALE;
    return (
      SLOW_SCALE +
      (1 - SLOW_SCALE) * ((elapsed - SLOW_MS) / (TAKEDOWN_MOMENT_MS - SLOW_MS))
    );
  }

  apply(
    camera: PerspectiveCamera,
    cars: readonly TrafficCarState[],
    player: Readonly<V3>,
    playerForward: Readonly<Pick<V3, 'x' | 'z'>>,
    nowMs: number,
  ): void {
    const elapsed = nowMs - this.startedMs;
    if (elapsed < 0 || elapsed >= TAKEDOWN_MOMENT_MS) return;
    const victim = cars.find((car) => car.id === this.victimId);
    if (!victim || !canFocusTakedown(victim, player, playerForward)) {
      this.reset();
      return;
    }
    const progress = elapsed / TAKEDOWN_MOMENT_MS;
    const weight = 0.85 * Math.sin(Math.PI * progress);
    if (weight <= 0) return;
    const forward = victim.forward;
    this.focus.set(
      victim.position.x,
      victim.position.y + 0.8,
      victim.position.z,
    );
    this.focusPosition.set(
      victim.position.x - forward.x * 8 - forward.z * 5,
      victim.position.y + 4,
      victim.position.z - forward.z * 8 + forward.x * 5,
    );
    this.normalRotation.copy(camera.quaternion);
    this.normalUp.copy(camera.up);
    this.normalPosition.copy(camera.position);
    camera.up.set(0, 1, 0);
    camera.position.copy(this.focusPosition);
    camera.lookAt(this.focus);
    this.focusRotation.copy(camera.quaternion);
    camera.up.copy(this.normalUp);
    // The rig restores its ordinary chase pose each render before this blend.
    camera.position.copy(this.normalPosition).lerp(this.focusPosition, weight);
    camera.quaternion
      .copy(this.normalRotation)
      .slerp(this.focusRotation, weight);
  }

  reset(): void {
    this.startedMs = -Infinity;
    this.victimId = -1;
  }
}
