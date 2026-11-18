import { DEFAULT_SWERVE_POLICY } from './config.js';
import type { Config } from './config.js';
import type { Action, FastResult, Lane, SceneView, SwerveTier, WorldView } from './types.js';

export interface SwerveLimit {
  swerveSpeedLimit: number;
  swerveTier: SwerveTier;
  fastSwerveSpeedLimit: number;
}

export function swerveTierFor(
  tempC: number,
  policy: Pick<Config, keyof typeof DEFAULT_SWERVE_POLICY> = DEFAULT_SWERVE_POLICY,
): SwerveTier {
  return tempC > policy.frostRiskTempC ? 'normal grip' : tempC > policy.iceRiskTempC ? 'frost risk' : 'ice risk';
}

export function swerveSpeedLimitFor(
  tempC: number,
  policy: Pick<Config, keyof typeof DEFAULT_SWERVE_POLICY> = DEFAULT_SWERVE_POLICY,
): number {
  const tier = swerveTierFor(tempC, policy);
  return tier === 'normal grip' ? policy.normalSwerveSpeedLimit
    : tier === 'frost risk' ? policy.frostSwerveSpeedLimit : policy.iceSwerveSpeedLimit;
}

export function hazardInPath(contact: SceneView['contact'], car: Pick<WorldView, 'carLane' | 'laneChange'>): boolean {
  return contact !== null && (contact.lane === car.carLane || contact.lane === car.laneChange?.toLane);
}

export function fastAction(result: FastResult, threshold: number, inPath: boolean): Action {
  if (!inPath) return 'continue';
  return result.majorDamageRisk === null || result.adjacentLaneClear === null ||
    result.majorDamageRisk >= threshold ? 'brake' : 'slow_down';
}

export function fastLaneEligible(scene: SceneView, car: Pick<WorldView, 'carLane' | 'speedKmh' | 'laneChange'>, lane: Lane, tickMs: number): boolean {
  if (car.laneChange || Math.abs(lane - car.carLane) !== 1) return false;
  const sensed = scene.lanes.find((candidate) => candidate.lane === lane);
  const turnSeconds = 3 * tickMs / 1000;
  const needed = car.speedKmh / 3.6 * turnSeconds + 5;
  if (!sensed || sensed.vehicleAheadM !== undefined || sensed.clearAheadM === null || sensed.clearAheadM < needed) return false;
  if (sensed.vehicleBehindM === null) return true;
  const rear = scene.followingVehicle;
  if (!rear || rear.lane !== lane || rear.distanceBehindM !== sensed.vehicleBehindM || rear.distanceBehindM < 0) return false;
  // Keep 20 m after the turn plus a two-second buffer, without assuming the rear car will brake.
  return rear.distanceBehindM - Math.max(0, rear.closingSpeedKmh) / 3.6 * (turnSeconds + 2) >= 20;
}

export function fastProposal(
  result: FastResult, threshold: number, scene: SceneView,
  car: Pick<WorldView, 'carLane' | 'speedKmh' | 'laneChange'>,
  policy: Pick<Config, 'fastSwerveSpeedLimit' | 'fastLaneClearThreshold' | 'tickMs'>,
): { action: Action; targetLane?: Lane } {
  const inPath = hazardInPath(scene.contact, car);
  if (inPath && result.majorDamageRisk !== null && result.adjacentLaneClear !== null &&
      result.adjacentLaneClear >= policy.fastLaneClearThreshold && car.speedKmh <= policy.fastSwerveSpeedLimit) {
    const target = ([3, 2, 1] as const).find((lane) => fastLaneEligible(scene, car, lane, policy.tickMs));
    if (target !== undefined) return { action: 'swerve', targetLane: target };
  }
  return { action: fastAction(result, threshold, inPath) };
}
