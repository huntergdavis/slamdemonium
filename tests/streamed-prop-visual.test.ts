import {
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  Scene,
  Vector3,
} from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BREAKABLE_PROP_COLOR } from '../src/render/breakablePropsVisual';
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

  it('uploads each far record at its own authored position, not the helper matrix from construction', () => {
    const records: readonly PropStreamRecord[] = [
      {
        id: 'a',
        cellId: 0,
        cellSize: 160,
        placementIndex: 0,
        position: { x: 120, y: 0.5, z: -280 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
      },
      {
        id: 'b',
        cellId: 0,
        cellSize: 160,
        placementIndex: 1,
        position: { x: -100, y: 0.5, z: 140 },
        rotation: { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 },
      },
    ];
    const streamer = {
      records,
      isFarVisible: () => true,
      copyFarVisibilityChanges: () => 0,
    } as unknown as PropStreamer;
    const scene = new Scene();
    const visual = createStreamedPropVisual(
      scene,
      streamer,
      { x: 0.5, y: 0.5, z: 0.5 },
      new MeshBasicMaterial(),
    );
    const mesh = scene.getObjectByName('streamed-props.far')!
      .children[0] as InstancedMesh;
    const matrix = new Matrix4();
    const position = new Vector3();
    records.forEach((record, index) => {
      mesh.getMatrixAt(index, matrix);
      position.setFromMatrixPosition(matrix);
      expect(position.x).toBeCloseTo(record.position.x, 9);
      expect(position.y).toBeCloseTo(record.position.y, 9);
      expect(position.z).toBeCloseTo(record.position.z, 9);
      expect(new Vector3().setFromMatrixScale(matrix).x).toBeCloseTo(1, 9);
    });
    mesh.getMatrixAt(1, matrix);
    const q = new Quaternion().setFromRotationMatrix(matrix);
    expect(Math.abs(q.y)).toBeCloseTo(Math.SQRT1_2, 6);
    visual.dispose();
  });
  it('paints the far instances the same colour as the promoted props, so the streaming radius is not a visible edge', () => {
    const scene = new Scene();
    const streamer = {
      records: [],
      isFarVisible: () => false,
      copyFarVisibilityChanges: () => 0,
    } as unknown as PropStreamer;
    const barrier = new MeshStandardMaterial({ color: 0x6d7779 });
    const visual = createStreamedPropVisual(
      scene,
      streamer,
      { x: 0.5, y: 0.5, z: 0.5 },
      barrier,
    );
    const far = scene.getObjectByName('streamed-props.far')!
      .children[0] as InstancedMesh;
    const material = far.material as MeshStandardMaterial;
    expect(material).not.toBe(barrier);
    expect(material.color.getHex()).toBe(BREAKABLE_PROP_COLOR);
    expect(barrier.color.getHex()).toBe(0x6d7779); // The source is untouched.
    visual.dispose();
  });
});
