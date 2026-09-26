/** The raw Jolt hook the probes read when the local, uncommitted line in
 * `src/physics/joltWorld.ts` is present (see README). Typed to what the
 * probes use, nothing more; absent, every reader degrades to -1 / skipped. */
export interface JoltPhysicsSettings {
  mNumVelocitySteps: number;
  mNumPositionSteps: number;
  mTimeBeforeSleep: number;
  mUseManifoldReduction: boolean;
}
export interface JoltProbe {
  physics: {
    GetNumActiveBodies(type: unknown): number;
    GetPhysicsSettings(): JoltPhysicsSettings;
    SetPhysicsSettings(settings: JoltPhysicsSettings): void;
  };
  J: { EBodyType_RigidBody: unknown };
}
export function joltProbe(): JoltProbe | undefined {
  return (globalThis as { __joltProbe?: JoltProbe }).__joltProbe;
}
export function activeBodies(): number {
  const p = joltProbe();
  return p ? p.physics.GetNumActiveBodies(p.J.EBodyType_RigidBody) : -1;
}
