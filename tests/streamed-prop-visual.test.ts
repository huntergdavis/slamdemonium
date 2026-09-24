import { InstancedMesh, MeshBasicMaterial, Scene } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStreamedPropVisual } from '../src/render/streamedPropVisual';
import type {
  PropStreamRecord,
  PropStreamer,
} from '../src/world/propStreaming';

describe('streamed far visual', () => {
  afterEach(() => vi.restoreAllMocks());

  it('writes matrices only on far/promoted transitions', () => {
    const setMatrixAt = vi.spyOn(InstancedMesh.prototype, 'setMatrixAt');
    const records: readonly PropStreamRecord[] = [
      {
        id: 'a',
        cellId: 0,
        cellSize: 160,
        placementIndex: 0,
        position: { x: 0, y: 0.5, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
      },
      {
        id: 'b',
        cellId: 0,
        cellSize: 160,
        placementIndex: 1,
        position: { x: 10, y: 0.5, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
      },
    ];
    const far = [true, true];
    let changedIndex = -1;
    const streamer = {
      records,
      isFarVisible(index: number) {
        return far[index] ?? false;
      },
      copyFarVisibilityChanges(out: Int32Array) {
        if (changedIndex < 0) return 0;
        out[0] = changedIndex;
        changedIndex = -1;
        return 1;
      },
    } as unknown as PropStreamer;
    const visual = createStreamedPropVisual(
      new Scene(),
      streamer,
      { x: 0.5, y: 0.5, z: 0.5 },
      new MeshBasicMaterial(),
    );
    setMatrixAt.mockClear();
    visual.update();
    expect(setMatrixAt).toHaveBeenCalledTimes(0);
    far[1] = false;
    changedIndex = 1;
    visual.update();
    expect(setMatrixAt).toHaveBeenCalledTimes(1);
    visual.dispose();
  });
});
