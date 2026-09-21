import type { TrackInstance } from './trackLayout';

const BUCKETS = 256;
const ANGLE_TO_BUCKET = BUCKETS / (2 * Math.PI);
const STRIDE = 6;
/** One nanometre accommodates roundoff at inclusive transformed box edges. */
const EDGE_EPSILON = 1e-9;

/**
 * Snapshot the rendered boxes' X/Z footprints at track construction.
 * Bounding circles conservatively index angular buckets; the final test is
 * against each oriented rectangle, not an approximate annulus. All storage and
 * trigonometry for box transforms are created here, never in the query path.
 */
export function createKerbFootprintQuery(
  kerbs: readonly TrackInstance[],
): (x: number, z: number) => boolean {
  const boxes = new Float64Array(kerbs.length * STRIDE);
  const buckets: number[][] = Array.from({ length: BUCKETS }, () => []);
  for (let i = 0; i < kerbs.length; i++) {
    const kerb = kerbs[i]!;
    const offset = i * STRIDE;
    const halfX = kerb.size.x / 2 + EDGE_EPSILON;
    const halfZ = kerb.size.z / 2 + EDGE_EPSILON;
    boxes[offset] = kerb.center.x;
    boxes[offset + 1] = kerb.center.z;
    boxes[offset + 2] = Math.cos(kerb.rotY);
    boxes[offset + 3] = Math.sin(kerb.rotY);
    boxes[offset + 4] = halfX;
    boxes[offset + 5] = halfZ;
    const distance = Math.hypot(kerb.center.x, kerb.center.z);
    const radius = Math.hypot(halfX, halfZ);
    if (distance <= radius) {
      for (let bucket = 0; bucket < BUCKETS; bucket++)
        buckets[bucket]!.push(offset);
    } else {
      const angle = Math.atan2(kerb.center.z, kerb.center.x);
      const spread = Math.asin(radius / distance) + 1e-12;
      const first = Math.floor((angle - spread) * ANGLE_TO_BUCKET);
      const last = Math.floor((angle + spread) * ANGLE_TO_BUCKET);
      for (let bucket = first; bucket <= last; bucket++)
        buckets[((bucket % BUCKETS) + BUCKETS) % BUCKETS]!.push(offset);
    }
  }
  return function isOnKerb(x: number, z: number): boolean {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
    const bucket = Math.floor(Math.atan2(z, x) * ANGLE_TO_BUCKET);
    const candidates = buckets[(bucket + BUCKETS) % BUCKETS]!;
    for (let i = 0; i < candidates.length; i++) {
      const offset = candidates[i]!;
      const dx = x - boxes[offset]!;
      const dz = z - boxes[offset + 1]!;
      const cos = boxes[offset + 2]!;
      const sin = boxes[offset + 3]!;
      if (
        Math.abs(cos * dx - sin * dz) <= boxes[offset + 4]! &&
        Math.abs(sin * dx + cos * dz) <= boxes[offset + 5]!
      )
        return true;
    }
    return false;
  };
}
