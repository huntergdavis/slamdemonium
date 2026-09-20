import {
  ACESFilmicToneMapping,
  Color,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';

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

  function resize(): void {
    const width = Math.max(host.clientWidth, 1);
    const height = Math.max(host.clientHeight, 1);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
  }

  function render(): void {
    renderer.render(scene, camera);
  }

  function dispose(): void {
    window.removeEventListener('resize', resize);
    renderer.dispose();
    renderer.domElement.remove();
  }

  window.addEventListener('resize', resize);
  resize();
  return { scene, camera, renderer, render, dispose };
}
