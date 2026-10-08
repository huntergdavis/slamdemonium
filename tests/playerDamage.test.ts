import { describe, expect, it } from 'vitest';
import { Mesh, Scene, type BoxGeometry } from 'three';
import { PlayerDamage, PLAYER_WRECK_SECONDS } from '../src/core/playerDamage';
import { createCarVisual } from '../src/render/carVisual';
import { nearestRoadPose, sampleRoad } from '../src/world/roadGenerator';

const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };
const FRONT_NORMAL = { x: 0, y: 0, z: 1 };

function frontHit(damage: PlayerDamage, speed: number): void {
  damage.noteContact(FRONT_NORMAL, { x: 0, y: 0, z: -speed }, IDENTITY);
  damage.step(0.2);
}

describe('player wreck budget', () => {
  it.each([
    [8, 10],
    [20, 4],
    [40, 2],
  ])('wrecks after %i m/s hits in the %i-hit band', (speed, count) => {
    const damage = new PlayerDamage();
    for (let index = 0; index < count - 1; index++) {
      frontHit(damage, speed);
      expect(damage.wrecked).toBe(false);
    }
    frontHit(damage, speed);
    expect(damage.wrecked).toBe(true);
    expect(damage.crush.front).toBeGreaterThan(0);
    expect(damage.crush.rear).toBe(0);
    expect(damage.step(PLAYER_WRECK_SECONDS)).toBe(true);
    expect(damage.step(1 / 120)).toBe(false);
    damage.reset();
    expect(damage.damage).toBe(0);
    expect(damage.wrecked).toBe(false);
    expect(damage.crush.front).toBe(0);
  });

  it('keeps a sustained right-side scrape below the wreck budget', () => {
    const damage = new PlayerDamage();
    for (let index = 0; index < 360; index++) {
      damage.noteContact(
        { x: -1, y: 0, z: 0 },
        { x: 0, y: 0, z: -10 },
        IDENTITY,
      );
      damage.step(1 / 120);
    }
    expect(damage.crush.right).toBeCloseTo(0.28, 5);
    expect(damage.crush.left).toBe(0);
    expect(damage.damage).toBeLessThan(0.1);
    expect(damage.wrecked).toBe(false);
  });

  it('ignores supporting ground contact and dents a hard landing', () => {
    const damage = new PlayerDamage();
    damage.noteContact({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 0 }, IDENTITY);
    damage.step(1);
    expect(damage.damage).toBe(0);
    damage.noteContact({ x: 0, y: 1, z: 0 }, { x: 0, y: -20, z: 0 }, IDENTITY);
    expect(damage.damage).toBeCloseTo(0.25);
    expect(damage.crush.front).toBeGreaterThan(0);
    expect(damage.crush.rear).toBeGreaterThan(0);
  });
});

it('recovers to the nearest road facing increasing station', () => {
  const path = sampleRoad([{ kind: 'straight', length: 80 }], {
    x: 10,
    z: 20,
    heading: Math.PI,
  });
  const road = nearestRoadPose(path, { x: 13, y: 40, z: 49 });
  expect(road.x).toBeCloseTo(10);
  expect(road.z).toBeCloseTo(48);
  expect(road.heading).toBeCloseTo(Math.PI);
});

it('moves the player nose and roof vertices instead of only changing a label', () => {
  const visual = createCarVisual(new Scene());
  try {
    const body = visual.root.getObjectByName('car.body') as Mesh<BoxGeometry>;
    body.geometry.computeBoundingBox();
    const pristineNose = body.geometry.boundingBox!.min.z;
    const positions = body.geometry.getAttribute('position');
    let pristineFrontRoof = 0;
    for (let index = 0; index < positions.count; index++)
      if (positions.getZ(index) < -0.49)
        pristineFrontRoof = Math.max(pristineFrontRoof, positions.getY(index));
    visual.setCrush({ front: 0.7, rear: 0, left: 0, right: 0 });
    body.geometry.computeBoundingBox();
    expect(body.geometry.boundingBox!.min.z).toBeGreaterThan(
      pristineNose + 0.05,
    );
    let damagedFrontRoof = -Infinity;
    for (let index = 0; index < positions.count; index++)
      if (positions.getZ(index) < -0.3)
        damagedFrontRoof = Math.max(damagedFrontRoof, positions.getY(index));
    expect(damagedFrontRoof).toBeLessThan(pristineFrontRoof);
  } finally {
    visual.dispose();
  }
});
