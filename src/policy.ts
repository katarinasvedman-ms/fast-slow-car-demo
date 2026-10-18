import { DEFAULT_SWERVE_POLICY } from './config.js';
import type { Config } from './config.js';
import type { Action, FastResult, SwerveTier } from './types.js';

export interface SwerveLimit {
  swerveSpeedLimit: number;
  swerveTier: SwerveTier;
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

export function fastAction(result: FastResult, threshold: number): Action {
  return result.majorDamageRisk === null || result.adjacentLaneClear === null ||
    result.majorDamageRisk >= threshold ? 'brake' : 'continue';
}
