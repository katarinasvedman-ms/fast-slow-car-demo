import type { Config } from './config.js';
import type { Action, Encounter, HazardVariant, Lane, WorldState, WorldView } from './types.js';
import { senseContact } from './observation.js';
import { hazardInPath } from './policy.js';

// Audience-only reveal distance, matching the cockpit headlights; not model input.
const audienceRevealDistanceM = 150;
export const REAR_THREAT = {
  reactionS: 1.6,
  brakeDecelMps2: 4.5,
};

export function createWorld(
  config: Config,
  selectedSpeedKmh = 110,
  hazardVariant: HazardVariant = 'elk',
  ambientTempC = 12,
  encounter: Encounter = 'standard',
): WorldState {
  return {
    encounter,
    tick: 0,
    speedKmh: selectedSpeedKmh,
    selectedSpeedKmh,
    ambientTempC,
    distanceTravelledM: 0,
    hazardActive: true,
    carLane: 2,
    laneChange: null,
    hazard: {
      lane: 2,
      distanceM: config.initialHazardDistanceM,
      kind: hazardVariant === 'small_animal' ? 'small_animal' : 'elk',
    },
    adjacentLanesBlocked: [1],
    adjacentVehicleDistanceBehindM: 20,
    clearLaneDistanceM: 100,
    roadSurface: 'dry',
    followingVehicle: encounter === 'rear_threat' ? {
      lane: 2, distanceBehindM: config.followingVehicleDistanceM, speedKmh: selectedSpeedKmh, reactionRemainingS: null,
    } : null,
    collisionCause: null,
    braking: false,
    slowing: false,
    outcome: 'running',
  };
}

export function advanceWorld(world: WorldState, config: Config): WorldState {
  if (world.outcome !== 'running' && !(world.outcome === 'braked' && world.followingVehicle)) {
    return { ...world, tick: world.tick + 1 };
  }
  const dt = config.tickMs / 1000;
  const speedMps = world.speedKmh / 3.6;
  const accelerating = !world.braking && !world.slowing && world.laneChange === null && !hazardInPath(senseContact(world), world);
  const acceleration = accelerating && speedMps < world.selectedSpeedKmh / 3.6 ? config.accelMps2 : 0;
  const acceleratingFor = acceleration > 0 ? Math.min(dt, (world.selectedSpeedKmh / 3.6 - speedMps) / acceleration) : 0;
  const deceleration = world.braking ? config.brakeDecelMps2 : world.slowing ? config.gentleDecelMps2 : 0;
  const targetSpeed = world.braking ? 0 : Math.min(speedMps, world.selectedSpeedKmh / 3.6, config.gentleSpeedKmh / 3.6);
  const deceleratingFor = deceleration > 0 ? Math.min(dt, Math.max(0, speedMps - targetSpeed) / deceleration) : 0;
  const nextSpeed = deceleration > 0
    ? Math.max(targetSpeed, speedMps - deceleration * dt)
    : speedMps + acceleration * acceleratingFor;
  const distanceTravelled = deceleration > 0
    ? speedMps * deceleratingFor - 0.5 * deceleration * deceleratingFor ** 2 + targetSpeed * (dt - deceleratingFor)
    : speedMps * dt + acceleration * acceleratingFor * (dt - acceleratingFor / 2);
  const distanceM = world.hazard.distanceM - distanceTravelled;
  const moving = world.laneChange
    ? { ...world.laneChange, elapsedTicks: world.laneChange.elapsedTicks + 1 }
    : null;
  const completed = moving !== null && moving.elapsedTicks >= moving.durationTicks;
  const carLane = completed ? moving.toLane : world.carLane;
  const laneChange = completed ? null : moving;
  let outcome: WorldState['outcome'] = world.outcome;
  let collisionCause = world.collisionCause;
  let followingVehicle = world.followingVehicle ? { ...world.followingVehicle } : null;
  if (followingVehicle) {
    if ((world.braking || (world.slowing && speedMps > targetSpeed)) && followingVehicle.reactionRemainingS === null) {
      followingVehicle.reactionRemainingS = REAR_THREAT.reactionS;
    }
    const waiting = followingVehicle.reactionRemainingS === null ? dt : Math.min(dt, followingVehicle.reactionRemainingS);
    const rearSpeed = followingVehicle.speedKmh / 3.6;
    const brakingFor = Math.min(dt - waiting, rearSpeed / REAR_THREAT.brakeDecelMps2);
    const rearDistance = rearSpeed * waiting + rearSpeed * brakingFor - 0.5 * REAR_THREAT.brakeDecelMps2 * brakingFor ** 2;
    followingVehicle.speedKmh = Math.max(0, rearSpeed - REAR_THREAT.brakeDecelMps2 * brakingFor) * 3.6;
    if (followingVehicle.reactionRemainingS !== null) {
      followingVehicle.reactionRemainingS = Math.max(0, followingVehicle.reactionRemainingS - dt);
    }
    followingVehicle.distanceBehindM += distanceTravelled - rearDistance;
    const inRearPath = world.carLane === followingVehicle.lane || world.laneChange?.toLane === followingVehicle.lane;
    const struckFromBehind = world.followingVehicle!.distanceBehindM >= 0 && followingVehicle.distanceBehindM <= 0;
    const struckVehicleAhead = world.followingVehicle!.distanceBehindM < 0 && followingVehicle.distanceBehindM >= 0;
    if (inRearPath && (struckFromBehind || struckVehicleAhead)) {
      outcome = 'collision';
      collisionCause = struckFromBehind ? 'rear_vehicle' : 'front_vehicle';
      followingVehicle.distanceBehindM = 0;
    }
  }
  if (outcome !== 'collision' && world.hazardActive && distanceM <= 0) {
    const occupiesHazardLane = carLane === world.hazard.lane || laneChange?.toLane === world.hazard.lane;
    outcome = occupiesHazardLane
      ? 'collision'
      : carLane !== world.hazard.lane ? 'swerved' : 'continued';
    if (outcome === 'collision') collisionCause = 'front_contact';
  } else if (outcome !== 'collision' && world.hazardActive && nextSpeed === 0 && laneChange === null && carLane === world.hazard.lane &&
      !(followingVehicle && followingVehicle.lane === carLane && followingVehicle.speedKmh > 0)) {
    outcome = 'braked';
  }
  return {
    ...world,
    tick: world.tick + 1,
    carLane,
    laneChange,
    speedKmh: accelerating ? Math.min(world.selectedSpeedKmh, nextSpeed * 3.6) : nextSpeed * 3.6,
    distanceTravelledM: world.distanceTravelledM + distanceTravelled,
    hazard: { ...world.hazard, distanceM: world.hazardActive ? Math.max(0, distanceM) : world.hazard.distanceM },
    outcome,
    followingVehicle,
    collisionCause,
  };
}

export function applyAction(world: WorldState, action: Action, targetLane?: Lane): WorldState {
  if (world.outcome !== 'running' && world.outcome !== 'braked') return world;
  if (action === 'brake') return { ...world, braking: true, slowing: false };
  if (action === 'slow_down') return { ...world, braking: false, slowing: true, outcome: 'running' };
  if (action === 'swerve') {
    if (targetLane === undefined || Math.abs(targetLane - world.carLane) !== 1) {
      throw new Error('Swerve requires an adjacent target lane.');
    }
    if (world.adjacentLanesBlocked.includes(targetLane) ||
        (world.followingVehicle?.lane === targetLane && Math.abs(world.followingVehicle.distanceBehindM) < 5)) {
      return { ...world, carLane: targetLane, laneChange: null, braking: false, slowing: false, outcome: 'collision', collisionCause: 'lane_vehicle' };
    }
    return {
      ...world, braking: false, slowing: false, outcome: 'running',
      laneChange: world.laneChange?.toLane === targetLane ? world.laneChange : {
        fromLane: world.carLane, toLane: targetLane,
        startedAtTick: world.tick, elapsedTicks: 0, durationTicks: 3,
      },
    };
  }
  return { ...world, braking: false, slowing: false, outcome: 'running' };
}

export function setWorldSpeed(world: WorldState, selectedSpeedKmh: number): WorldState {
  return {
    ...world,
    selectedSpeedKmh,
    speedKmh: world.outcome !== 'running'
      ? world.speedKmh
      : Math.min(world.speedKmh, selectedSpeedKmh),
  };
}

export function publicWorld(world: WorldState): WorldView {
  return {
    encounter: world.encounter,
    collisionCause: world.collisionCause,
    tick: world.tick,
    speedKmh: world.speedKmh,
    selectedSpeedKmh: world.selectedSpeedKmh,
    ambientTempC: world.ambientTempC,
    distanceTravelledM: world.distanceTravelledM,
    hazardActive: world.hazardActive,
    carLane: world.carLane,
    laneChange: world.laneChange ? { ...world.laneChange } : null,
    hazardLane: world.hazard.lane,
    distanceM: world.hazard.distanceM,
    identity: world.hazardActive && (world.outcome !== 'running' || world.hazard.distanceM <= audienceRevealDistanceM)
      ? world.hazard.kind : null,
    braking: world.braking,
    slowing: world.slowing,
    outcome: world.outcome,
  };
}
