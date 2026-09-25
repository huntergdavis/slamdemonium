import {
  BoxGeometry,
  Group,
  InstancedMesh,
  MeshStandardMaterial,
  Object3D,
} from 'three';
import { BREAKABLE_PROP_COLOR } from './breakablePropsVisual';
import { applyPropGlow, impostorScale } from './propLook';
import type { Material, Scene } from 'three';
import type { PropStreamer } from '../world/propStreaming';

export interface StreamedPropVisual {
  update(): void;
  /** Self-light, matched to the near props. */
  setGlow(glow: number): void;
  /** Larger-than-life factor at and beyond the far radius; 1 is honest. */
  setFarScale(scale: number): void;
  dispose(): void;
}

export interface StreamedPropVisualOptions {
  /** Where the driver is, for the distance-based impostor scale. */
  readonly readViewPosition?: (out: {
    x: number;
    y: number;
    z: number;
  }) => void;
  /** Props are true size inside this (the physics promotion radius). */
  readonly nearRadius?: number;
  /** Full impostor scale from here outward. */
  readonly farRadius?: number;
}
export const IMPOSTOR_NEAR_RADIUS = 90;
export const IMPOSTOR_FAR_RADIUS = 200;

/** Cheap far-field representation; promoted bodies are hidden to avoid a
 * duplicate while the pooled physics visual owns their live transform. */
export function createStreamedPropVisual(
  scene: Scene,
  streamer: PropStreamer,
  halfExtents: Readonly<{ x: number; y: number; z: number }>,
  material: Material,
  options: StreamedPropVisualOptions = {},
): StreamedPropVisual {
  const nearRadius = options.nearRadius ?? IMPOSTOR_NEAR_RADIUS;
  const farRadius = options.farRadius ?? IMPOSTOR_FAR_RADIUS;
  let farScale = 1;
  const view = { x: 0, y: 0, z: 0 };
  // Last written scale per record, so a frame only rewrites instances whose
  // impostor size moved by more than two percent. 256 records today; a
  // cell-limited scan is the phase-two path if this ever runs at thousands.
  const written = new Float32Array(streamer.records.length);
  const root = new Group();
  root.name = 'streamed-props.far';
  const geometry = new BoxGeometry(1, 1, 1);
  // Same colour as the promoted prop: the far representation must be the
  // near one at a distance, or the streaming radius becomes a visible edge.
  const farMaterial = material.clone();
  if (farMaterial instanceof MeshStandardMaterial)
    farMaterial.color.setHex(BREAKABLE_PROP_COLOR);
  const mesh = new InstancedMesh(
    geometry,
    farMaterial,
    streamer.records.length,
  );
  mesh.frustumCulled = false;
  root.add(mesh);
  scene.add(root);
  const transform = new Object3D();
  const hidden = new Object3D();
  hidden.scale.set(0, 0, 0);
  hidden.updateMatrix();
  // Far records are authored poses, so their matrices are immutable. The
  // streamer queues only promotion/demotion/destroyed transitions; after the
  // initial upload this avoids scanning thousands of records every frame.
  const farChanges = new Int32Array(streamer.records.length);
  let initialized = false;
  let disposed = false;

  function scaleFor(index: number): number {
    const record = streamer.records[index]!;
    const distance = Math.hypot(
      record.position.x - view.x,
      record.position.z - view.z,
    );
    return impostorScale(distance, farScale, nearRadius, farRadius);
  }

  function writeFar(index: number): void {
    const record = streamer.records[index];
    if (!record || !streamer.isFarVisible(index)) {
      mesh.setMatrixAt(index, hidden.matrix);
      written[index] = 0;
      return;
    }
    const scale = scaleFor(index);
    written[index] = scale;
    transform.scale.set(
      halfExtents.x * 2 * scale,
      halfExtents.y * 2 * scale,
      halfExtents.z * 2 * scale,
    );
    // Grow from the ground up: the base stays put, the box gets taller.
    transform.position.set(
      record.position.x,
      record.position.y + halfExtents.y * (scale - 1),
      record.position.z,
    );
    transform.quaternion.set(
      record.rotation.x,
      record.rotation.y,
      record.rotation.z,
      record.rotation.w,
    );
    // An Object3D outside the scene never recomputes its matrix on its own:
    // without this every far record was uploaded with the construction
    // matrix and drawn at the world origin, so props appeared from nothing
    // at the 90 m promotion radius.
    transform.updateMatrix();
    mesh.setMatrixAt(index, transform.matrix);
  }

  function update(): void {
    if (disposed) return;
    let changed = false;
    options.readViewPosition?.(view);
    if (!initialized) {
      for (let index = 0; index < streamer.records.length; index++)
        writeFar(index);
      initialized = true;
      changed = true;
    } else {
      const count = streamer.copyFarVisibilityChanges(farChanges);
      for (let index = 0; index < count; index++) {
        writeFar(farChanges[index]!);
        changed = true;
      }
      if (farScale > 1)
        for (let index = 0; index < streamer.records.length; index++) {
          const last = written[index]!;
          if (last === 0) continue; // Hidden.
          const next = scaleFor(index);
          if (Math.abs(next - last) > 0.02 * last) {
            writeFar(index);
            changed = true;
          }
        }
    }
    if (changed) mesh.instanceMatrix.needsUpdate = true;
  }

  update();
  return {
    update,
    setGlow(glow: number): void {
      if (!disposed) applyPropGlow(farMaterial, glow);
    },
    setFarScale(scale: number): void {
      if (disposed || !Number.isFinite(scale)) return;
      farScale = Math.max(1, scale);
      // Rewrite every visible instance at the new curve.
      for (let index = 0; index < streamer.records.length; index++)
        if (written[index] !== 0) writeFar(index);
      mesh.instanceMatrix.needsUpdate = true;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      root.removeFromParent();
      geometry.dispose();
      farMaterial.dispose();
    },
  };
}
