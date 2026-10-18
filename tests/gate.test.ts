import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../src/config.js';
import { evaluateGate } from '../src/gate.js';
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

test('gate reports independent refusals in order and uses strict boundaries and current speed', () => {
  for (const { tick, speed, expected } of [
    { tick: 3, speed: 70, expected: [] },
    { tick: 4, speed: 70, expected: ['stale_advice'] },
    { tick: 3, speed: 71, expected: ['prohibited_action'] },
    { tick: 5, speed: 90, expected: ['stale_advice', 'prohibited_action'] },
  ]) {
    const result = evaluateGate(envelope, tick, speed, config);
    assert.deepEqual(result.allowed ? [] : result.reasons.map((reason) => reason.reason), expected);
  }
  assert.equal(evaluateGate({ ...envelope, action: 'brake' }, 0, 130, config).allowed, true);
  assert.equal(evaluateGate(envelope, 3, 60, config).allowed, true);
  const later = evaluateGate(envelope, 4, 60, config);
  assert.deepEqual(later.allowed ? [] : later.reasons.map((reason) => reason.reason), ['stale_advice']);
});
