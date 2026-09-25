import { BoxGeometry, Group, InstancedMesh, Object3D } from 'three';
import type { Material, Scene } from 'three';
import type { PropStreamer } from '../world/propStreaming';

export interface StreamedPropVisual {
  update(): void;
  dispose(): void;
}

/** Cheap far-field representation; promoted bodies are hidden to avoid a
 * duplicate while the pooled physics visual owns their live transform. */
export function createStreamedPropVisual(
  scene: Scene,
  streamer: PropStreamer,
  halfExtents: Readonly<{ x: number; y: number; z: number }>,
  material: Material,
): StreamedPropVisual {
  const root = new Group();
  root.name = 'streamed-props.far';
  const geometry = new BoxGeometry(1, 1, 1);
  const farMaterial = material.clone();
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
  transform.scale.set(halfExtents.x * 2, halfExtents.y * 2, halfExtents.z * 2);
  transform.updateMatrix();
  // Far records are authored poses, so their matrices are immutable. The
  // streamer queues only promotion/demotion/destroyed transitions; after the
  // initial upload this avoids scanning thousands of records every frame.
  const farChanges = new Int32Array(streamer.records.length);
  let initialized = false;
  let disposed = false;

  function writeFar(index: number): void {
    const record = streamer.records[index];
    if (!record || !streamer.isFarVisible(index)) {
      mesh.setMatrixAt(index, hidden.matrix);
      return;
    }
    transform.position.set(
      record.position.x,
      record.position.y,
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
    }
    if (changed) mesh.instanceMatrix.needsUpdate = true;
  }

  update();
  return {
    update,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      root.removeFromParent();
      geometry.dispose();
      farMaterial.dispose();
    },
  };
}
