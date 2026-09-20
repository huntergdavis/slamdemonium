import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Mesh,
  Scene,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector3,
} from 'three';
import type { V3 } from '../physics/adapter';

export interface SkidWheel {
  grounded: boolean;
  gripUsage: number;
  spinning: boolean;
  locked: boolean;
  contactPoint: Readonly<V3>;
  contactNormal: Readonly<V3>;
}

/** One preallocated geometry per wheel; one slot is two triangles, never an Object3D. */
export class SkidStrip {
  readonly geometry = new BufferGeometry();
  readonly positions: BufferAttribute;
  readonly births: BufferAttribute;
  count = 0;
  written = 0;
  lastBirth = -Infinity;
  private next = 0;
  private hasPoint = false;
  private joined = false;
  private dirtyFirst = Infinity;
  private dirtyLast = 0;
  private readonly positionRange = { start: 0, count: 0 };
  private readonly birthRange = { start: 0, count: 0 };
  private readonly previous = new Vector3();
  private readonly previousLeft = new Vector3();
  private readonly previousRight = new Vector3();
  private readonly point = new Vector3();
  private readonly direction = new Vector3();
  private readonly side = new Vector3();
  private readonly left = new Vector3();
  private readonly right = new Vector3();

  constructor(
    readonly capacity = 8192,
    private readonly width = 0.24,
  ) {
    this.positions = new BufferAttribute(
      new Float32Array(capacity * 18),
      3,
    ).setUsage(DynamicDrawUsage);
    this.births = new BufferAttribute(
      new Float32Array(capacity * 6),
      1,
    ).setUsage(DynamicDrawUsage);
    this.geometry.setAttribute('position', this.positions);
    this.geometry.setAttribute('born', this.births);
    this.geometry.setDrawRange(0, 0);
  }

  breakStrip(): void {
    this.hasPoint = false;
    this.joined = false;
  }

  sample(wheel: SkidWheel, time: number): void {
    if (
      !wheel.grounded ||
      !(wheel.gripUsage > 0.95 || wheel.spinning || wheel.locked)
    ) {
      this.breakStrip();
      return;
    }
    this.point
      .copy(wheel.contactPoint)
      .addScaledVector(wheel.contactNormal, 0.012);
    if (!this.hasPoint) {
      this.previous.copy(this.point);
      this.hasPoint = true;
      return;
    }
    this.direction.subVectors(this.point, this.previous);
    const distanceSq = this.direction.lengthSq();
    if (distanceSq > 25) {
      this.previous.copy(this.point);
      this.joined = false;
      return;
    }
    if (distanceSq < 0.15 ** 2) return;
    this.side
      .crossVectors(wheel.contactNormal, this.direction)
      .normalize()
      .multiplyScalar(this.width * 0.5);
    if (this.side.lengthSq() === 0) {
      this.breakStrip();
      return;
    }
    this.left.copy(this.point).add(this.side);
    this.right.copy(this.point).sub(this.side);
    if (!this.joined) {
      this.previousLeft.copy(this.previous).add(this.side);
      this.previousRight.copy(this.previous).sub(this.side);
    }
    const start = this.next * 6;
    this.vertex(start, this.previousLeft, time);
    this.vertex(start + 1, this.previousRight, time);
    this.vertex(start + 2, this.left, time);
    this.vertex(start + 3, this.left, time);
    this.vertex(start + 4, this.previousRight, time);
    this.vertex(start + 5, this.right, time);
    this.dirtyFirst = Math.min(this.dirtyFirst, start);
    this.dirtyLast = Math.max(this.dirtyLast, start + 6);
    this.next = (this.next + 1) % this.capacity;
    this.count = Math.min(this.count + 1, this.capacity);
    this.written++;
    this.lastBirth = time;
    this.geometry.setDrawRange(0, this.count * 6);
    this.previous.copy(this.point);
    this.previousLeft.copy(this.left);
    this.previousRight.copy(this.right);
    this.joined = true;
  }

  private vertex(index: number, point: Vector3, time: number): void {
    this.positions.setXYZ(index, point.x, point.y, point.z);
    this.births.setX(index, time);
  }

  upload(): void {
    if (this.dirtyFirst === Infinity) return;
    this.positionRange.start = this.dirtyFirst * 3;
    this.positionRange.count = (this.dirtyLast - this.dirtyFirst) * 3;
    this.birthRange.start = this.dirtyFirst;
    this.birthRange.count = this.dirtyLast - this.dirtyFirst;
    this.positions.updateRanges.length = 0;
    this.births.updateRanges.length = 0;
    this.positions.updateRanges.push(this.positionRange);
    this.births.updateRanges.push(this.birthRange);
    this.positions.needsUpdate = true;
    this.births.needsUpdate = true;
    this.dirtyFirst = Infinity;
    this.dirtyLast = 0;
  }

  dispose(): void {
    this.geometry.dispose();
  }
}

export function skidOpacity(age: number): number {
  return Math.max(0, Math.min(1, 1 - age / 20)) * 0.55;
}

export function createSkidMarks(scene: Scene) {
  const strips = [
    new SkidStrip(),
    new SkidStrip(),
    new SkidStrip(),
    new SkidStrip(),
  ] as const;
  const material = new ShaderMaterial({
    uniforms: UniformsUtils.merge([UniformsLib.fog!, { now: { value: 0 } }]),
    vertexShader: `
      attribute float born;
      varying float birth;
      #include <fog_pars_vertex>
      void main() {
        birth = born;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform float now;
      varying float birth;
      #include <fog_pars_fragment>
      void main() {
        float opacity = clamp(1.0 - (now - birth) / 20.0, 0.0, 1.0) * 0.55;
        if (opacity <= 0.0) discard;
        gl_FragColor = vec4(0.018, 0.020, 0.025, opacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    // Ground-hugging strips have no transparent volume to sort back/front.
    // Two-pass rendering would bump material.version twice per wheel per frame.
    forceSinglePass: true,
    fog: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const meshes = strips.map((strip, i) => {
    const mesh = new Mesh(strip.geometry, material);
    mesh.name = `skids.${i}`;
    // Geometry moves through a fixed world-space ring; no stale bounding sphere.
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    scene.add(mesh);
    return mesh;
  });
  return {
    strips,
    sample(wheels: readonly SkidWheel[], time: number): void {
      for (let i = 0; i < 4; i++) strips[i]!.sample(wheels[i]!, time);
    },
    update(time: number): void {
      material.uniforms.now!.value = time;
      for (let i = 0; i < strips.length; i++) {
        const strip = strips[i]!;
        strip.upload();
        meshes[i]!.visible = skidOpacity(time - strip.lastBirth) > 0;
      }
    },
    breakStrips(): void {
      for (const strip of strips) strip.breakStrip();
    },
    dispose(): void {
      for (const mesh of meshes) scene.remove(mesh);
      for (const strip of strips) strip.dispose();
      material.dispose();
    },
  };
}
