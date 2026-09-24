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
  // Far records are authored poses, so their matrices are immutable. Only a
  // promotion/demotion transition needs a matrix write and instance upload.
  const lastFarVisible = new Int8Array(streamer.records.length);
  lastFarVisible.fill(-1);
  let disposed = false;

  function update(): void {
    if (disposed) return;
    let changed = false;
    for (let index = 0; index < streamer.records.length; index++) {
      const record = streamer.records[index];
      const farVisible = record && streamer.isFarVisible(index) ? 1 : 0;
      if (lastFarVisible[index] === farVisible) continue;
      lastFarVisible[index] = farVisible;
      changed = true;
      if (!record || farVisible === 0) {
        mesh.setMatrixAt(index, hidden.matrix);
        continue;
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
      mesh.setMatrixAt(index, transform.matrix);
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
