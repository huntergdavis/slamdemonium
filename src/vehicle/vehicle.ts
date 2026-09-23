import { Quaternion, Vector3 } from 'three';
import type { GameInput } from '../core/gameApi';
import {
  getKnownSurfaceDefinition,
  type SurfaceResolver,
} from '../content/surfaces';
import type {
  BodyId,
  BodyProperties,
  IPhysicsWorld,
  MassDesc,
  Quat,
  V3,
} from '../physics/adapter';
import { TuningStore } from '../tuning/store';
import { DriftAssist, gripYawTorque } from './assists';
import { DEG, VEHICLE_GEOMETRY as G } from './constants';
import { DEFAULT_ENGINE } from './engineProfile';
import { RpmModel } from './rpmModel';
import { countersteerAngle, steeringLock, VehicleControls } from './controls';
import {
  brakeForce,
  coastAcceleration,
  engineAcceleration,
  reverseAcceleration,
} from './drivetrain';
import { clamp, smoothstep } from './math';
import {
  frontMassShare,
  limitDissipativeForce,
  springRate,
  suspensionForce,
} from './suspension';
import { VehicleTelemetry } from './telemetry';
import {
  effectiveFriction,
  lateralForce,
  longitudinalCapacity,
  relaxedSlip,
} from './tire';

/** One rigid body, four suspension rays; no engine-owned vehicle/controller types. */
export class Vehicle {
  readonly body: BodyId;
  readonly telemetry: VehicleTelemetry;
  readonly controls = new VehicleControls();
  readonly drift = new DriftAssist();
  suspensionEnabled = true;
  private readonly mass: MassDesc = {
    mass: 1300,
    comOffset: { x: 0, y: 0, z: 0 },
    inertiaScale: { x: 1, y: 1, z: 1 },
  };
  private readonly properties: BodyProperties = {
    angularDamping: 0,
    maxAngularVelocity: 12,
    friction: 0,
    restitution: 0,
  };
  private readonly inertia = new Vector3();
  private readonly forward = new Vector3();
  private readonly right = new Vector3();
  private readonly up = new Vector3();
  private readonly down = new Vector3();
  private readonly centerOfMass = new Vector3();
  private readonly pointVelocity = new Vector3();
  private readonly groundVelocity = new Vector3();
  private readonly force = new Vector3();
  private readonly torque = new Vector3();
  private readonly temp = new Vector3();
  private readonly previousVelocity = new Vector3();
  private readonly spawn = new Vector3();
  private readonly spawnRotation = new Quaternion();
  private frontShare = 0.5;
  private lock = 0;
  private meter = 0;
  private boostEnvelope = 0;
  /** Derived rpm and virtual gear for presentation; reads telemetry, writes
   * telemetry, never touches forces or controls. */
  private readonly rpmModel = new RpmModel(DEFAULT_ENGINE);

  constructor(
    readonly world: IPhysicsWorld,
    readonly tuning: TuningStore,
    spawn: V3,
    private readonly resolveSurface: SurfaceResolver,
  ) {
    this.telemetry = new VehicleTelemetry(resolveSurface.diagnostics);
    this.spawn.copy(spawn);
    this.readMassSettings();
    this.readBodySettings();
    this.body = world.createDynamicBox({
      center: this.spawn,
      halfExtents: { x: G.width / 2, y: G.height / 2, z: G.length / 2 },
      ...this.mass,
      ...this.properties,
      ccd: true,
    });
    world.getLocalInertia(this.body, this.inertia);
    this.readState();
  }
  private readMassSettings(): void {
    const t = this.tuning;
    this.mass.mass = t.get('mass');
    this.mass.comOffset.y = t.get('comHeightOffset');
    this.mass.comOffset.z = -t.get('comLongOffset');
    this.mass.inertiaScale.x = this.mass.inertiaScale.z = t.get(
      'pitchRollInertiaScale',
    );
    this.mass.inertiaScale.y = t.get('yawInertiaScale');
    this.frontShare = frontMassShare(t.get('comLongOffset'));
  }
  private readBodySettings(): void {
    this.properties.angularDamping = this.tuning.get('angularDamping');
    this.properties.maxAngularVelocity = this.tuning.get('maxAngularVelocity');
    this.properties.friction = this.tuning.get('wallFriction');
    this.properties.restitution = this.tuning.get('restitution');
  }
  get currentMass(): number {
    return this.mass.mass;
  }
  rebuildMassProperties(): void {
    this.readMassSettings();
    this.world.updateMassProperties(this.body, this.mass);
    this.world.getLocalInertia(this.body, this.inertia);
    this.readState();
  }
  updateBodyProperties(): void {
    this.readBodySettings();
    this.world.setBodyProperties(this.body, this.properties);
  }
  private readState(): void {
    const s = this.telemetry;
    this.world.getTransform(this.body, s.position, s.rotation);
    this.world.getLinearVelocity(this.body, s.velocity);
    this.world.getAngularVelocity(this.body, s.angularVelocity);
    this.forward.set(0, 0, -1).applyQuaternion(s.rotation);
    this.right.set(1, 0, 0).applyQuaternion(s.rotation);
    this.up.set(0, 1, 0).applyQuaternion(s.rotation);
    this.down.copy(this.up).negate();
    this.centerOfMass
      .copy(this.mass.comOffset)
      .applyQuaternion(s.rotation)
      .add(s.position);
    s.speed = s.velocity.length();
    s.speedKmh = s.speed * 3.6;
    s.vLong = s.velocity.dot(this.forward);
    s.vLat = s.velocity.dot(this.right);
    s.beta = Math.atan2(s.vLat, Math.max(Math.abs(s.vLong), 0.1));
    s.yawRate = s.angularVelocity.dot(this.up);
  }
  preStep(
    dt: number,
    input: Readonly<GameInput>,
    source: 'keyboard' | 'gamepad' = 'keyboard',
  ): void {
    this.controls.update(input, source, this.tuning, dt);
    this.readState();
    this.previousVelocity.copy(this.telemetry.velocity);
    this.world.setGravity(this.tuning.get('gravity'));
    this.suspension(dt);
    this.steering();
    this.tires(dt);
    this.assists(dt);
    this.updateMeter(dt);
  }
  private suspension(dt: number): void {
    const t = this.tuning,
      s = this.telemetry;
    const rest = t.get('suspRestLength') + G.wheelRadius;
    const maximum = rest + G.maxDroop;
    const frequency = t.get('suspFrequency');
    s.groundedWheels = 0;
    for (let i = 0; i < s.wheels.length; i++) {
      const wheel = s.wheels[i]!;
      const oldCompression = wheel.compression;
      const wasGrounded = wheel.grounded;
      wheel.mount
        .copy(G.mounts[i]!)
        .applyQuaternion(s.rotation)
        .add(s.position);
      wheel.grounded = this.world.rayCast(
        wheel.mount,
        this.down,
        maximum,
        wheel.hit,
        this.body,
      );
      // Physical contact remains grounded even when content cannot classify it.
      // The resolver gates misses before reading the reused hit's stale fields.
      wheel.surfaceId = this.resolveSurface(wheel.grounded, wheel.hit);
      const surface =
        wheel.surfaceId === null
          ? null
          : getKnownSurfaceDefinition(wheel.surfaceId);
      wheel.surfaceGripMultiplier = surface?.gripMultiplier ?? null;
      wheel.springForce =
        wheel.Fz =
        wheel.Fx =
        wheel.Fy =
        wheel.mu =
        wheel.gripUsage =
          0;
      wheel.spinning = wheel.locked = false;
      wheel.tireForceWorld.set(0, 0, 0);
      if (!wheel.grounded) {
        wheel.compression = -G.maxDroop;
        wheel.suspensionLength = t.get('suspRestLength') + G.maxDroop;
        wheel.alpha = wheel.rawAlpha = 0;
        wheel.centerLocal.copy(G.mounts[i]!);
        wheel.centerLocal.y -= wheel.suspensionLength;
        continue;
      }
      s.groundedWheels++;
      wheel.compression = Math.max(-G.maxDroop, rest - wheel.hit.distance);
      wheel.suspensionLength = Math.max(0, wheel.hit.distance - G.wheelRadius);
      wheel.centerLocal.copy(G.mounts[i]!);
      wheel.centerLocal.y -= wheel.suspensionLength;
      this.world.getPointVelocity(this.body, wheel.mount, this.pointVelocity);
      this.world.getPointVelocity(
        wheel.hit.bodyId,
        wheel.contactPoint,
        this.groundVelocity,
      );
      this.pointVelocity.sub(this.groundVelocity);
      const compressionSpeed = wasGrounded
        ? (wheel.compression - oldCompression) / dt
        : -this.pointVelocity.dot(wheel.contactNormal);
      const wheelMass =
        (this.mass.mass * (i < 2 ? this.frontShare : 1 - this.frontShare)) / 2;
      wheel.springForce = this.suspensionEnabled
        ? suspensionForce(
            wheel.compression,
            compressionSpeed,
            wheelMass,
            frequency,
            t.get('suspDampingRatio'),
            t.get('suspMaxTravel'),
          )
        : (this.mass.mass * t.get('gravity')) / 4;
    }
    if (this.suspensionEnabled) {
      for (let axle = 0; axle < 2; axle++) {
        const left = s.wheels[axle * 2]!,
          right = s.wheels[axle * 2 + 1]!;
        const wheelMass =
          (this.mass.mass *
            (axle === 0 ? this.frontShare : 1 - this.frontShare)) /
          2;
        const antiRoll =
          t.get('suspAntiRoll') *
          springRate(wheelMass, frequency) *
          (left.compression - right.compression);
        if (left.grounded)
          left.springForce = Math.max(0, left.springForce + antiRoll);
        if (right.grounded)
          right.springForce = Math.max(0, right.springForce - antiRoll);
      }
    }
    const downforce =
      this.mass.mass *
      t.get('gravity') *
      t.get('downforceAtTopSpeed') *
      (s.speed / t.get('topSpeed')) ** 2;
    this.force.copy(this.down).multiplyScalar(downforce);
    this.world.applyForceAtPoint(this.body, this.force, this.centerOfMass);
    for (const wheel of s.wheels) {
      if (!wheel.grounded) continue;
      wheel.Fz = wheel.springForce + downforce / s.groundedWheels;
      this.force.copy(wheel.contactNormal).multiplyScalar(wheel.springForce);
      this.world.applyForceAtPoint(this.body, this.force, wheel.mount);
    }
  }
  private steering(): void {
    const t = this.tuning,
      s = this.telemetry;
    this.lock = steeringLock(
      s.vLong,
      t.getRadians('steerMaxLowSpeed'),
      t.getRadians('steerMaxTopSpeed'),
      t.get('topSpeed'),
      t.get('steerSpeedExp'),
    );
    this.temp
      .copy(this.forward)
      .multiplyScalar(G.wheelbase / 2)
      .add(s.position);
    this.world.getPointVelocity(this.body, this.temp, this.pointVelocity);
    const betaFront = Math.atan2(
      this.pointVelocity.dot(this.right),
      Math.max(Math.abs(this.pointVelocity.dot(this.forward)), 0.1),
    );
    const gate =
      s.groundedWheels >= 3 ? smoothstep(3, 10, Math.abs(s.vLong)) : 0;
    s.steerAngle = clamp(
      this.controls.steer * this.lock +
        countersteerAngle(s.beta, betaFront, t.get('countersteerAssist'), gate),
      -1.25 * this.lock,
      1.25 * this.lock,
    );
  }
  private tires(dt: number): void {
    const t = this.tuning,
      s = this.telemetry,
      c = this.controls;
    const mass = this.mass.mass;
    const referenceLoad = (mass * t.get('gravity')) / 4;
    const reverse = c.brake > 0 && c.throttle === 0 && s.vLong < 1;
    s.brake01 = reverse ? 0 : c.brake;
    s.handbrake01 = c.handbrake ? 1 : 0;
    const engine = reverse
      ? -c.brake *
        reverseAcceleration(
          s.vLong,
          t.get('accel0'),
          t.get('reverseSpeed'),
          t.get('powerCurveExp'),
        )
      : c.throttle *
        engineAcceleration(
          s.vLong,
          t.get('accel0'),
          t.get('topSpeed'),
          t.get('powerCurveExp'),
          this.boostEnvelope,
          t.get('boostAccelMult'),
          t.get('boostTopSpeedAdd'),
        );
    const coast =
      (1 - c.throttle) * coastAcceleration(s.vLong, t.get('coastDecel'));
    const braking = reverse
      ? 0
      : t.get('brakeDecel') * c.brake ** t.get('brakeCurveExp');
    for (let i = 0; i < s.wheels.length; i++) {
      const wheel = s.wheels[i]!;
      const front = i < 2;
      wheel.steerAngle = front ? s.steerAngle : 0;
      if (!wheel.grounded || wheel.Fz <= 0) continue;
      const cosine = Math.cos(wheel.steerAngle),
        sine = Math.sin(wheel.steerAngle);
      wheel.forward
        .copy(this.forward)
        .multiplyScalar(cosine)
        .addScaledVector(this.right, -sine);
      wheel.forward
        .addScaledVector(
          wheel.contactNormal,
          -wheel.forward.dot(wheel.contactNormal),
        )
        .normalize();
      wheel.right.crossVectors(wheel.forward, wheel.contactNormal).normalize();
      this.world.getPointVelocity(
        this.body,
        wheel.contactPoint,
        this.pointVelocity,
      );
      this.world.getPointVelocity(
        wheel.hit.bodyId,
        wheel.contactPoint,
        this.groundVelocity,
      );
      this.pointVelocity.sub(this.groundVelocity);
      wheel.vx = this.pointVelocity.dot(wheel.forward);
      wheel.vy = this.pointVelocity.dot(wheel.right);
      wheel.rawAlpha = Math.atan2(wheel.vy, Math.max(Math.abs(wheel.vx), 0.1));
      wheel.alpha = relaxedSlip(
        wheel.alpha,
        wheel.rawAlpha,
        wheel.vx,
        dt,
        t.get('tireRelaxationLength'),
      );
      if (wheel.surfaceGripMultiplier === null) continue;
      wheel.mu = effectiveFriction(
        t.get(front ? 'gripFront' : 'gripRear'),
        t.get('surfaceGrip') * wheel.surfaceGripMultiplier,
        front ? 1 : c.rearGrip,
        wheel.Fz,
        referenceLoad,
        t.get('loadSensitivity'),
      );
      const capacity = wheel.mu * wheel.Fz;
      const staticShare = (front ? this.frontShare : 1 - this.frontShare) / 2;
      const wheelMass = mass * staticShare;
      const lateral = lateralForce(
        wheel.alpha,
        t.getRadians('peakSlipAngle'),
        t.get('slideGripRatio'),
        t.get('slipFalloffRate'),
        capacity,
        wheel.vx,
        wheel.vy,
        t.get('lowSpeedBlend'),
      );
      wheel.Fy = limitDissipativeForce(lateral, wheel.vy, wheelMass, dt);
      const longitudinalCap = longitudinalCapacity(
        capacity,
        wheel.Fy,
        t.get('combinedSlipCoupling'),
      );
      const drive =
        (mass *
          engine *
          (front ? 1 - t.get('driveBias') : t.get('driveBias'))) /
        2;
      const brakeCommand =
        (mass *
          braking *
          (front ? t.get('brakeBiasFront') : 1 - t.get('brakeBiasFront'))) /
        2;
      const brake = brakeForce(
        brakeCommand,
        wheel.vx,
        capacity,
        t.get('slideGripRatio'),
        t.get('absStrength'),
        wheelMass,
        dt,
      );
      const handbrake =
        !front && c.handbrake
          ? brakeForce(
              (mass * t.get('handbrakeDecel')) / 2,
              wheel.vx,
              capacity,
              t.get('slideGripRatio'),
              0,
              wheelMass,
              dt,
            )
          : 0;
      let passive = -mass * coast * staticShare;
      if (Math.abs(wheel.vx) < 0.3 && c.throttle === 0 && !reverse)
        passive += (-capacity * wheel.vx) / 0.1;
      const dissipative = limitDissipativeForce(
        passive + brake + handbrake,
        wheel.vx,
        wheelMass,
        dt,
      );
      const desired = drive + dissipative;
      wheel.Fx = clamp(desired, -longitudinalCap, longitudinalCap);
      wheel.spinning = Math.abs(drive) > longitudinalCap + 1e-6;
      wheel.locked =
        (c.handbrake && !front && Math.abs(wheel.vx) > 0.5) ||
        (t.get('absStrength') < 1 &&
          brakeCommand >
            capacity *
              (t.get('slideGripRatio') +
                (1 - t.get('slideGripRatio')) * t.get('absStrength')) &&
          Math.abs(wheel.vx) > 0.5);
      wheel.gripUsage =
        capacity > 0 ? Math.hypot(wheel.Fx, wheel.Fy) / capacity : 0;
      wheel.applyPoint.copy(wheel.contactPoint);
      this.temp.copy(this.centerOfMass).sub(wheel.contactPoint);
      wheel.applyPoint.addScaledVector(
        this.up,
        t.get('tireForceHeight') * Math.max(0, this.temp.dot(this.up)),
      );
      this.force
        .copy(wheel.forward)
        .multiplyScalar(wheel.Fx)
        .addScaledVector(wheel.right, wheel.Fy);
      wheel.tireForceWorld.copy(this.force);
      this.world.applyForceAtPoint(this.body, this.force, wheel.applyPoint);
    }
  }
  private assists(dt: number): void {
    const t = this.tuning,
      s = this.telemetry;
    const grip = gripYawTorque(
      this.controls.steer,
      this.lock,
      s.vLong,
      s.speed,
      s.beta,
      s.yawRate,
      t.get('gripRear') *
        t.get('surfaceGrip') *
        t.get('slideGripRatio') *
        t.get('gravity'),
      s.groundedWheels,
      t.get('yawAssist'),
      this.inertia.y,
    );
    const slide = this.drift.torque(
      dt,
      Math.atan2(s.vLat, s.vLong),
      s.vLong,
      s.groundedWheels,
      this.controls.steer,
      this.controls.throttle,
      this.controls.handbrake,
      t.getRadians('maxDriftAngle'),
      t.get('yawAssist'),
      this.inertia.y,
    );
    s.yawAssistTorque = grip + slide;
    this.torque.copy(this.up).multiplyScalar(s.yawAssistTorque);
    // D/E are stability safeguards, independent of tunable handling assists.
    if (s.groundedWheels < 2) {
      this.torque.addScaledVector(
        this.right,
        -0.8 * this.inertia.x * s.angularVelocity.dot(this.right),
      );
      this.torque.addScaledVector(
        this.forward,
        -0.8 * this.inertia.z * s.angularVelocity.dot(this.forward),
      );
    }
    const roll = Math.atan2(this.right.y, this.up.y);
    if (Math.abs(roll) > 35 * DEG && (s.speed < 3 || s.groundedWheels > 0)) {
      const correction = clamp(
        8 * roll - 2 * s.angularVelocity.dot(this.forward),
        -12,
        12,
      );
      this.torque.addScaledVector(this.forward, this.inertia.z * correction);
    }
    this.world.applyTorque(this.body, this.torque);
    s.driftLatched = this.drift.side !== 0;
    s.driftTarget = this.drift.target;
  }
  private updateMeter(dt: number): void {
    const t = this.tuning,
      s = this.telemetry;
    const boosting = this.controls.boost && this.meter > 0;
    this.boostEnvelope +=
      (1 - Math.exp(-dt / 0.2)) * ((boosting ? 1 : 0) - this.boostEnvelope);
    if (boosting)
      this.meter = Math.max(0, this.meter - t.get('boostDrainRate') * dt);
    s.charging =
      Math.abs(s.beta) >= t.getRadians('driftMinAngle') &&
      s.speed > 15 &&
      s.groundedWheels >= 2;
    if (s.charging)
      this.meter = Math.min(
        1,
        this.meter +
          t.get('driftChargeRate') *
            (Math.abs(s.beta) / (30 * DEG)) *
            (s.speed / 40) *
            dt,
      );
    s.boostMeter = s.driftMeter = this.meter;
    s.boostEnvelope = this.boostEnvelope;
    s.throttle = this.controls.throttle;
    s.brake = this.controls.brake;
    s.handbrake = this.controls.handbrake;
    // Derived after everything physical is final for this step.
    this.rpmModel.step(
      dt,
      s.vLong,
      s.throttle,
      s.boostEnvelope,
      t.get('engineRevLift'),
      s,
      t.get('gearSpacing'),
      t.get('gearCount'),
      t.get('topSpeed'),
      t.get('rpmRampExponent'),
    );
  }
  postStep(dt: number): void {
    this.readState();
    const s = this.telemetry;
    if (
      !Number.isFinite(
        s.position.x +
          s.position.y +
          s.position.z +
          s.rotation.x +
          s.rotation.y +
          s.rotation.z +
          s.rotation.w +
          s.velocity.x +
          s.velocity.y +
          s.velocity.z +
          s.angularVelocity.x +
          s.angularVelocity.y +
          s.angularVelocity.z,
      )
    ) {
      this.respawn();
      s.recoveryCount++;
      console.error('Vehicle state became non-finite; restored spawn pose.');
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-debugger
        debugger;
      }
      return;
    }
    this.temp
      .copy(s.velocity)
      .sub(this.previousVelocity)
      .multiplyScalar(1 / dt);
    const blend = 1 - Math.exp(-dt / 0.1);
    s.longitudinalAcceleration +=
      blend * (this.temp.dot(this.forward) - s.longitudinalAcceleration);
    s.lateralAcceleration +=
      blend * (this.temp.dot(this.right) - s.lateralAcceleration);
    for (const wheel of s.wheels) {
      wheel.spinDelta = wheel.locked
        ? 0
        : ((-wheel.vx * dt) / G.wheelRadius) * (wheel.spinning ? 1.5 : 1);
      wheel.spinAngle =
        (((wheel.spinAngle + wheel.spinDelta) % (2 * Math.PI)) + 2 * Math.PI) %
        (2 * Math.PI);
    }
  }
  /** Tuning-lab automation may refill the earned boost meter without executing a drift. */
  setDriftMeter(value: number): void {
    if (!Number.isFinite(value))
      throw new RangeError('Drift meter must be finite.');
    this.meter = clamp(value, 0, 1);
    this.telemetry.boostMeter = this.telemetry.driftMeter = this.meter;
  }
  respawn(
    position: V3 = this.spawn,
    rotation: Quat = this.spawnRotation,
  ): void {
    this.world.setTransform(this.body, position, rotation, true);
    this.controls.reset();
    this.drift.reset();
    this.boostEnvelope = this.meter = 0;
    this.telemetry.boostEnvelope =
      this.telemetry.boostMeter =
      this.telemetry.driftMeter =
        0;
    this.telemetry.driftLatched = this.telemetry.charging = false;
    this.telemetry.driftTarget = this.telemetry.yawAssistTorque = 0;
    this.telemetry.throttle =
      this.telemetry.brake =
      this.telemetry.brake01 =
      this.telemetry.handbrake01 =
        0;
    this.telemetry.handbrake = false;
    this.telemetry.groundedWheels = this.telemetry.steerAngle = 0;
    for (let i = 0; i < 4; i++) {
      const wheel = this.telemetry.wheels[i]!;
      wheel.grounded = wheel.spinning = wheel.locked = false;
      wheel.surfaceId = wheel.surfaceGripMultiplier = null;
      wheel.spinDelta = wheel.compression = wheel.springForce = wheel.Fz = 0;
      wheel.Fx = wheel.Fy = wheel.mu = wheel.gripUsage = wheel.steerAngle = 0;
      wheel.alpha = wheel.rawAlpha = wheel.vx = wheel.vy = wheel.spinAngle = 0;
      wheel.tireForceWorld.set(0, 0, 0);
      wheel.suspensionLength = this.tuning.get('suspRestLength');
      wheel.centerLocal.copy(G.mounts[i]!);
      wheel.centerLocal.y -= wheel.suspensionLength;
    }
    this.telemetry.longitudinalAcceleration =
      this.telemetry.lateralAcceleration = 0;
    this.rpmModel.reset(this.telemetry);
    this.readState();
    this.previousVelocity.copy(this.telemetry.velocity);
  }
}
