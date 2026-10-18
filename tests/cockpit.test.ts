import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mapSnapshot, EventTracker, parseSnapshot } from '../client/cockpit/model.js';
import { createControls, presetCommands } from '../client/cockpit/controls.js';
import type { Control } from '../client/cockpit/controls.js';
import { loadConfig } from '../src/config.js';
import { Simulation } from '../src/simulation.js';
import type { GateRecord, Snapshot } from '../src/types.js';
import { fakeModels, deferred } from './helpers.js';

function snapshot(): Snapshot {
  const sim = new Simulation(loadConfig({ STUB: '1' }), fakeModels());
  const value = sim.snapshot();
  sim.dispose();
  return value;
}

function record(phase: GateRecord['phase'] = 'proposal'): GateRecord {
  return {
    atTick: 5, phase,
    envelope: { action: 'swerve', source: 'slow', fromLane: 2, toLane: 3, speedKmh: 90, observedAtTick: 0, proposedAtTick: 5 },
    decision: { allowed: false, reasons: [
      { reason: 'stale_advice', detail: 'Age 5 exceeds 3.' },
      { reason: 'prohibited_action', detail: 'Actual speed exceeds 70.' },
    ] },
  };
}

test('cockpit keeps identity concealed, follows reported turn progress, and preserves independent refusals', () => {
  const value = snapshot();
  value.hazardVariant = 'elk';
  value.world.tick = 5;
  value.world.distanceM = 450;
  value.world.laneChange = { fromLane: 2, toLane: 3, startedAtTick: 4, elapsedTicks: 1, durationTicks: 3 };
  value.advice.observedAtTick = 0;
  value.advice.gate = record().decision;
  const view = mapSnapshot(value);
  assert.equal(view.identity, null);
  assert.equal(view.lane, 2 + 1 / 3);
  assert.equal(view.travelledM, 50);
  assert.equal(view.fresh, 'bad');
  assert.equal(view.permitted, 'bad');
  assert.equal(view.freshness, 0);
  value.advice.gate = { allowed: false, reasons: [{ reason: 'stale_advice', detail: 'Stale only.' }] };
  assert.equal(mapSnapshot(value).permitted, 'good');
  value.world.identity = 'elk';
  value.world.outcome = 'braked';
  assert.equal(mapSnapshot(value).identity, 'elk');
});

test('cockpit handles zero staleness and retains previous advice while reassessing', () => {
  const value = snapshot();
  value.settings.stalenessLimitTicks = 0;
  value.advice.observedAtTick = 0;
  value.advice.status = 'thinking';
  value.advice.data = { action: 'swerve', targetLane: 3, rationale: 'Previous result.', observedAtTick: 0, arrivedAtTick: 0, latencyMs: 10 };
  assert.equal(mapSnapshot(value).freshness, 1);
  assert.equal(mapSnapshot(value).historical, true);
  value.world.tick = 1;
  assert.equal(mapSnapshot(value).freshness, 0);
  assert.equal(mapSnapshot(value).snapshot.fast.majorDamageRisk, null);
});

test('cockpit event tracking deduplicates gate results, distinguishes application, and clears on reset/reconnect', () => {
  const tracker = new EventTracker();
  const initial = snapshot();
  assert.deepEqual(tracker.update(initial), []);
  const next = structuredClone(initial);
  next.started = true;
  next.world.tick = 5;
  next.fast.missedDeadlines = 1;
  next.gate = [record()];
  assert.deepEqual(tracker.update(next).map((event) => event.type), ['tick', 'deadline', 'gate']);
  assert.deepEqual(tracker.update(next), []);
  next.gate.unshift({ ...record('application'), decision: { allowed: true } });
  assert.deepEqual(tracker.update(structuredClone(next)).map((event) => event.type), ['gate']);
  assert.deepEqual(tracker.update(initial), [{ type: 'reset' }]);
  assert.deepEqual(tracker.update(next).map((event) => event.type), ['tick', 'deadline', 'gate', 'gate']);
  tracker.reconnect();
  assert.deepEqual(tracker.update(next), []);
});

test('cockpit rejects malformed snapshots instead of rendering success-shaped defaults', () => {
  const value = snapshot();
  assert.deepEqual(parseSnapshot(JSON.stringify(value)), value);
  assert.throws(() => parseSnapshot('{"world":{}}'), /Invalid cockpit state/);
  value.advice.gate = { allowed: false, reasons: [{ reason: 'stale_advice', detail: 'Stale.' }] };
  const malformed = JSON.parse(JSON.stringify(value));
  malformed.advice.gate.reasons[0].reason = 'invented';
  assert.throws(() => parseSnapshot(JSON.stringify(malformed)), /Invalid cockpit state/);
});

test('presenter serializes preset controls, waits before Start, and stops a failing preset', async () => {
  const sent: Control[] = [];
  const busy: boolean[] = [];
  const pending = deferred<void>();
  const run = createControls(async (command) => {
    sent.push(command);
    if (sent.length === 1) await pending.promise;
  }, (value) => busy.push(value));
  const preset = run(presetCommands(4));
  const start = run([{ command: 'start' }]);
  await Promise.resolve();
  assert.deepEqual(sent, [{ command: 'reset' }]);
  pending.resolve();
  await Promise.all([preset, start]);
  assert.deepEqual(sent, [...presetCommands(4), { command: 'start' }]);
  assert.deepEqual(busy, [true, false, true, false]);
  assert.deepEqual(presetCommands(2, true).find((command) => command.command === 'threshold'), { command: 'threshold', value: 0.5 });
  const failed: Control[] = [];
  const runFailure = createControls(async (command) => {
    failed.push(command);
    if (command.command === 'mode') throw new Error('Control rejected.');
  }, () => {});
  await assert.rejects(runFailure(presetCommands(3)), /Control rejected/);
  assert.deepEqual(failed.map((command) => command.command), ['reset', 'mode']);
  await runFailure([{ command: 'reset' }]);
  assert.equal(failed.length, 3);
});
