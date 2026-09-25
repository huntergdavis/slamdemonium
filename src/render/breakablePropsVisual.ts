import {
  BoxGeometry,
  DodecahedronGeometry,
  Group,
  InstancedMesh,
  MeshStandardMaterial,
  Object3D,
} from 'three';
import type { Material, Scene } from 'three';
import type { IPhysicsWorld, Quat, V3 } from '../physics/adapter';
import type { BreakableProps } from '../world/breakableProps';
import { applyPropGlow } from './propLook';

export interface BreakablePropsVisual {
  update(): void;
  /** Self-light on intact props; the far layer must be given the same. */
  setGlow(glow: number): void;
  dispose(): void;
}

const FRAGMENT_SCALE_X = [0.62, 0.9, 0.72, 0.98, 0.68, 0.86, 0.76, 0.94];
const FRAGMENT_SCALE_Y = [0.78, 0.56, 0.92, 0.64, 0.7, 0.88, 0.6, 0.82];
const FRAGMENT_SCALE_Z = [0.9, 0.7, 0.58, 0.84, 0.66, 0.96, 0.74, 0.62];

/** Pooled painted props and visibly irregular, contrasting debris. */
/** The intact prop colour. The far streamed instances use the same one so a
 * prop looks identical before and after it becomes a physics body; the swap
 * at the streaming radius used to turn a grey speck orange, which read as
 * pop-in. */
export const BREAKABLE_PROP_COLOR = 0xc86432;

export function createBreakablePropsVisual(
  scene: Scene,
  physics: IPhysicsWorld,
  props: BreakableProps,
  material: Material,
): BreakablePropsVisual {
  const root = new Group();
  root.name = 'breakable-props';
  const propGeometry = new BoxGeometry(1, 1, 1);
  // A faceted shape and varied scale make the wreckage read as fragments even
  // at chase-camera distance; the physics colliders remain boxes.
  const debrisGeometry = new DodecahedronGeometry(0.5, 0);
  const propMaterial = material.clone();
  const debrisMaterial = material.clone();
  if (propMaterial instanceof MeshStandardMaterial)
    propMaterial.color.setHex(BREAKABLE_PROP_COLOR);
  if (debrisMaterial instanceof MeshStandardMaterial)
    debrisMaterial.color.setHex(0x455768);
  const propMesh = new InstancedMesh(
    propGeometry,
    propMaterial,
    props.propCapacity,
  );
  const debrisMesh = new InstancedMesh(
    debrisGeometry,
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
          props.fragmentHalfExtents.x *
            2 *
            (FRAGMENT_SCALE_X[index % FRAGMENT_SCALE_X.length] ?? 1),
          props.fragmentHalfExtents.y *
            2 *
            (FRAGMENT_SCALE_Y[index % FRAGMENT_SCALE_Y.length] ?? 1),
          props.fragmentHalfExtents.z *
            2 *
            (FRAGMENT_SCALE_Z[index % FRAGMENT_SCALE_Z.length] ?? 1),
        );
    }
    hideRemainder(debrisMesh, fragmentCount, props.fragmentCapacity);
    debrisMesh.instanceMatrix.needsUpdate = true;
  }

  update();
  return {
    update,
    setGlow(glow: number): void {
      if (!disposed) applyPropGlow(propMaterial, glow);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      root.removeFromParent();
      propGeometry.dispose();
      debrisGeometry.dispose();
      propMaterial.dispose();
      debrisMaterial.dispose();
    },
  };
}
