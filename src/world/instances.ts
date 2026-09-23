import { Color, InstancedMesh, Object3D } from 'three';
import type { BufferGeometry, Material } from 'three';
import type { TrackInstance } from './trackLayout';

/** One InstancedMesh from placement data: the same packing the track uses
 * for its dashes, curbs and posts, so paint added by a map costs one draw. */
export function createInstancedBatch(
  name: string,
  geometry: BufferGeometry,
  material: Material,
  instances: readonly TrackInstance[],
  shadows: boolean,
): InstancedMesh {
  const object = new InstancedMesh(geometry, material, instances.length);
  object.name = name;
  const transform = new Object3D();
  const color = new Color();
  instances.forEach((instance, index) => {
    transform.position.set(
      instance.center.x,
      instance.center.y,
      instance.center.z,
    );
    transform.rotation.set(0, instance.rotY, 0);
    transform.scale.set(instance.size.x, instance.size.y, instance.size.z);
    transform.updateMatrix();
    object.setMatrixAt(index, transform.matrix);
    if (instance.color !== undefined)
      object.setColorAt(index, color.setHex(instance.color));
  });
  object.instanceMatrix.needsUpdate = true;
  if (object.instanceColor) object.instanceColor.needsUpdate = true;
  object.computeBoundingSphere();
  object.castShadow = shadows;
  object.receiveShadow = shadows;
  return object;
}
