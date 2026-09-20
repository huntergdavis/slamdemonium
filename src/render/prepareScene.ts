import { InstancedMesh, Material, Mesh, MeshDepthMaterial, Scene } from 'three';

/**
 * Three caches the current program on a material. Sharing it between instanced
 * and ordinary meshes repeatedly rebuilds shader parameter objects/cache keys.
 * Prepare variants once, after mounting the scene; animated single-kind materials
 * (notably the brake lights) keep their original identity.
 */
export function prepareScene(scene: Scene) {
  const variants = new Map<Material, Map<string, Material>>();
  const owned: Material[] = [];
  const restored: (() => void)[] = [];
  let disposed = false;
  scene.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const key =
      object instanceof InstancedMesh
        ? object.instanceColor
          ? 'instanced-color'
          : 'instanced'
        : 'mesh';
    function variant(source: Material): Material {
      let group = variants.get(source);
      if (!group) {
        group = new Map([[key, source]]);
        variants.set(source, group);
        return source;
      }
      let result = group.get(key);
      if (!result) {
        result = source.clone();
        result.name = source.name + ':' + key;
        group.set(key, result);
        owned.push(result);
      }
      return result;
    }
    const original = object.material;
    object.material = Array.isArray(original)
      ? original.map(variant)
      : variant(original);
    restored.push(() => {
      object.material = original;
    });
    // The renderer's default depth material otherwise alternates between the
    // instanced track and ordinary car meshes on every shadow pass.
    if (object.castShadow && object.customDepthMaterial === undefined) {
      const depth = new MeshDepthMaterial();
      object.customDepthMaterial = depth;
      owned.push(depth);
      restored.push(() => {
        object.customDepthMaterial = undefined;
      });
    }
  });
  return {
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const restore of restored) restore();
      for (const material of owned) material.dispose();
    },
  };
}
