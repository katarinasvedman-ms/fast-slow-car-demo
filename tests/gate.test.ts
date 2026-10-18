import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../src/config.js';
import { evaluateGate } from '../src/gate.js';
import { swerveSpeedLimitFor, swerveTierFor } from '../src/policy.js';
import type { ActionEnvelope } from '../src/types.js';

const config = loadConfig({});
const envelope: ActionEnvelope = {
  action: 'swerve',
  fromLane: 2,
  toLane: 3,
  speedKmh: 90,
  source: 'slow',
  observedAtTick: 0,
  proposedAtTick: 5,
};
const policyFor = (ambientTempC: number) => ({
  stalenessLimitTicks: config.stalenessLimitTicks, ambientTempC,
  swerveSpeedLimit: swerveSpeedLimitFor(ambientTempC, config),
  swerveTier: swerveTierFor(ambientTempC, config),
});

test('gate reports independent refusals in order and uses strict boundaries and current speed', () => {
  for (const { tick, speed, expected } of [
    { tick: 3, speed: 70, expected: [] },
    { tick: 4, speed: 70, expected: ['stale_advice'] },
    { tick: 3, speed: 71, expected: ['prohibited_action'] },
    { tick: 5, speed: 90, expected: ['stale_advice', 'prohibited_action'] },
  ]) {
    const result = evaluateGate(envelope, tick, speed, policyFor(3));
    assert.deepEqual(result.allowed ? [] : result.reasons.map((reason) => reason.reason), expected);
  }
  assert.equal(evaluateGate({ ...envelope, action: 'brake' }, 0, 130, policyFor(-4)).allowed, true);
  assert.equal(evaluateGate(envelope, 3, 60, policyFor(3)).allowed, true);
  const later = evaluateGate(envelope, 4, 60, policyFor(3));
  assert.deepEqual(later.allowed ? [] : later.reasons.map((reason) => reason.reason), ['stale_advice']);
});

test('temperature tiers use inclusive cold boundaries and independently configured limits', () => {
  for (const [temperature, limit, tier] of [
    [-20, 40, 'ice risk'], [0, 40, 'ice risk'], [0.5, 70, 'frost risk'],
    [1, 70, 'frost risk'], [4, 70, 'frost risk'], [4.01, 110, 'normal grip'], [30, 110, 'normal grip'],
  ] as const) {
    assert.equal(swerveSpeedLimitFor(temperature), limit);
    assert.equal(swerveTierFor(temperature), tier);
    assert.equal(evaluateGate(envelope, 3, limit, policyFor(temperature)).allowed, true);
    assert.equal(evaluateGate(envelope, 3, limit + 0.1, policyFor(temperature)).allowed, false);
  }
  const configured = loadConfig({
    SWERVE_SPEED_LIMIT_NORMAL: '105', SWERVE_SPEED_LIMIT_FROST: '65', SWERVE_SPEED_LIMIT_ICE: '35',
    FROST_RISK_TEMP_C: '6', ICE_RISK_TEMP_C: '-2',
  });
  assert.equal(swerveSpeedLimitFor(6.1, configured), 105);
  assert.equal(swerveSpeedLimitFor(6, configured), 65);
  assert.equal(swerveSpeedLimitFor(-1.9, configured), 65);
  assert.equal(swerveSpeedLimitFor(-2, configured), 35);
  const cold = evaluateGate(envelope, 5, 90, policyFor(-4));
  assert.ok(!cold.allowed);
  assert.deepEqual(cold.reasons.map((reason) => reason.reason), ['stale_advice', 'prohibited_action']);
  assert.equal(cold.reasons[1]?.detail, 'Swerve at 90.0 km/h exceeds 40 km/h limit for ice risk (-4 °C).');
});
