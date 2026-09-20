import { expect, it, vi } from 'vitest';
import {
  BoxGeometry,
  Color,
  InstancedMesh,
  Mesh,
  MeshDepthMaterial,
  MeshStandardMaterial,
  Scene,
} from 'three';
import { prepareScene } from '../src/render/prepareScene';

it('isolates program variants while preserving shared materials within each kind', () => {
  const scene = new Scene(),
    geometry = new BoxGeometry();
  const paint = new MeshStandardMaterial();
  const ring = new Mesh(geometry, paint);
  const dashes = new InstancedMesh(geometry, paint, 2);
  const ticks = new InstancedMesh(geometry, paint, 2);
  const colored = new InstancedMesh(geometry, paint, 2);
  colored.setColorAt(0, new Color('red'));
  scene.add(ring, dashes, ticks, colored);
  const prepared = prepareScene(scene);
  expect(ring.material).toBe(paint);
  expect(dashes.material).toBe(ticks.material);
  expect(dashes.material).not.toBe(paint);
  expect(colored.material).not.toBe(dashes.material);
  const cloneDispose = vi.spyOn(dashes.material, 'dispose');
  const originalDispose = vi.spyOn(paint, 'dispose');
  prepared.dispose();
  prepared.dispose();
  expect(cloneDispose).toHaveBeenCalledTimes(1);
  expect(originalDispose).not.toHaveBeenCalled();
  expect(dashes.material).toBe(paint);
  geometry.dispose();
  paint.dispose();
});

it('preserves live single-kind material updates and custom shadows, owning only its depth variants', () => {
  const scene = new Scene(),
    geometry = new BoxGeometry();
  const material = new MeshStandardMaterial();
  const body = new Mesh(geometry, material);
  const wheel = new Mesh(geometry, material);
  const custom = new Mesh(geometry, material);
  const customDepth = new MeshDepthMaterial();
  body.castShadow = wheel.castShadow = custom.castShadow = true;
  custom.customDepthMaterial = customDepth;
  scene.add(body, wheel, custom);
  const prepared = prepareScene(scene);
  material.emissiveIntensity = 2.5;
  expect(body.material.emissiveIntensity).toBe(2.5);
  expect(wheel.material).toBe(material);
  expect(custom.customDepthMaterial).toBe(customDepth);
  expect(body.customDepthMaterial).not.toBe(wheel.customDepthMaterial);
  const depthDispose = vi.spyOn(body.customDepthMaterial!, 'dispose');
  const customDispose = vi.spyOn(customDepth, 'dispose');
  prepared.dispose();
  expect(body.customDepthMaterial).toBeUndefined();
  expect(depthDispose).toHaveBeenCalledOnce();
  expect(customDispose).not.toHaveBeenCalled();
  geometry.dispose();
  material.dispose();
  customDepth.dispose();
});
