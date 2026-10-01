/** Traffic events: the fast boost earners (NS4, 2026-09-30). Pure state fed
 * the player's pose and the traffic cars each physics step; it owns no DOM
 * and no physics. Only awake, unwrecked cars are traffic: a car asleep in
 * the lane 200 m back is a parked obstacle, and a wreck is scenery.
 *
 * - NEAR MISS: a car passes within `nearMissGap` metres edge to edge at a
 *   closing speed of at least `nearMissClosing`, once per car per pass,
 *   voided when the player touched that car during the pass.
 * - WRONG SIDE: an oncoming car (its heading opposes the player's) is ahead
 *   within `wrongSideReach` and within a lane's width of the player's line
 *   while the player is moving; pays per second.
 * - SLAM: a contact with a traffic car, paid by the shared impact severity,
 *   once per car per contact episode. */
export interface TrafficCarView {
  readonly id: number;
  readonly bodyId: number;
  readonly position: { readonly x: number; readonly z: number };
  readonly forward: { readonly x: number; readonly z: number };
  readonly velocity: { readonly x: number; readonly z: number };
  readonly wrecked: boolean;
}

export interface PlayerView {
  readonly position: { readonly x: number; readonly z: number };
  readonly forward: { readonly x: number; readonly z: number };
  readonly velocity: { readonly x: number; readonly z: number };
  readonly speed: number;
}

export interface TrafficEventTuning {
  /** Edge-to-edge gap, metres, below which a pass is a near miss. */
  readonly nearMissGap: number;
  /** Closing speed, m/s, at or above which a pass is a near miss. */
  readonly nearMissClosing: number;
  /** Bar granted per near miss. */
  readonly nearMissBoost: number;
  /** How far ahead, metres, an oncoming car counts as wrong-side driving. */
  readonly wrongSideReach: number;
  /** Bar granted per second of wrong-side driving. */
  readonly wrongSideRate: number;
  /** Bar granted by a slam at full severity. */
  readonly slamBoost: number;
}

export type TrafficEventKind = 'near-miss' | 'oncoming' | 'slam';

export interface TrafficEventsState {
  nearMisses: number;
  slams: number;
  /** Seconds spent on the wrong side with oncoming traffic, cumulative. */
  wrongSideSeconds: number;
  /** True this step while an oncoming car is in reach. */
  oncoming: boolean;
  /** The most recent event, kept for the HUD label. */
  lastEvent: TrafficEventKind | null;
  /** Seconds the HUD label has left to show; counts down in sim time. */
  labelSeconds: number;
  /** Bar granted this step by every detector together. */
  grant: number;
}

/** The two half widths, player and traffic car, that turn a centre distance
 * into an edge-to-edge gap. The traffic body is 1.9 m wide, the player 2.0. */
export const CAR_HALF_WIDTHS = 1.95;
/** A pass is over, and the near miss re-arms, this far away from the car. */
export const NEAR_MISS_RESET_DISTANCE = 30;
/** Half a lane: an oncoming car within this of the player's line is in it. */
export const WRONG_SIDE_HALF_WIDTH = 4;
/** Below this player speed nothing on the wrong side counts. */
export const WRONG_SIDE_MIN_SPEED = 15;
/** An oncoming car's heading opposes the player's below this dot product. */
export const ONCOMING_DOT = -0.5;
/** A slam re-arms after this long with no contact with that car. */
export const SLAM_REARM_SECONDS = 1;
/** How long the HUD label shows. */
export const EVENT_LABEL_SECONDS = 1.2;

interface CarTrack {
  /** Centre distance last step. */
  distance: number;
  /** Smallest centre distance so far in this pass. */
  closest: number;
  /** Relative speed at the closest point so far. */
  closingAtClosest: number;
  /** The near miss fired for this pass, or the pass was voided by contact. */
  passSpent: boolean;
  /** Sim time of the last contact with this car; -Infinity when none. */
  lastContactAt: number;
  /** Sim time this track was last seen in the traffic list. */
  seenAt: number;
}

export interface TrafficEvents {
  readonly state: Readonly<TrafficEventsState>;
  /** Advance one physics step; returns the bar to grant this step. */
  update(
    dt: number,
    player: PlayerView,
    cars: readonly TrafficCarView[],
    tuning: TrafficEventTuning,
  ): number;
  /** The player's chassis touched a traffic body this step, at this shared
   * severity (0..1). Call from the world's contact hook; the grant lands on
   * the next update. */
  noteContact(bodyId: number, severity: number): void;
  reset(): void;
}

export function createTrafficEvents(): TrafficEvents {
  const state: TrafficEventsState = {
    nearMisses: 0,
    slams: 0,
    wrongSideSeconds: 0,
    oncoming: false,
    lastEvent: null,
    labelSeconds: 0,
    grant: 0,
  };
  const tracks = new Map<number, CarTrack>();
  const bodyToId = new Map<number, number>();
  const pendingSlams: { bodyId: number; severity: number }[] = [];
  let time = 0;

  const trackFor = (car: TrafficCarView): CarTrack => {
    let track = tracks.get(car.id);
    if (!track) {
      track = {
        distance: Infinity,
        closest: Infinity,
        closingAtClosest: 0,
        passSpent: false,
        lastContactAt: -Infinity,
        seenAt: time,
      };
      tracks.set(car.id, track);
    }
    return track;
  };

  const fire = (kind: TrafficEventKind, bar: number): void => {
    state.lastEvent = kind;
    state.labelSeconds = EVENT_LABEL_SECONDS;
    state.grant += bar;
  };

  return {
    state,
    update(dt, player, cars, tuning) {
      time += dt;
      state.grant = 0;
      state.oncoming = false;
      state.labelSeconds = Math.max(0, state.labelSeconds - dt);
      bodyToId.clear();
      for (const car of cars) {
        if (car.wrecked) continue;
        bodyToId.set(car.bodyId, car.id);
        const track = trackFor(car);
        track.seenAt = time;
        const dx = car.position.x - player.position.x;
        const dz = car.position.z - player.position.z;
        const distance = Math.hypot(dx, dz);
        // Near miss: the closest point of the pass, judged once it opens up.
        if (distance < track.closest) {
          track.closest = distance;
          track.closingAtClosest = Math.hypot(
            player.velocity.x - car.velocity.x,
            player.velocity.z - car.velocity.z,
          );
        }
        if (
          !track.passSpent &&
          distance > track.closest + 1 &&
          track.closest - CAR_HALF_WIDTHS <= tuning.nearMissGap &&
          track.closingAtClosest >= tuning.nearMissClosing &&
          time - track.lastContactAt > SLAM_REARM_SECONDS
        ) {
          track.passSpent = true;
          state.nearMisses++;
          fire('near-miss', tuning.nearMissBoost);
        }
        if (distance > NEAR_MISS_RESET_DISTANCE) {
          track.closest = distance;
          track.passSpent = false;
        }
        track.distance = distance;
        // Wrong side: an oncoming car ahead, inside the player's lane line.
        const dot =
          car.forward.x * player.forward.x + car.forward.z * player.forward.z;
        if (dot < ONCOMING_DOT && player.speed >= WRONG_SIDE_MIN_SPEED) {
          const along = dx * player.forward.x + dz * player.forward.z;
          const lateral = Math.abs(
            dx * player.forward.z - dz * player.forward.x,
          );
          if (
            along > 0 &&
            along <= tuning.wrongSideReach &&
            lateral <= WRONG_SIDE_HALF_WIDTH
          )
            state.oncoming = true;
        }
      }
      if (state.oncoming) {
        state.wrongSideSeconds += dt;
        state.grant += tuning.wrongSideRate * dt;
        if (state.lastEvent !== 'oncoming' || state.labelSeconds <= 0) {
          state.lastEvent = 'oncoming';
          state.labelSeconds = EVENT_LABEL_SECONDS;
        }
      }
      // Slams reported since the last step, one per car per episode.
      for (const slam of pendingSlams) {
        const id = bodyToId.get(slam.bodyId);
        if (id === undefined) continue; // Asleep or wrecked: an obstacle, not traffic.
        const track = tracks.get(id);
        if (!track) continue;
        const armed = time - track.lastContactAt > SLAM_REARM_SECONDS;
        track.lastContactAt = time;
        track.passSpent = true; // Touching the car is not a near miss.
        if (armed && slam.severity > 0) {
          state.slams++;
          fire('slam', tuning.slamBoost * slam.severity);
        }
      }
      pendingSlams.length = 0;
      // Forget cars not seen for a while; encounter ids never come back.
      for (const [id, track] of tracks)
        if (time - track.seenAt > 60) tracks.delete(id);
      return state.grant;
    },
    noteContact(bodyId, severity) {
      for (const slam of pendingSlams)
        if (slam.bodyId === bodyId) {
          slam.severity = Math.max(slam.severity, severity);
          return;
        }
      pendingSlams.push({ bodyId, severity });
    },
    reset() {
      state.nearMisses = state.slams = 0;
      state.wrongSideSeconds = 0;
      state.oncoming = false;
      state.lastEvent = null;
      state.labelSeconds = 0;
      state.grant = 0;
      tracks.clear();
      bodyToId.clear();
      pendingSlams.length = 0;
    },
  };
}
