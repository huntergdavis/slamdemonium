import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
} from 'three';
import type { Scene } from 'three';
import {
  runGateCorners,
  type RunGateKind,
  type RunRouteSpec,
} from '../core/timedRun';

/** The run's gates painted on the ground: the start line is a thing in the
 * world he drives into, not UI. Green start, amber checkpoints, white goal.
 * Paint only; the trigger is the box test in core/timedRun.ts. */
export const RUN_GATE_COLORS: Readonly<Record<RunGateKind, number>> = {
  start: 0x5dff8a,
  checkpoint: 0xffd166,
  goal: 0xffffff,
};

export interface RunGateVisual {
  readonly root: Group;
  dispose(): void;
}

export function createRunGateVisual(
  scene: Scene,
  route: RunRouteSpec | undefined,
  paintHeight: number,
): RunGateVisual {
  const root = new Group();
  root.name = 'run-gates';
  const gates = route?.gates ?? [];
  const positions = new Float32Array(gates.length * 18);
  const colors = new Float32Array(gates.length * 18);
  gates.forEach((gate, i) => {
    const [a, b, c, d] = runGateCorners(gate); // Left-back, right-back, right-front, left-front.
    // Two triangles wound counter-clockwise seen from above, so the face
    // normal is +Y and front-face culling keeps them on screen (the pads
    // shipped face down once; the unit test pins the normal).
    const y = paintHeight;
    positions.set(
      [
        a![0],
        y,
        a![1],
        b![0],
        y,
        b![1],
        c![0],
        y,
        c![1],
        a![0],
        y,
        a![1],
        c![0],
        y,
        c![1],
        d![0],
        y,
        d![1],
      ],
      i * 18,
    );
    const hex = RUN_GATE_COLORS[gate.kind];
    const r = ((hex >> 16) & 255) / 255;
    const g = ((hex >> 8) & 255) / 255;
    const bl = (hex & 255) / 255;
    for (let v = 0; v < 6; v++) colors.set([r, g, bl], i * 18 + v * 3);
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const material = new MeshBasicMaterial({
    vertexColors: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = 'run-gates.paint';
  root.add(mesh);
  scene.add(root);
  return {
    root,
    dispose() {
      root.removeFromParent();
      geometry.dispose();
      material.dispose();
    },
  };
}
