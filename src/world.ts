import type { Config } from './config.js';
import type { Action, HazardVariant, Lane, WorldState, WorldView } from './types.js';

export function createWorld(
  config: Config,
  selectedSpeedKmh = 90,
  hazardVariant: HazardVariant = 'elk',
): WorldState {
  return {
    tick: 0,
    speedKmh: selectedSpeedKmh,
    selectedSpeedKmh,
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
  const elapsedMoving = world.braking
    ? Math.min(dt, speedMps / config.brakeDecelMps2)
    : dt;
  const nextSpeed = world.braking
    ? Math.max(0, speedMps - config.brakeDecelMps2 * dt)
    : speedMps;
  const distanceTravelled = world.braking
    ? speedMps * elapsedMoving - 0.5 * config.brakeDecelMps2 * elapsedMoving ** 2
    : speedMps * dt;
  const distanceM = world.hazard.distanceM - distanceTravelled;
  const moving = world.laneChange
    ? { ...world.laneChange, elapsedTicks: world.laneChange.elapsedTicks + 1 }
    : null;
  const completed = moving !== null && moving.elapsedTicks >= moving.durationTicks;
  const carLane = completed ? moving.toLane : world.carLane;
  const laneChange = completed ? null : moving;
  let outcome: WorldState['outcome'] = world.outcome;
  if (distanceM <= 0) {
    const occupiesHazardLane = carLane === world.hazard.lane || laneChange?.toLane === world.hazard.lane;
    outcome = occupiesHazardLane && world.hazard.kind === 'elk'
      ? 'collision'
      : carLane !== world.hazard.lane ? 'swerved' : 'continued';
  } else if (nextSpeed === 0 && laneChange === null) {
    outcome = 'braked';
  }
  return {
    ...world,
    tick: world.tick + 1,
    carLane,
    laneChange,
    speedKmh: nextSpeed * 3.6,
    hazard: { ...world.hazard, distanceM: Math.max(0, distanceM) },
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
      : world.braking ? Math.min(world.speedKmh, selectedSpeedKmh) : selectedSpeedKmh,
  };
}

export function publicWorld(world: WorldState): WorldView {
  return {
    tick: world.tick,
    speedKmh: world.speedKmh,
    selectedSpeedKmh: world.selectedSpeedKmh,
    carLane: world.carLane,
    laneChange: world.laneChange ? { ...world.laneChange } : null,
    hazardLane: world.hazard.lane,
    distanceM: world.hazard.distanceM,
    identity: world.outcome === 'running' ? null : world.hazard.kind,
    braking: world.braking,
    outcome: world.outcome,
  };
}
