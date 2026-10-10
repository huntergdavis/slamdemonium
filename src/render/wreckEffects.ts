import {
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  InstancedMesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  Vector3,
  type Scene,
} from 'three';
import {
  CAR_MODELS,
  CAR_PALETTE,
  detachedPanelAnchors,
  paletteColorIndex,
  type CarDamageSide,
  type CarCrushState,
} from '../world/carModels';
import type { TrafficCarState } from '../world/traffic';
import { createWreckParticles } from './wreckParticles';

const MAX_PANELS = 4;
const NEAR_DISTANCE_SQUARED = 400 * 400;
const LIFE_SECONDS = 2.8;
const GRAVITY = 20;
const visualFacing = new Quaternion(0, 1, 0, 0);
const sides: readonly CarDamageSide[] = ['front', 'rear', 'left', 'right'];

type Panel = {
  encounterId: number;
  distanceSquared: number;
  age: number;
  groundY: number;
  position: Vector3;
  velocity: Vector3;
  rotation: Quaternion;
  spin: Vector3;
  size: Vector3;
  color: Color;
};

/** The first pool consumes only post-step wreck transitions. No fragments are
 * physical, so even a multi-car pileup cannot make a new debris mound. */
export function createWreckEffects(scene: Scene, hasRivals: boolean) {
  const particles = createWreckParticles(scene);
  const geometry = new BoxGeometry(1, 1, 1);
  const material = new MeshStandardMaterial({
    color: 0xffffff,
    metalness: 0.4,
    roughness: 0.6,
    flatShading: true,
  });
  const mesh = new InstancedMesh(geometry, material, MAX_PANELS);
  mesh.name = 'traffic.wreck.panels';
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.count = 0;
  scene.add(mesh);
  const panels: Panel[] = [];
  const tornEncounters = new Map<number, number>();
  let elapsedSeconds = 0;
  const helper = new Object3D();
  const carRotation = new Quaternion();
  const offset = new Vector3();
  const outward = new Vector3();
  const color = new Color();
  const from = (state: TrafficCarState): CarDamageSide => {
    let side: CarDamageSide = 'front';
    let damage = -1;
    for (const candidate of sides) {
      const amount = state.crush[candidate as keyof CarCrushState];
      if (amount > damage) {
        side = candidate;
        damage = amount;
      }
    }
    return side;
  };

  function consume(
    wrecks: readonly TrafficCarState[],
    states: readonly TrafficCarState[],
    player: { readonly x: number; readonly z: number },
  ): void {
    if (tornEncounters.size) {
      for (const [id, expires] of tornEncounters)
        if (expires < elapsedSeconds) tornEncounters.delete(id);
      for (const state of states)
        if (!state.wrecked) tornEncounters.delete(state.id);
    }
    for (const state of wrecks) {
      if (tornEncounters.has(state.id)) continue;
      const dx = state.position.x - player.x;
      const dz = state.position.z - player.z;
      const distanceSquared = dx * dx + dz * dz;
      if (distanceSquared > NEAR_DISTANCE_SQUARED) continue;
      const side = state.wreckSide ?? from(state);
      const strength = state.crush[side];
      if (strength < 0.12) continue;
      if (panels.length + 2 > MAX_PANELS) {
        let farthestId = -1;
        let farthestDistance = -1;
        for (const panel of panels)
          if (panel.distanceSquared > farthestDistance) {
            farthestId = panel.encounterId;
            farthestDistance = panel.distanceSquared;
          }
        if (distanceSquared >= farthestDistance) continue;
        for (let index = panels.length - 1; index >= 0; index--)
          if (panels[index]!.encounterId === farthestId)
            panels.splice(index, 1);
      }
      tornEncounters.set(state.id, elapsedSeconds + LIFE_SECONDS + 1);
      state.tornSide = side;
      carRotation
        .set(
          state.rotation.x,
          state.rotation.y,
          state.rotation.z,
          state.rotation.w,
        )
        .multiply(visualFacing);
      const paint = paletteColorIndex(
        state.rival ? 0 : hasRivals ? (state.id % 7) + 1 : state.id,
      );
      color.setHex(CAR_PALETTE[paint]!);
      const anchors = detachedPanelAnchors(state.modelKind, side);
      const groundY = state.position.y - CAR_MODELS[state.modelKind].ride;
      for (let index = 0; index < anchors.length; index++) {
        const anchor = anchors[index]!;
        offset.fromArray(anchor.offset).applyQuaternion(carRotation);
        outward.fromArray(anchor.normal).applyQuaternion(carRotation);
        panels.push({
          encounterId: state.id,
          distanceSquared,
          age: 0,
          groundY,
          position: new Vector3(
            state.position.x + offset.x,
            state.position.y + offset.y,
            state.position.z + offset.z,
          ),
          velocity: new Vector3(
            state.velocity.x + outward.x * (2.5 + strength * 3.5),
            state.velocity.y + 1.8 + strength * 2.5,
            state.velocity.z + outward.z * (2.5 + strength * 3.5),
          ),
          rotation: carRotation.clone(),
          spin: new Vector3(
            (index ? -1 : 1) * (3 + strength * 2),
            (index ? 1 : -1) * 4,
            (index ? 1 : -1) * 2,
          ),
          size: new Vector3(...anchor.size),
          color: color.clone(),
        });
      }
    }
  }

  function advance(dt: number): void {
    elapsedSeconds += dt;
    particles.advance(dt);
    for (let index = panels.length - 1; index >= 0; index--) {
      const panel = panels[index]!;
      panel.age += dt;
      if (panel.age >= LIFE_SECONDS) {
        panels.splice(index, 1);
        continue;
      }
      panel.velocity.y -= GRAVITY * dt;
      panel.position.addScaledVector(panel.velocity, dt);
      const floor = panel.groundY + panel.size.y * 0.5;
      if (panel.position.y < floor) {
        panel.position.y = floor;
        panel.velocity.y =
          Math.abs(panel.velocity.y) > 1.2 ? -panel.velocity.y * 0.18 : 0;
        panel.velocity.x *= 0.78;
        panel.velocity.z *= 0.78;
        panel.spin.multiplyScalar(0.7);
      }
      helper.rotation.set(
        panel.spin.x * dt,
        panel.spin.y * dt,
        panel.spin.z * dt,
      );
      panel.rotation.multiply(helper.quaternion);
    }
  }

  function render(): void {
    particles.render();
    mesh.count = panels.length;
    for (let index = 0; index < panels.length; index++) {
      const panel = panels[index]!;
      helper.position.copy(panel.position);
      helper.quaternion.copy(panel.rotation);
      helper.scale.copy(panel.size);
      helper.updateMatrix();
      mesh.setMatrixAt(index, helper.matrix);
      mesh.setColorAt(index, panel.color);
    }
    if (panels.length) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  return {
    consume,
    noteContact: particles.noteContact,
    advance,
    render,
    get activeCount() {
      return panels.length;
    },
    get particleState() {
      return {
        sparks: particles.activeSparks,
        metal: particles.activeMetal,
        glass: particles.activeGlass,
        bursts: particles.burstCount,
        grinds: particles.grindCount,
        dropped: particles.dropped,
      };
    },
    reset() {
      particles.reset();
      panels.length = 0;
      tornEncounters.clear();
      elapsedSeconds = 0;
      mesh.count = 0;
    },
    dispose() {
      particles.dispose();
      scene.remove(mesh);
      geometry.dispose();
      material.dispose();
    },
  };
}
