import { Vector3, type Camera } from 'three';
import type { TrafficCarState } from '../world/traffic';
import type { V3 } from '../physics/adapter';

/** Screen-space rival guidance remains visible when the instrument HUD is off. */
export function createRivalGuidance(host: HTMLElement) {
  const root = host.ownerDocument.createElement('div');
  root.className = 'sl-rival-guidance';
  root.dataset.hudPersistent = '';
  const markers = new Map<number, HTMLElement>();
  const pointer = host.ownerDocument.createElement('div');
  pointer.className = 'sl-rival-pointer';
  pointer.textContent = '◆ RIVAL';
  root.append(pointer);
  host.append(root);
  const projected = new Vector3();
  const toCar = new Vector3();
  const look = new Vector3();

  function update(
    camera: Camera,
    states: readonly TrafficCarState[],
    player: V3,
  ) {
    camera.updateMatrixWorld();
    camera.getWorldDirection(look);
    const width = root.clientWidth || window.innerWidth;
    const height = root.clientHeight || window.innerHeight;
    const live = new Set<number>();
    let nearest: { x: number; y: number; distance: number } | undefined;
    for (const state of states) {
      if (!state.rival || state.wrecked) continue;
      live.add(state.id);
      let marker = markers.get(state.id);
      if (!marker) {
        marker = host.ownerDocument.createElement('div');
        marker.className = 'sl-rival-marker';
        marker.textContent = '◆ RIVAL';
        root.append(marker);
        markers.set(state.id, marker);
      }
      projected.set(state.position.x, state.position.y + 3.5, state.position.z);
      toCar.copy(projected).sub(camera.position);
      const inFront = toCar.dot(look) > 0;
      projected.project(camera);
      const x = (1 - projected.x) * width * 0.5;
      const y = (1 - projected.y) * height * 0.5;
      const inFrame =
        inFront && x > 36 && x < width - 36 && y > 28 && y < height - 36;
      marker.style.display = inFrame ? '' : 'none';
      if (inFrame) marker.style.transform = `translate(${x}px, ${y}px)`;
      const dx = state.position.x - player.x;
      const dz = state.position.z - player.z;
      const distance = dx * dx + dz * dz;
      if (!inFrame && (!nearest || distance < nearest.distance)) {
        nearest = {
          x: inFront ? x : width - x,
          y: inFront ? y : height - y,
          distance,
        };
      }
    }
    for (const [id, marker] of markers) {
      if (live.has(id)) continue;
      marker.remove();
      markers.delete(id);
    }
    pointer.style.display = nearest ? '' : 'none';
    if (nearest) {
      const x = Math.max(46, Math.min(width - 46, nearest.x));
      const y = Math.max(42, Math.min(height - 42, nearest.y));
      pointer.style.transform = `translate(${x}px, ${y}px)`;
    }
  }

  return { update, dispose: () => root.remove() };
}
