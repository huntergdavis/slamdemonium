import {
  BoxGeometry,
  Group,
  InstancedMesh,
  Object3D,
} from 'three';
import type { Material, Scene } from 'three';
import type { IPhysicsWorld, Quat, V3 } from '../physics/adapter';
import type { BreakableProps } from '../world/breakableProps';

export interface BreakablePropsVisual {
  update(): void;
  dispose(): void;
}

/** Plain pooled boxes: one mesh for intact props and one for debris. */
export function createBreakablePropsVisual(
  scene: Scene,
  physics: IPhysicsWorld,
  props: BreakableProps,
  material: Material,
): BreakablePropsVisual {
  const root = new Group();
  root.name = 'breakable-props';
  const geometry = new BoxGeometry(1, 1, 1);
  const propMesh = new InstancedMesh(
    geometry,
    material,
    props.propCapacity,
  );
  const debrisMesh = new InstancedMesh(
    geometry,
    material,
    props.fragmentCapacity,
  );
  propMesh.name = 'breakable-props.intact';
  debrisMesh.name = 'breakable-props.debris';
  propMesh.castShadow = propMesh.receiveShadow = true;
  debrisMesh.castShadow = debrisMesh.receiveShadow = true;
  // Dynamic bodies change bounds every frame; avoid rebuilding spheres in the
  // render loop for this intentionally small placeholder layer.
  propMesh.frustumCulled = false;
  debrisMesh.frustumCulled = false;
  root.add(propMesh, debrisMesh);
  scene.add(root);

  const propIds = new Float64Array(props.propCapacity);
  const fragmentIds = new Float64Array(props.fragmentCapacity);
  const position: V3 = { x: 0, y: 0, z: 0 };
  const rotation: Quat = { x: 0, y: 0, z: 0, w: 1 };
  const transform = new Object3D();
  const hiddenTransform = new Object3D();
  transform.scale.set(
    props.propHalfExtents.x * 2,
    props.propHalfExtents.y * 2,
    props.propHalfExtents.z * 2,
  );
  hiddenTransform.scale.set(0, 0, 0);
  hiddenTransform.updateMatrix();
  let disposed = false;

  function updateBody(
    mesh: InstancedMesh,
    id: number,
    index: number,
    scaleX: number,
    scaleY: number,
    scaleZ: number,
  ): void {
    physics.getTransform(id, position, rotation);
    transform.position.set(position.x, position.y, position.z);
    transform.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    transform.scale.set(scaleX, scaleY, scaleZ);
    transform.updateMatrix();
    mesh.setMatrixAt(index, transform.matrix);
  }

  function hideRemainder(mesh: InstancedMesh, from: number, capacity: number) {
    for (let index = from; index < capacity; index++)
      mesh.setMatrixAt(index, hiddenTransform.matrix);
  }

  // Physics poses are sampled after the latest step; the placeholder may lead
  // the interpolated car by one step when render cadence varies.
  function update(): void {
    if (disposed) return;
    const propCount = props.copyActivePropIds(propIds);
    for (let index = 0; index < propCount; index++) {
      const id = propIds[index];
      if (id !== undefined)
        updateBody(
          propMesh,
          id,
          index,
          props.propHalfExtents.x * 2,
          props.propHalfExtents.y * 2,
          props.propHalfExtents.z * 2,
        );
    }
    hideRemainder(propMesh, propCount, props.propCapacity);
    propMesh.instanceMatrix.needsUpdate = true;

    const fragmentCount = props.copyActiveFragmentIds(fragmentIds);
    for (let index = 0; index < fragmentCount; index++) {
      const id = fragmentIds[index];
      if (id !== undefined)
        updateBody(
          debrisMesh,
          id,
          index,
          props.fragmentHalfExtents.x * 2,
          props.fragmentHalfExtents.y * 2,
          props.fragmentHalfExtents.z * 2,
        );
    }
    hideRemainder(debrisMesh, fragmentCount, props.fragmentCapacity);
    debrisMesh.instanceMatrix.needsUpdate = true;
  }

  update();
  return {
    update,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      root.removeFromParent();
      geometry.dispose();
    },
  };
}
