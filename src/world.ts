import type { Config } from './config.js';
import type { Action, HazardVariant, Lane, WorldState, WorldView } from './types.js';
import { senseContact } from './observation.js';
import { hazardInPath } from './policy.js';

export function createWorld(
  config: Config,
  selectedSpeedKmh = 90,
  hazardVariant: HazardVariant = 'elk',
  ambientTempC = 12,
): WorldState {
  return {
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
    braking: false,
    outcome: 'running',
  };
}

export function advanceWorld(world: WorldState, config: Config): WorldState {
  if (world.outcome !== 'running') return { ...world, tick: world.tick + 1 };
  const dt = config.tickMs / 1000;
  const speedMps = world.speedKmh / 3.6;
  const accelerating = !world.braking && world.laneChange === null && !hazardInPath(senseContact(world), world);
  const acceleration = accelerating && speedMps < world.selectedSpeedKmh / 3.6 ? config.accelMps2 : 0;
  const acceleratingFor = acceleration > 0 ? Math.min(dt, (world.selectedSpeedKmh / 3.6 - speedMps) / acceleration) : 0;
  const elapsedMoving = world.braking
    ? Math.min(dt, speedMps / config.brakeDecelMps2)
    : dt;
  const nextSpeed = world.braking
    ? Math.max(0, speedMps - config.brakeDecelMps2 * dt)
    : speedMps + acceleration * acceleratingFor;
  const distanceTravelled = world.braking
    ? speedMps * elapsedMoving - 0.5 * config.brakeDecelMps2 * elapsedMoving ** 2
    : speedMps * dt + acceleration * acceleratingFor * (dt - acceleratingFor / 2);
  const distanceM = world.hazard.distanceM - distanceTravelled;
  const moving = world.laneChange
    ? { ...world.laneChange, elapsedTicks: world.laneChange.elapsedTicks + 1 }
    : null;
  const completed = moving !== null && moving.elapsedTicks >= moving.durationTicks;
  const carLane = completed ? moving.toLane : world.carLane;
  const laneChange = completed ? null : moving;
  let outcome: WorldState['outcome'] = world.outcome;
  if (world.hazardActive && distanceM <= 0) {
    const occupiesHazardLane = carLane === world.hazard.lane || laneChange?.toLane === world.hazard.lane;
    outcome = occupiesHazardLane && world.hazard.kind === 'elk'
      ? 'collision'
      : carLane !== world.hazard.lane ? 'swerved' : 'continued';
  } else if (world.hazardActive && nextSpeed === 0 && laneChange === null && carLane === world.hazard.lane) {
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
  };
}

export function applyAction(world: WorldState, action: Action, targetLane?: Lane): WorldState {
  if (world.outcome !== 'running' && world.outcome !== 'braked') return world;
  if (action === 'brake') return { ...world, braking: true };
  if (action === 'swerve') {
    if (targetLane === undefined || Math.abs(targetLane - world.carLane) !== 1) {
      throw new Error('Swerve requires an adjacent target lane.');
    }
    if (world.adjacentLanesBlocked.includes(targetLane)) {
      return { ...world, carLane: targetLane, laneChange: null, braking: false, outcome: 'collision' };
    }
    return {
      ...world, braking: false, outcome: 'running',
      laneChange: world.laneChange?.toLane === targetLane ? world.laneChange : {
        fromLane: world.carLane, toLane: targetLane,
        startedAtTick: world.tick, elapsedTicks: 0, durationTicks: 3,
      },
    };
  }
  return { ...world, braking: false, outcome: 'running' };
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
    identity: !world.hazardActive || world.outcome === 'running' ? null : world.hazard.kind,
    braking: world.braking,
    outcome: world.outcome,
  };
}
