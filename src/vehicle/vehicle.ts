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
import { AirStateTracker } from './airState';
import { airControlTorques } from './airControl';
import type {
  AirAttitude,
  AirControlInputs,
  AirControlTorques,
  AirControlTuning,
} from './airControl';
import {
  createImpactSeverity,
  estimateImpactSeverity,
} from '../core/impactSeverity';
import type { ImpactSeverity } from '../core/impactSeverity';
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

/** Righting torque was tuned against the original 14.7 m/s² default; scale
 * its cap with gravity so heavier ground contact cannot strand a roofed car. */
const RIGHTING_REFERENCE_GRAVITY = 14.7;
export const MAX_BOOST_SECTIONS = 4;

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
  private readonly groundNormal = new Vector3();
  private readonly chassisContactNormal = new Vector3();
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
  private boostSections = 1;
  private boostEnvelope = 0;
  /** Derived rpm and virtual gear for presentation; reads telemetry, writes
   * telemetry, never touches forces or controls. */
  private readonly rpmModel = new RpmModel(DEFAULT_ENGINE);
  private readonly airState = new AirStateTracker();
  private wasAirborneForControl = false;
  /** Seconds with every wheel off the ground, last step's value: the air
   * control clock. It keeps running on a roof or a door, where it helps the
   * assist right a leaning car, unlike the flight clock (airState). Dead
   * flat on the roof it yields to the lift below: left running there it
   * held the roof down against it. */
  private wheelsOffSeconds = 0;
  /** A roof lift can settle onto two wheels while road-speed suspension
   * forces cancel the ordinary righting torque. Keep extra authority only
   * through that roof-to-upright handoff, never for a standalone door slide. */
  private recoveringFromRoof = false;
  private previousGroundedWheels = 0;
  private readonly airInputs: AirControlInputs = {
    throttle: 0,
    brake: 0,
    steer: 0,
    throttleAtTakeoff: 0,
  };
  private readonly airAttitude: AirAttitude = {
    pitchAngle: 0,
    rollAngle: 0,
    pitchRate: 0,
    rollRate: 0,
    inertiaPitch: 0,
    inertiaRoll: 0,
  };
  private readonly airTuning: AirControlTuning = {
    authorityTurnsPerSecond: 0,
    autoLevel: 0,
  };
  private readonly airTorques: AirControlTorques = {
    pitch: 0,
    roll: 0,
    weight: 0,
  };
  /** Severity of the latest counted landing, the same record a wall hit
   * produces, so camera, haptics, audio and scoring treat both alike. */
  readonly landingImpact: ImpactSeverity = createImpactSeverity();

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
    wreckControl = false,
  ): void {
    this.controls.update(input, source, this.tuning, dt);
    this.readState();
    this.previousVelocity.copy(this.telemetry.velocity);
    this.world.setGravity(this.tuning.get('gravity'));
    this.suspension(dt);
    this.telemetry.airLaunch.active =
      this.previousGroundedWheels > 0 && this.telemetry.groundedWheels === 0;
    if (this.telemetry.airLaunch.active) {
      this.telemetry.airLaunch.position.copy(this.telemetry.position);
      this.telemetry.airLaunch.velocity.copy(this.previousVelocity);
    }
    this.previousGroundedWheels = this.telemetry.groundedWheels;
    this.steering();
    this.tires(dt);
    this.assists(dt, wreckControl);
    this.updateMeter(dt);
  }
  /** Horizontal player steering of a wreck. No new body, upward force or
   * teleport; the episode owner limits total added lateral velocity. */
  applyAftertouch(steer: number, deltaVelocity: number, dt: number): void {
    if (dt <= 0 || !Number.isFinite(steer)) return;
    const length = Math.hypot(this.forward.x, this.forward.z);
    if (length < 0.2) return;
    this.force.set(
      (this.forward.z / length) * this.mass.mass * (deltaVelocity / dt),
      0,
      (-this.forward.x / length) * this.mass.mass * (deltaVelocity / dt),
    );
    this.world.applyForceAtPoint(this.body, this.force, this.centerOfMass);
    const targetYaw = clamp(steer, -1, 1) * (45 * DEG);
    const yawAcceleration = clamp(
      (targetYaw - this.telemetry.angularVelocity.y) / dt,
      -3,
      3,
    );
    this.torque.set(0, this.inertia.y * yawAcceleration, 0);
    this.world.applyTorque(this.body, this.torque);
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
      wheel.surfaceGripMultiplier =
        surface === null
          ? null
          : surface.context === 'ground' && surface.gripTuning
            ? surface.gripMultiplier * this.tuning.get(surface.gripTuning)
            : surface.gripMultiplier;
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
    // Aero downforce acts along the body's down axis, so it must not act on
    // an airborne car: in flight it would carry a body-relative force and
    // push an inverted car upward in world space. With any wheel grounded
    // it is unchanged, which keeps the flat-track regressions identical.
    const downforce =
      s.groundedWheels === 0
        ? 0
        : this.mass.mass *
          t.get('gravity') *
          t.get('downforceAtTopSpeed') *
          (s.speed / t.get('topSpeed')) ** 2;
    if (downforce > 0) {
      this.force.copy(this.down).multiplyScalar(downforce);
      this.world.applyForceAtPoint(this.body, this.force, this.centerOfMass);
    }
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
  private assists(dt: number, wreckControl = false): void {
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
    // The flight damping used to be a hardcoded 0.8; airDamping tunes it.
    const pitchRate = s.angularVelocity.dot(this.right);
    const rollRate = s.angularVelocity.dot(this.forward);
    if (s.groundedWheels < 2) {
      const damping = t.get('airDamping');
      this.torque.addScaledVector(
        this.right,
        -damping * this.inertia.x * pitchRate,
      );
      this.torque.addScaledVector(
        this.forward,
        -damping * this.inertia.z * rollRate,
      );
    }
    // Righting reference. The roll-righting assist exists to rescue a car
    // that is flipped on the ground, so "flipped" is measured against the
    // ground actually under the car: the mean wheel contact normal, then
    // the static surface supporting its chassis when no wheel touches.
    // The existing slow-speed rescue remains for a sleeping roofed chassis:
    // Jolt stops reporting persistent contacts once that body sleeps.
    let contacts = 0;
    this.groundNormal.set(0, 0, 0);
    for (const wheel of s.wheels)
      if (wheel.grounded) {
        this.groundNormal.add(wheel.contactNormal);
        contacts++;
      }
    if (contacts > 0) this.groundNormal.normalize();
    else if (this.chassisContact && this.chassisContactNormal.lengthSq() > 0)
      this.groundNormal.copy(this.chassisContactNormal).normalize();
    else this.groundNormal.set(0, 1, 0);
    const roll = Math.atan2(
      this.right.dot(this.groundNormal),
      this.up.dot(this.groundNormal),
    );
    // Air control (design slice B3): pitch and roll authority plus optional
    // self-levelling once fully airborne past the kerb-hop gate. The clock
    // is last step's value and is 0 whenever any wheel is grounded, so
    // intermittent kerb contact never grants authority.
    const airborne = s.groundedWheels === 0;
    if (airborne && !this.wasAirborneForControl)
      this.airInputs.throttleAtTakeoff = this.controls.throttle;
    this.wasAirborneForControl = airborne;
    const wheelsOff = this.wheelsOffSeconds;
    this.wheelsOffSeconds = airborne ? wheelsOff + dt : 0;
    const flatOnRoof =
      this.chassisContact && Math.abs(roll) > Math.PI - 15 * DEG;
    if (!wreckControl && airborne && wheelsOff > 0 && !flatOnRoof) {
      this.airInputs.throttle = this.controls.throttle;
      this.airInputs.brake = this.controls.brake;
      this.airInputs.steer = this.controls.steer;
      this.airAttitude.pitchAngle = Math.asin(clamp(this.forward.y, -1, 1));
      this.airAttitude.rollAngle = roll;
      this.airAttitude.pitchRate = pitchRate;
      this.airAttitude.rollRate = rollRate;
      this.airAttitude.inertiaPitch = this.inertia.x;
      this.airAttitude.inertiaRoll = this.inertia.z;
      this.airTuning.authorityTurnsPerSecond = t.get('airControlAuthority');
      this.airTuning.autoLevel = t.get('airAutoLevel');
      airControlTorques(
        wheelsOff,
        this.airInputs,
        this.airAttitude,
        this.airTuning,
        this.airTorques,
      );
      this.torque.addScaledVector(this.right, this.airTorques.pitch);
      this.torque.addScaledVector(this.forward, this.airTorques.roll);
    } else this.airTorques.weight = 0;
    s.airControlWeight = this.airTorques.weight;
    if (
      !wreckControl &&
      Math.abs(roll) > 35 * DEG &&
      (s.speed < 3 || s.groundedWheels > 0 || this.chassisContact)
    ) {
      const gravityScale = t.get('gravity') / RIGHTING_REFERENCE_GRAVITY;
      const roofDoorHandoff =
        this.recoveringFromRoof && s.groundedWheels > 0 && s.groundedWheels < 3;
      const rightingCap = (roofDoorHandoff ? 36 : 12) * gravityScale;
      const correction = clamp(
        ((roofDoorHandoff ? 24 : 8) * roll -
          2 * s.angularVelocity.dot(this.forward)) *
          gravityScale,
        -rightingCap,
        rightingCap,
      );
      this.torque.addScaledVector(this.forward, this.inertia.z * correction);
      // A level roof has no raised edge for that torque to tip over. Lift one
      // side just until a natural roll starts; the ordinary torque then takes
      // over. Keep this off flights and relative to the contacted surface.
      if (
        Math.abs(roll) > Math.PI - 15 * DEG &&
        (this.chassisContact || (s.speed < 3 && !s.airborne))
      ) {
        this.recoveringFromRoof = true;
        this.force
          .copy(this.groundNormal)
          .multiplyScalar(this.mass.mass * t.get('gravity') * 0.6);
        this.temp
          .copy(this.centerOfMass)
          .addScaledVector(this.right, G.width / 2);
        this.world.applyForceAtPoint(this.body, this.force, this.temp);
      }
    }
    if (
      this.recoveringFromRoof &&
      s.groundedWheels >= 3 &&
      Math.abs(roll) < 35 * DEG
    )
      this.recoveringFromRoof = false;
    this.world.applyTorque(this.body, this.torque);
    s.driftLatched = this.drift.side !== 0;
    s.driftTarget = this.drift.target;
  }
  /** An accelerator pad: add `kick` m/s along the car's heading, on the
   * ground plane, and grant `boost` of the bar. Called from boot between
   * physics steps, never inside the engine's step. */
  applyPad(kick: number, boost: number): void {
    const s = this.telemetry;
    if (Number.isFinite(kick) && kick > 0) {
      this.world.getLinearVelocity(this.body, this.padVelocity);
      const fx = this.forward.x,
        fz = this.forward.z;
      const norm = Math.hypot(fx, fz) || 1;
      this.padVelocity.x += (fx / norm) * kick;
      this.padVelocity.z += (fz / norm) * kick;
      this.world.setLinearVelocity(this.body, this.padVelocity);
    }
    if (Number.isFinite(boost) && boost > 0) {
      this.meter = Math.min(this.boostSections, this.meter + boost);
      s.boostMeter = s.driftMeter = this.meter;
    }
  }
  /** A takedown adds one spendable bar section, capped at four. */
  awardTakedown(): void {
    this.boostSections = Math.min(MAX_BOOST_SECTIONS, this.boostSections + 1);
    this.meter = Math.min(this.boostSections, this.meter + 1);
    this.telemetry.boostSections = this.boostSections;
    this.telemetry.boostMeter = this.telemetry.driftMeter = this.meter;
  }
  /** A player wreck removes one earned section; wired by the wreck slice. */
  loseBoostSection(): void {
    this.boostSections = Math.max(1, this.boostSections - 1);
    this.meter = Math.min(this.meter, this.boostSections);
    this.telemetry.boostSections = this.boostSections;
    this.telemetry.boostMeter = this.telemetry.driftMeter = this.meter;
  }
  private readonly padVelocity: V3 = { x: 0, y: 0, z: 0 };
  /** The current flight launched upward, so it earns boost (see updateMeter). */
  private flightCounts = false;
  /** The chassis touched a static body during the last physics step; the
   * world's contact hook reports it. It ends a flight (see airState). */
  private chassisContact = false;
  noteChassisContact(normalIntoVehicle?: V3): void {
    this.chassisContact = true;
    if (normalIntoVehicle)
      this.chassisContactNormal.set(
        normalIntoVehicle.x,
        normalIntoVehicle.y,
        normalIntoVehicle.z,
      );
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
        this.boostSections,
        this.meter +
          t.get('driftChargeRate') *
            (Math.abs(s.beta) / (30 * DEG)) *
            (s.speed / 40) *
            dt,
      );
    // Big air (2026-09-28): a flight pays quadratically in time aloft,
    // meter += airChargeRate * airTime * dt, so a committed jump pays four
    // to eight times a hop and a kerb bounce pays nothing worth counting
    // (measured: the giant ramp 1.5 to 2.1 s, small ramps 0.7 to 1.0 s,
    // bounces 0.1 to 0.3 s; airtime barely grows with speed because the
    // flight is the drop from the lip, so a flat rate could not tell them
    // apart). Only a flight that LAUNCHED upward counts: the #158 seam's
    // airLaunch.velocity.y on the step the wheels left; rolling off a ledge
    // is not a jump. airborne and airTime are last step's derived state
    // (airState runs below), so charging starts on the flight's second step.
    if (s.airLaunch.active) this.flightCounts = s.airLaunch.velocity.y > 0;
    else if (s.groundedWheels > 0 || this.chassisContact)
      this.flightCounts = false;
    if (s.airborne && this.flightCounts)
      this.meter = Math.min(
        this.boostSections,
        this.meter + t.get('airChargeRate') * s.airTime * dt,
      );
    s.boostMeter = s.driftMeter = this.meter;
    s.boostEnvelope = this.boostEnvelope;
    s.throttle = this.controls.throttle;
    s.brake = this.controls.brake;
    s.handbrake = this.controls.handbrake;
    // Derived after everything physical is final for this step.
    const landingsBefore = s.landingCount;
    this.airState.step(dt, s.groundedWheels, this.chassisContact, s);
    this.chassisContact = false;
    this.chassisContactNormal.set(0, 0, 0);
    if (s.landingCount !== landingsBefore) {
      // A landing is an impact like any other: pre-step velocity against the
      // first grounded wheel's contact normal, through the shared estimator.
      let normal: Vector3 | null = null;
      for (const wheel of s.wheels)
        if (wheel.grounded) {
          normal = wheel.contactNormal;
          break;
        }
      estimateImpactSeverity(
        null,
        this.previousVelocity,
        normal ?? this.up,
        this.mass.mass,
        this.landingImpact,
      );
      s.landingSpeed = this.landingImpact.approachSpeed;
      s.landingSeverity = this.landingImpact.severity;
    }
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
    this.meter = clamp(value, 0, this.boostSections);
    this.telemetry.boostMeter = this.telemetry.driftMeter = this.meter;
  }
  respawn(
    position: V3 = this.spawn,
    rotation: Quat = this.spawnRotation,
    boostSections = 1,
  ): void {
    this.world.setTransform(this.body, position, rotation, true);
    this.controls.reset();
    this.drift.reset();
    this.boostEnvelope = this.meter = 0;
    this.boostSections = this.telemetry.boostSections = Math.max(
      1,
      Math.min(MAX_BOOST_SECTIONS, Math.trunc(boostSections)),
    );
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
    this.telemetry.airLaunch.active = false;
    this.flightCounts = false;
    this.chassisContact = false;
    this.chassisContactNormal.set(0, 0, 0);
    this.wheelsOffSeconds = 0;
    this.recoveringFromRoof = false;
    this.previousGroundedWheels = 0;
    this.rpmModel.reset(this.telemetry);
    this.airState.reset(this.telemetry);
    this.readState();
    this.previousVelocity.copy(this.telemetry.velocity);
  }
}
