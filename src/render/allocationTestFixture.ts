import { Material, Mesh, Scene } from 'three';

declare global {
  interface Window {
    __allocationFixture?: {
      renderFrames(count: number): void;
      resetProgramCalls(): void;
      programCalls(): number;
      restoreSharedMaterials(): void;
    };
  }
}

/** VITE_TEST_API only. Counts actual program-parameter/cache-key construction,
 * including cache hits; renderer.info.programs alone misses that churn. */
export function installAllocationTestFixture(
  scene: Scene,
  render: () => void,
  restoreSharedMaterials: () => void,
) {
  let calls = 0;
  const materials = new Set<Material>();
  const restore: (() => void)[] = [];
  function instrument(material: Material): void {
    if (materials.has(material)) return;
    materials.add(material);
    const original = material.customProgramCacheKey;
    material.customProgramCacheKey = function () {
      calls++;
      return original.call(this);
    };
    restore.push(() => {
      material.customProgramCacheKey = original;
    });
  }
  scene.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    if (Array.isArray(object.material)) object.material.forEach(instrument);
    else instrument(object.material);
    if (object.customDepthMaterial) instrument(object.customDepthMaterial);
  });
  window.__allocationFixture = {
    renderFrames(count) {
      for (let i = 0; i < count; i++) render();
    },
    resetProgramCalls() {
      calls = 0;
    },
    programCalls: () => calls,
    restoreSharedMaterials,
  };
  return {
    dispose() {
      for (const reset of restore) reset();
      delete window.__allocationFixture;
    },
  };
}
