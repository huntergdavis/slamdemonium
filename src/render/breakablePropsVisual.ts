import {
  BoxGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Scene,
  Vector3,
} from 'three';
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
): BreakablePropsVisual {
  const root = new Group();
  root.name = 'breakable-props';
  const geometry = new BoxGeometry(1, 1, 1);
  const propMaterial = new MeshStandardMaterial({
    color: 0x7f8791,
    roughness: 0.85,
  });
  const debrisMaterial = new MeshStandardMaterial({
    color: 0xb6bdc7,
    roughness: 0.9,
  });
  const propMesh = new InstancedMesh(
    geometry,
    propMaterial,
    props.propCapacity,
  );
  const debrisMesh = new InstancedMesh(
    geometry,
    debrisMaterial,
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
  const threePosition = new Vector3();
  const threeRotation = new Quaternion();
  const unitScale = new Vector3(1, 1, 1);
  const hiddenScale = new Vector3(0, 0, 0);
  const matrix = new Matrix4();
  const hiddenMatrix = new Matrix4().compose(
    threePosition,
    threeRotation,
    hiddenScale,
  );
  let disposed = false;

  function updateBody(mesh: InstancedMesh, id: number, index: number): void {
    physics.getTransform(id, position, rotation);
    threePosition.set(position.x, position.y, position.z);
    threeRotation.set(rotation.x, rotation.y, rotation.z, rotation.w);
    matrix.compose(threePosition, threeRotation, unitScale);
    mesh.setMatrixAt(index, matrix);
  }

  function hideRemainder(mesh: InstancedMesh, from: number, capacity: number) {
    for (let index = from; index < capacity; index++)
      mesh.setMatrixAt(index, hiddenMatrix);
  }

  function update(): void {
    if (disposed) return;
    const propCount = props.copyActivePropIds(propIds);
    for (let index = 0; index < propCount; index++) {
      const id = propIds[index];
      if (id !== undefined) updateBody(propMesh, id, index);
    }
    hideRemainder(propMesh, propCount, props.propCapacity);
    propMesh.instanceMatrix.needsUpdate = true;

    const fragmentCount = props.copyActiveFragmentIds(fragmentIds);
    for (let index = 0; index < fragmentCount; index++) {
      const id = fragmentIds[index];
      if (id !== undefined) updateBody(debrisMesh, id, index);
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
      propMaterial.dispose();
      debrisMaterial.dispose();
    },
  };
}
