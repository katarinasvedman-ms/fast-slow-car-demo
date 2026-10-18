export interface Config {
  port: number;
  tickMs: number;
  tickBudgetMs: number;
  stalenessLimitTicks: number;
  swerveSpeedLimit: number;
  brakeDecelMps2: number;
  initialHazardDistanceM: number;
  stub: boolean;
  stubSlowDelayTicks: number;
  foundryEndpoint: string | null;
  fastDeployment: string;
  slowModel: string;
}

function numberSetting(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
  integer = false,
): number {
  const raw = env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (
    raw?.trim() === '' ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum ||
    (integer && !Number.isInteger(value))
  ) {
    throw new Error(`${name} must be ${integer ? 'an integer' : 'a number'} between ${minimum} and ${maximum}.`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const tickMs = numberSetting(env, 'TICK_MS', 400, 50, 60_000, true);
  const tickBudgetMs = numberSetting(env, 'TICK_BUDGET_MS', 350, 1, 60_000, true);
  if (tickBudgetMs >= tickMs) {
    throw new Error('TICK_BUDGET_MS must be less than TICK_MS.');
  }
  if (env.STUB !== undefined && env.STUB !== '0' && env.STUB !== '1') {
    throw new Error('STUB must be 0 or 1.');
  }
  const foundryEndpoint = env.FOUNDRY_ENDPOINT?.trim() || null;
  if (foundryEndpoint) {
    const endpoint = new URL(foundryEndpoint);
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
      throw new Error('FOUNDRY_ENDPOINT must be an HTTPS endpoint without credentials, query, or fragment.');
    }
  }
  return {
    port: numberSetting(env, 'PORT', 3000, 0, 65_535, true),
    tickMs,
    tickBudgetMs,
    stalenessLimitTicks: numberSetting(env, 'STALENESS_LIMIT_TICKS', 3, 0, 1000, true),
    swerveSpeedLimit: numberSetting(env, 'SWERVE_SPEED_LIMIT', 70, 0, 130),
    brakeDecelMps2: numberSetting(env, 'BRAKE_DECEL_MPS2', 1.5, 0.01, 100),
    initialHazardDistanceM: numberSetting(env, 'INITIAL_HAZARD_DISTANCE_M', 500, 0.01, 100_000),
    stub: env.STUB === '1',
    stubSlowDelayTicks: numberSetting(env, 'STUB_SLOW_DELAY_TICKS', 5, 0, 1000, true),
    foundryEndpoint,
    fastDeployment: env.FOUNDRY_DEPLOYMENT?.trim() || 'fast-decider',
    slowModel: env.SLOW_MODEL?.trim() || 'slow-reasoner',
  };
}
