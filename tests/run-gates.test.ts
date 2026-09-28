import { Mesh, Scene, Vector3 } from 'three';
import type { BufferGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { createRunGateVisual, RUN_GATE_COLORS } from '../src/world/runGates';
import { PROVING_GROUND_MAP } from '../src/world/maps';
import { runGateContains } from '../src/core/timedRun';
import { runwayLaneClearance } from '../src/world/runways';

describe('run gate paint', () => {
  it('draws every gate as two up-facing triangles at paint height in its kind colour', () => {
    const scene = new Scene();
    const route = PROVING_GROUND_MAP.runs![0]!;
    const visual = createRunGateVisual(scene, route, 0.005);
    const mesh = scene.getObjectByName('run-gates.paint') as Mesh;
    const geometry = mesh.geometry as BufferGeometry;
    expect(geometry.getAttribute('position').count).toBe(
      route.gates.length * 6,
    );
    const normal = new Vector3();
    for (let v = 0; v < geometry.getAttribute('normal').count; v++) {
      normal.fromBufferAttribute(geometry.getAttribute('normal'), v);
      expect(normal.y).toBeGreaterThan(0.99);
      expect(geometry.getAttribute('position').getY(v)).toBeCloseTo(0.005, 9);
    }
    const color = geometry.getAttribute('color');
    expect(color.getX(0)).toBeCloseTo(
      ((RUN_GATE_COLORS.start >> 16) & 255) / 255,
      6,
    );
    expect((mesh.material as { side: number }).side).toBe(0); // FrontSide.
    visual.dispose();
    expect(scene.children).toHaveLength(0);
    createRunGateVisual(scene, undefined, 0.005).dispose();
  });
});

describe('the proving ground route', () => {
  const pg = PROVING_GROUND_MAP;
  const route = pg.runs![0]!;
  const [start, checkpoint, goal] = route.gates;

  it('starts on the main runway 20 m ahead of the spawn, so boot shows the line and retry lands on it', () => {
    const main = pg.runways[0]!;
    expect(start!.kind).toBe('start');
    expect(runwayLaneClearance(main, start!.x, start!.z)).toBe(0);
    expect(start!.z - pg.spawn!.z).toBe(20);
    expect(start!.heading).toBe(pg.spawn!.heading);
    expect(runGateContains(start!, pg.spawn!.x, pg.spawn!.z)).toBe(false);
    expect(start!.width).toBeGreaterThanOrEqual(main.width); // Forgiving across the lane.
  });

  it('takes the east loop through a checkpoint on its branch, and ends past the loop exit', () => {
    const east = pg.loops[1]!;
    const branch = pg.runways.find((r) => r.x === east.x)!;
    expect(checkpoint!.kind).toBe('checkpoint');
    expect(runwayLaneClearance(branch, checkpoint!.x, checkpoint!.z)).toBe(0);
    expect(checkpoint!.z).toBeLessThan(east.z - east.radius); // Before the loop entry.
    expect(goal!.kind).toBe('goal');
    expect(goal!.x).toBeCloseTo(east.x + east.shift, 6); // On the exit lane.
    expect(goal!.z).toBeGreaterThan(east.z + east.radius + 100);
    expect(Math.hypot(goal!.x, goal!.z)).toBeLessThan(400); // Inside the ring.
  });
});
