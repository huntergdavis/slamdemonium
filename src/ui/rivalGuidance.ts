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
  pointer.textContent = 'RIVAL';
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
        const vx = (inFront ? x : width - x) - width * 0.5;
        let vy = (inFront ? y : height - y) - height * 0.5;
        if (Math.abs(vx) + Math.abs(vy) < 1) vy = height;
        nearest = {
          x: vx,
          y: vy,
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
      const scale = Math.min(
        (width * 0.5 - 46) / Math.max(0.01, Math.abs(nearest.x)),
        (height * 0.5 - 42) / Math.max(0.01, Math.abs(nearest.y)),
      );
      const x = width * 0.5 + nearest.x * scale;
      const y = height * 0.5 + nearest.y * scale;
      pointer.textContent =
        Math.abs(nearest.x / width) > Math.abs(nearest.y / height)
          ? nearest.x < 0
            ? '◀ RIVAL'
            : 'RIVAL ▶'
          : nearest.y < 0
            ? '▲ RIVAL'
            : '▼ RIVAL';
      pointer.style.transform = `translate(${x}px, ${y}px)`;
    }
  }

  return { update, dispose: () => root.remove() };
}
