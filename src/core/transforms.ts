import { Quaternion, Vector3 } from 'three';
import type { BodyId, IPhysicsWorld } from '../physics/adapter';

export class TransformState {
  readonly position = new Vector3();
  readonly rotation = new Quaternion();

  copy(other: TransformState): void {
    this.position.copy(other.position);
    this.rotation.copy(other.rotation);
  }
}

/** Allocate once per rendered body. The camera follows interpolated, not current. */
export class TransformHistory {
  readonly previous = new TransformState();
  readonly current = new TransformState();
  readonly interpolated = new TransformState();

  constructor(
    private readonly world: Pick<IPhysicsWorld, 'getTransform'>,
    private readonly body: BodyId,
  ) {
    this.reset();
  }

  reset(): void {
    this.world.getTransform(
      this.body,
      this.current.position,
      this.current.rotation,
    );
    this.previous.copy(this.current);
    this.interpolated.copy(this.current);
  }

  beforeStep(): void {
    this.previous.copy(this.current);
  }

  afterStep(): void {
    this.world.getTransform(
      this.body,
      this.current.position,
      this.current.rotation,
    );
  }

  interpolate(alpha: number): TransformState {
    this.interpolated.position.lerpVectors(
      this.previous.position,
      this.current.position,
      alpha,
    );
    this.interpolated.rotation.slerpQuaternions(
      this.previous.rotation,
      this.current.rotation,
      alpha,
    );
    return this.interpolated;
  }
}
