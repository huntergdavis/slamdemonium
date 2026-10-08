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
  const wreckNotice = host.ownerDocument.createElement('div');
  wreckNotice.className = 'sl-rival-wreck-notice';
  wreckNotice.textContent = 'RIVAL DOWN';
  wreckNotice.hidden = true;
  root.append(wreckNotice);
  host.append(root);
  let wreckNoticeUntilMs = 0;
  const projected = new Vector3();
  const toCar = new Vector3();
  const look = new Vector3();

  function update(
    camera: Camera,
    states: readonly TrafficCarState[],
    player: V3,
  ) {
    wreckNotice.hidden = performance.now() >= wreckNoticeUntilMs;
    camera.updateMatrixWorld();
    camera.getWorldDirection(look);
    // Reading clientWidth after last frame's style writes forces layout at
    // uncapped render rates. The full-screen overlay uses viewport dimensions.
    const width = window.innerWidth;
    const height = window.innerHeight;
    const live = new Set<number>();
    let nearest: { x: number; y: number; distance: number } | undefined;
    let nearestId = -1;
    let secondId = -1;
    let nearestOverallId = -1;
    let nearestOverallDistance = Infinity;
    let nearestDistance = 120 * 120;
    let secondDistance = 120 * 120;
    for (const state of states) {
      if (!state.rival || state.wrecked) continue;
      const dx = state.position.x - player.x;
      const dz = state.position.z - player.z;
      const distance = dx * dx + dz * dz;
      if (distance < nearestOverallDistance) {
        nearestOverallDistance = distance;
        nearestOverallId = state.id;
      }
      if (distance < nearestDistance) {
        secondDistance = nearestDistance;
        secondId = nearestId;
        nearestDistance = distance;
        nearestId = state.id;
      } else if (distance < secondDistance) {
        secondDistance = distance;
        secondId = state.id;
      }
    }
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
      const x = (1 + projected.x) * width * 0.5;
      const y = (1 - projected.y) * height * 0.5;
      const inFrame =
        inFront && x > 36 && x < width - 36 && y > 28 && y < height - 36;
      marker.style.display =
        inFrame && (state.id === nearestId || state.id === secondId)
          ? ''
          : 'none';
      if (inFrame) marker.style.transform = `translate(${x}px, ${y}px)`;
      const dx = state.position.x - player.x;
      const dz = state.position.z - player.z;
      const distance = dx * dx + dz * dz;
      if (!inFrame && state.id === nearestOverallId) {
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

  return {
    update,
    showRivalWreck(nowMs: number) {
      wreckNoticeUntilMs = nowMs + 1400;
      wreckNotice.hidden = false;
    },
    dispose: () => root.remove(),
  };
}
