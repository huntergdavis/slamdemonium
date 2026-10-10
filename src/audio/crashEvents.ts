import type { AudioOutput, CrashCue, CrashKind, CrashTier } from './types';

const EVENTS = 32;
const PAIRS = 32;
const GRINDS = 8;
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const tier = (speed: number): CrashTier =>
  speed < 3.5 ? 'light' : speed < 9 ? 'medium' : 'hard';

/** Contact callbacks only copy numbers into fixed storage. Sample selection,
 * spatial placement and all Web Audio work happen when flush() runs in RAF. */
export class CrashEvents {
  get hasPriorityEvent(): boolean {
    return this.count > 0 || this.takedown || this.wreck;
  }
  private time = 0;
  private count = 0;
  private readonly speed = new Float32Array(EVENTS);
  private readonly x = new Float32Array(EVENTS);
  private readonly z = new Float32Array(EVENTS);
  private readonly kind = new Uint8Array(EVENTS);
  private readonly glass = new Uint8Array(EVENTS);
  private readonly pairA = new Float64Array(PAIRS).fill(-1);
  private readonly pairB = new Float64Array(PAIRS).fill(-1);
  private readonly pairAt = new Float64Array(PAIRS).fill(-Infinity);
  private pairCursor = 0;
  private readonly grindA = new Float64Array(GRINDS).fill(-1);
  private readonly grindB = new Float64Array(GRINDS).fill(-1);
  private readonly grindStart = new Float64Array(GRINDS).fill(-Infinity);
  private readonly grindAt = new Float64Array(GRINDS).fill(-Infinity);
  private readonly grindSlip = new Float32Array(GRINDS);
  private grindCursor = 0;
  private readonly grindLevels = new Float64Array(2);
  private duckLeft = 0;
  private duckTarget = 1;
  private duckNow = 1;
  private takedown = false;
  private wreck = false;

  /** kind: 0 player/traffic, 1 player/world, 2 distant traffic/world. */
  noteContact(
    a: number,
    b: number,
    closing: number,
    tangent: number,
    x: number,
    z: number,
    kind: 0 | 1 | 2,
    glassEligible: boolean,
  ): boolean {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return true;
    if (kind !== 2 && tangent >= 2) this.noteGrind(a, b, tangent);
    if (!(closing >= (kind === 2 ? 1.5 : 0.25))) return true;
    let slot = -1;
    for (let i = 0; i < PAIRS; i++) {
      if (this.pairA[i] === a && this.pairB[i] === b) {
        slot = i;
        break;
      }
    }
    if (slot >= 0 && this.time - this.pairAt[slot]! < 0.14) return true;
    if (slot < 0) {
      slot = this.pairCursor;
      this.pairCursor = (slot + 1) % PAIRS;
    }
    this.pairA[slot] = a;
    this.pairB[slot] = b;
    this.pairAt[slot] = this.time;
    if (this.count === EVENTS) return false;
    this.speed[this.count] = closing;
    this.x[this.count] = x;
    this.z[this.count] = z;
    this.kind[this.count] = kind;
    this.glass[this.count] = glassEligible ? 1 : 0;
    this.count++;
    return true;
  }

  private noteGrind(a: number, b: number, slip: number): void {
    let slot = -1;
    for (let i = 0; i < GRINDS; i++) {
      if (this.grindA[i] === a && this.grindB[i] === b) {
        slot = i;
        break;
      }
    }
    if (slot < 0) {
      slot = this.grindCursor;
      this.grindCursor = (slot + 1) % GRINDS;
      this.grindA[slot] = a;
      this.grindB[slot] = b;
      this.grindStart[slot] = this.time;
    } else if (this.time - this.grindAt[slot]! > 0.08) {
      this.grindStart[slot] = this.time;
    }
    this.grindAt[slot] = this.time;
    this.grindSlip[slot] = slip;
  }

  noteTakedown(): void {
    this.takedown = true;
    this.duckLeft = Math.max(this.duckLeft, 0.65);
    this.duckTarget = 0.52;
  }
  notePlayerWreck(): void {
    this.wreck = true;
    this.duckLeft = Math.max(this.duckLeft, 1.5);
    this.duckTarget = 0.5;
  }
  afterStep(dt: number): void {
    this.time += Math.max(0, dt);
  }
  /** Returns the engine/continuous gain before AudioOutput.apply(). */
  duck(dt: number): number {
    this.duckLeft = Math.max(0, this.duckLeft - dt);
    const target = this.duckLeft > 0 ? this.duckTarget : 1;
    this.duckNow +=
      (target - this.duckNow) *
      (1 - Math.exp(-dt / (target < this.duckNow ? 0.035 : 0.18)));
    return this.duckNow;
  }

  flush(
    output: AudioOutput,
    volume: number,
    rate: number,
    dt: number,
    playerX: number,
    playerZ: number,
    rightX: number,
    rightZ: number,
    audible: boolean,
  ): void {
    if (audible && output.state.status === 'ready') {
      if (this.takedown)
        output.playCrash({
          tier: 'hard',
          kind: 'takedown',
          gain: volume * 0.58,
          rate,
          pan: 0,
          glass: false,
          debris: true,
        });
      if (this.wreck)
        output.playCrash({
          tier: 'hard',
          kind: 'wreck',
          gain: volume * 0.48,
          rate,
          pan: 0,
          glass: false,
          debris: true,
        });
      // Nearby/player effects take scarce transient voices before AI pileups.
      for (let priority = 0; priority < 2; priority++)
        for (let i = 0; i < this.count; i++) {
          const closing = this.speed[i]!;
          const distant = this.kind[i] === 2;
          if (Number(distant) !== priority) continue;
          const dx = this.x[i]! - playerX;
          const dz = this.z[i]! - playerZ;
          const distance = Math.hypot(dx, dz);
          if (distant && distance > 180) continue;
          const attenuation = distant ? 0.5 / (1 + (distance / 35) ** 2) : 1;
          const kind: CrashKind = distant
            ? 'distant'
            : this.kind[i] === 1
              ? 'wall'
              : 'contact';
          const side =
            distance > 0.1 ? (dx * rightX + dz * rightZ) / distance : 0;
          const cue: CrashCue = {
            tier: tier(closing),
            kind,
            gain:
              volume * attenuation * (0.18 + 0.5 * clamp((closing - 0.8) / 18)),
            rate,
            pan: Math.max(-1, Math.min(1, side)),
            glass: !distant && this.glass[i] === 1 && closing >= 10,
            debris: closing >= 9,
          };
          output.playCrash(cue);
        }
    }
    this.count = 0;
    this.takedown = this.wreck = false;
    let first = -1;
    let second = -1;
    for (let i = 0; i < GRINDS; i++) {
      if (
        this.time - this.grindAt[i]! > 0.075 ||
        this.time - this.grindStart[i]! < 0.08
      )
        continue;
      if (first < 0 || this.grindSlip[i]! > this.grindSlip[first]!) {
        second = first;
        first = i;
      } else if (second < 0 || this.grindSlip[i]! > this.grindSlip[second]!)
        second = i;
    }
    for (let outputSlot = 0; outputSlot < 2; outputSlot++) {
      const source = outputSlot === 0 ? first : second;
      const target =
        audible && source >= 0
          ? volume * (0.09 + 0.27 * clamp((this.grindSlip[source]! - 2) / 18))
          : 0;
      const current = this.grindLevels[outputSlot]!;
      const next =
        current +
        (target - current) *
          (1 - Math.exp(-dt / (target > current ? 0.04 : 0.13)));
      this.grindLevels[outputSlot] = next;
      output.setGrind(
        outputSlot as 0 | 1,
        next < 0.002 ? 0 : next,
        rate *
          (source >= 0
            ? 0.82 + Math.min(0.5, this.grindSlip[source]! / 25)
            : 1),
        0,
      );
    }
  }

  reset(): void {
    this.count = 0;
    this.time = 0;
    this.pairA.fill(-1);
    this.pairB.fill(-1);
    this.pairAt.fill(-Infinity);
    this.grindA.fill(-1);
    this.grindB.fill(-1);
    this.grindAt.fill(-Infinity);
    this.grindLevels.fill(0);
    this.takedown = this.wreck = false;
    this.duckLeft = 0;
    this.duckTarget = this.duckNow = 1;
  }
}
