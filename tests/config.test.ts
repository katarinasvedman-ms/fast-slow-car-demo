import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../src/config.js';

test('config rejects invalid timing, physical values, and endpoint schemes', () => {
  for (const env of [
    { TICK_MS: '350' },
    { TICK_MS: 'NaN' },
    { TICK_MS: '1' },
    { TICK_BUDGET_MS: '' },
    { BRAKE_DECEL_MPS2: '0' },
    { INITIAL_HAZARD_DISTANCE_M: '-1' },
    { STALENESS_LIMIT_TICKS: '1.5' },
    { SWERVE_SPEED_LIMIT_NORMAL: '131' },
    { SWERVE_SPEED_LIMIT_FROST: 'NaN' },
    { SWERVE_SPEED_LIMIT_ICE: '-1' },
    { FROST_RISK_TEMP_C: '31' },
    { ICE_RISK_TEMP_C: '-21' },
    { FROST_RISK_TEMP_C: '0', ICE_RISK_TEMP_C: '0' },
    { FROST_RISK_TEMP_C: '-1', ICE_RISK_TEMP_C: '1' },
    { FOUNDRY_ENDPOINT: 'http://localhost' },
    { STUB: 'true' },
  ]) {
    assert.throws(() => loadConfig(env));
  }
  const config = loadConfig({
    TICK_MS: '600',
    TICK_BUDGET_MS: '550',
    BRAKE_DECEL_MPS2: '2',
    INITIAL_HAZARD_DISTANCE_M: '300',
  });
  assert.equal(config.tickMs, 600);
  assert.equal(config.brakeDecelMps2, 2);
  assert.equal(config.initialHazardDistanceM, 300);
});
