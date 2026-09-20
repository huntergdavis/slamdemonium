import type { TrackConfig } from './trackConfig';
import { createBarrierDescriptors } from './trackPhysics';
import type { StaticBoxDescriptor, WorldPoint } from './trackPhysics';
import { WORLD_COLORS } from './materials';

export interface TrackInstance {
  center: WorldPoint;
  size: WorldPoint;
  rotY: number;
  color?: number;
}
function along(radius: number, arc: number, y: number): WorldPoint {
  const theta = arc / radius;
  return { x: radius * Math.cos(theta), y, z: -radius * Math.sin(theta) };
}
export function createTrackLayout(config: Readonly<TrackConfig>) {
  const dashes: TrackInstance[] = [],
    ticks: TrackInstance[] = [],
    curbs: TrackInstance[] = [],
    posts: TrackInstance[] = [];
  const circumference = 2 * Math.PI * config.centerLineRadius;
  const dashPeriod = config.dashLength + config.dashGap;
  for (let i = 0; i < Math.floor(circumference / dashPeriod); i++) {
    const arc = i * dashPeriod + config.dashLength / 2;
    dashes.push({
      center: along(config.centerLineRadius, arc, config.paintHeight),
      size: { x: config.centerLineWidth, y: 1, z: config.dashLength },
      rotY: arc / config.centerLineRadius,
    });
  }
  for (const edge of [config.ringInnerRadius, config.pavedRadius]) {
    const radius =
      edge === config.ringInnerRadius
        ? edge + config.tickInset + config.tickLength / 2
        : edge - config.tickInset - config.tickLength / 2;
    const count = Math.round(360 / config.tickDegrees);
    for (let i = 0; i < count; i++) {
      const theta = (i * 2 * Math.PI) / count;
      ticks.push({
        center: along(radius, radius * theta, config.paintHeight),
        size: { x: config.tickLength, y: 1, z: config.tickWidth },
        rotY: theta,
      });
    }
  }
  const curbOffset = config.curbClearance + config.curbWidth / 2;
  for (const radius of [
    config.ringInnerRadius - curbOffset,
    config.pavedRadius + curbOffset,
  ]) {
    const arcLength = 2 * Math.PI * radius;
    const count = Math.ceil(arcLength / config.curbLength);
    for (let i = 0; i < count; i++) {
      const length = Math.min(
        config.curbLength,
        arcLength - i * config.curbLength,
      );
      const arc = i * config.curbLength + length / 2;
      curbs.push({
        center: along(radius, arc, config.curbHeight / 2),
        size: { x: config.curbWidth, y: config.curbHeight, z: length },
        rotY: arc / radius,
        color: i % 2 ? WORLD_COLORS.paint : WORLD_COLORS.curbRed,
      });
    }
  }
  for (const radius of [
    config.ringInnerRadius - config.innerPostOffset,
    config.pavedRadius + config.outerPostOffset,
  ]) {
    const count = Math.ceil((2 * Math.PI * radius) / config.postSpacing);
    for (let i = 0; i < count; i++) {
      const arc = i * config.postSpacing;
      posts.push({
        center: along(radius, arc, config.postHeight / 2),
        size: {
          x: config.postWidth,
          y: config.postHeight,
          z: config.postWidth,
        },
        rotY: arc / radius,
        color: i % 2 ? WORLD_COLORS.paint : WORLD_COLORS.postCyan,
      });
    }
  }
  const barrierBoxes = createBarrierDescriptors(config);
  const barriers: TrackInstance[] = barrierBoxes.map(
    (box: StaticBoxDescriptor) => ({
      center: box.center,
      size: {
        x: box.halfExtents.x * 2,
        y: box.halfExtents.y * 2,
        z: box.halfExtents.z * 2,
      },
      rotY: box.rotY,
    }),
  );
  return { dashes, ticks, curbs, posts, barriers, barrierBoxes };
}
