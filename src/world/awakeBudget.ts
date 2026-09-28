import type { BodyId, IPhysicsWorld, V3 } from '../physics/adapter';
import type { BreakableProps } from './breakableProps';

/** The step-time budget for the smash route: how many props and fragments
 * may be AWAKE at once. Measured 2026-09-25
 * (docs/research/ns2-physics-ceiling.md): every awake body costs about
 * 17 us a step separated and 30 to 40 us in contact, sleeping bodies cost
 * nothing, and a 128-body pileup under the car ran 7 ms p99 for two to
 * three seconds. This bounds that.
 *
 * How, and why this shape (measured 2026-09-27, see DECISIONS): Jolt wakes
 * a sleeping body the moment an awake body touches it, so sleeping only
 * the few farthest bodies of a live heap, a shell one body thick, is undone
 * the next step; at a budget of 96 that left 97 awake for the whole run
 * and stopped the heap ever settling. What sticks is a block: when more
 * bodies are awake than the budget, everything still beyond the keep
 * radius goes to sleep in place together, and the crash inside the keep
 * radius plays out untouched. Bodies still moving hard are left awake
 * until they slow, so nothing freezes in flight.
 * The budget is therefore the trigger and the keep radius the survivor;
 * both are sliders (awakeBudget, awakeKeepRadius), the CTO's to tune. The
 * car is exempt and outside its reach. Nothing here creates or destroys a
 * body. */
export interface AwakeBudgetOptions {
  readonly physics: Pick<
    IPhysicsWorld,
    | 'awakeBodyCount'
    | 'isBodyAwake'
    | 'sleepBody'
    | 'getTransform'
    | 'getLinearVelocity'
  >;
  readonly props: Pick<
    BreakableProps,
    | 'copyActivePropIds'
    | 'copyActiveFragmentIds'
    | 'propCapacity'
    | 'fragmentCapacity'
    | 'propHalfExtents'
    | 'fragmentHalfExtents'
  >;
  readonly readVehiclePosition: (out: V3) => void;
  /** Bodies awake that are not props or fragments: the car. */
  readonly exemptBodies?: number;
  /** Bodies still moving faster than this (m/s) are left awake: a box in
   * flight or rolling hard is not frozen; it sleeps once it slows. Height
   * is no test of that, a box resting on another box is as still as one on
   * the ground. Infinity freezes everything beyond the keep radius. */
  readonly exemptFasterThan?: number | undefined;
}

export interface AwakeBudget {
  /** Once per physics step, after the step. Returns how many bodies it put
   * to sleep. O(1) while under budget. */
  update(budget: number, keepRadius: number): number;
  /** Awake props and fragments at the last update. */
  readonly awake: number;
  /** Bodies put to sleep at the last update, and the nearest one's distance. */
  readonly slept: number;
  readonly nearestSleptDistance: number;
}

export function createAwakeBudget(options: AwakeBudgetOptions): AwakeBudget {
  const { physics, props } = options;
  const exempt = options.exemptBodies ?? 1;
  const ids = new Float64Array(props.propCapacity + props.fragmentCapacity);
  const still = new Uint8Array(ids.length);
  const distance = new Float64Array(ids.length);
  const exemptFasterThan = options.exemptFasterThan ?? 3;
  const car: V3 = { x: 0, y: 0, z: 0 };
  const pos: V3 = { x: 0, y: 0, z: 0 };
  const vel: V3 = { x: 0, y: 0, z: 0 };
  const quat = { x: 0, y: 0, z: 0, w: 1 };
  const fastSquared = exemptFasterThan * exemptFasterThan;
  let awake = 0;
  let slept = 0;
  let nearestSleptDistance = Infinity;

  function collect(): number {
    const propCount = props.copyActivePropIds(ids);
    const fragmentCount = props.copyActiveFragmentIds(ids.subarray(propCount));
    options.readVehiclePosition(car);
    let count = 0;
    for (let i = 0; i < propCount + fragmentCount; i++) {
      const id = ids[i]! as BodyId;
      if (!physics.isBodyAwake(id)) continue;
      physics.getTransform(id, pos, quat);
      physics.getLinearVelocity(id, vel);
      const dx = pos.x - car.x;
      const dz = pos.z - car.z;
      ids[count] = id;
      distance[count] = Math.sqrt(dx * dx + dz * dz);
      still[count] =
        vel.x * vel.x + vel.y * vel.y + vel.z * vel.z <= fastSquared ? 1 : 0;
      count++;
    }
    return count;
  }

  return {
    get awake() {
      return awake;
    },
    get slept() {
      return slept;
    },
    get nearestSleptDistance() {
      return nearestSleptDistance;
    },
    update(budget, keepRadius) {
      slept = 0;
      nearestSleptDistance = Infinity;
      const limit = Number.isFinite(budget)
        ? Math.max(0, Math.floor(budget))
        : 0;
      // O(1) gate: only count when Jolt says something may be over.
      const total = physics.awakeBodyCount() - exempt;
      if (total <= limit) {
        awake = Math.max(0, total);
        return 0;
      }
      const count = collect();
      awake = count;
      if (count <= limit) return 0;
      for (let i = 0; i < count; i++) {
        if (still[i] === 0 || distance[i]! <= keepRadius) continue;
        physics.sleepBody(ids[i]! as BodyId);
        slept++;
        if (distance[i]! < nearestSleptDistance)
          nearestSleptDistance = distance[i]!;
      }
      return slept;
    },
  };
}
