import {
  ACESFilmicToneMapping,
  Color,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';
import { DynamicResolution } from './dynamicResolution';

export function createRenderer(host: HTMLElement) {
  const scene = new Scene();
  scene.background = new Color(0x151b24);
  const camera = new PerspectiveCamera(70, 1, 0.1, 2000);
  camera.position.set(0, 3, 7.5);
  camera.lookAt(0, 0, 0);

  const renderer = new WebGLRenderer({ antialias: true });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.domElement.setAttribute('aria-label', 'Driving view');
  host.append(renderer.domElement);
  const resolution = new DynamicResolution();
  const size = { width: 1, height: 1, pixelRatio: 1 };

  function resize(): void {
    const width = Math.max(host.clientWidth, 1);
    const height = Math.max(host.clientHeight, 1);
    size.width = width;
    size.height = height;
    size.pixelRatio = Math.min(window.devicePixelRatio, 2) * resolution.scale;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(size.pixelRatio);
    renderer.setSize(width, height);
  }

  function render(nowMs?: number): void {
    if (nowMs !== undefined && resolution.update(nowMs)) resize();
    renderer.render(scene, camera);
  }

  function dispose(): void {
    window.removeEventListener('resize', resize);
    renderer.dispose();
    renderer.domElement.remove();
  }

  window.addEventListener('resize', resize);
  resize();
  return { scene, camera, renderer, resolution, size, render, dispose };
}
