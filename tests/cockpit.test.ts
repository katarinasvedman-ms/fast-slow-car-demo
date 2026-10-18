import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mapSnapshot, EventTracker, parseSnapshot, freshnessPositions, contactPosition } from '../client/cockpit/model.js';
import { createControls, scenarioCommands, scenarios, ScenarioSelection, sendControl } from '../client/cockpit/controls.js';
import type { Control } from '../client/cockpit/controls.js';
import { loadConfig } from '../src/config.js';
import { Simulation } from '../src/simulation.js';
import type { GateRecord, Snapshot } from '../src/types.js';
import { fakeModels, deferred } from './helpers.js';
import { createMirrorView } from '../client/cockpit/mirror.js';
import { Vector2, Vector3 } from 'three';

test('rear-view reflection keeps left lanes left and follows the ego lane without moving traffic', () => {
  const mirror = createMirrorView();
  const traffic = new Vector3(-3.6, 0.55, 20);
  const screenX = (carLane: number, vehicle = traffic) => {
    mirror.setLane(carLane);
    const point = new Vector3(vehicle.x, vehicle.y, vehicle.z).project(mirror.camera);
    mirror.target.texture.updateMatrix();
    return mirror.target.texture.transformUv(new Vector2((point.x + 1) / 2, 0.5)).x;
  };
  try {
    const lane2 = screenX(2);
    const lane3 = screenX(3);
    assert.ok(lane2 < 0.5);
    assert.ok(lane3 < lane2);
    assert.ok(screenX(2.5) < lane2 && screenX(2.5) > lane3);
    assert.ok(Math.abs((0.5 - lane3) - 2 * (0.5 - lane2)) < 1e-12);
    assert.ok(Math.abs(screenX(1) - 0.5) < 1e-12);
    assert.ok(screenX(2, new Vector3(3.6, 0.55, 20)) > 0.5);
    assert.deepEqual([traffic.x, traffic.y, traffic.z], [-3.6, 0.55, 20]);
  } finally {
    mirror.dispose();
  }
});

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

test('cockpit uses audience identity from the snapshot, follows turn progress, and preserves independent refusals', () => {
  const value = snapshot();
  value.hazardVariant = 'elk';
  value.world.tick = 5;
  value.world.distanceM = 450;
  value.world.distanceTravelledM = 50;
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
  assert.equal(mapSnapshot(value).identity, 'elk');
  value.world.outcome = 'braked';
  assert.equal(mapSnapshot(value).identity, 'elk');
});

test('cockpit world contact follows only sensor lane/range and trails known movement without inventing a contact', () => {
  const state = snapshot();
  state.scene.contact = { lane: 1, rangeM: 123 };
  state.world.hazardLane = 3;
  state.world.distanceM = 456;
  state.world.distanceTravelledM = 30;
  const view = mapSnapshot(state);
  assert.deepEqual(contactPosition(view), { x: -3.6, z: -123 });
  assert.deepEqual(contactPosition(view, 25), { x: -3.6, z: -128 });
  state.scene.contact = null;
  assert.equal(contactPosition(mapSnapshot(state)), null);
  state.scene.contact = { lane: 2, rangeM: 10 };
  state.world.hazardActive = false;
  assert.equal(contactPosition(mapSnapshot(state)), null);
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
  value.drive.kind = 'free';
  value.drive.phase = 'gap';
  value.advice.status = 'ready';
  assert.equal(mapSnapshot(value).historical, true);
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
  for (const mutate of [
    (state: Snapshot) => { state.drive.episodeId = -1; },
    (state: Snapshot) => { state.drive.score.collisions = NaN; },
    (state: Snapshot) => { state.scene.contact = { lane: 2, rangeM: NaN }; },
  ]) {
    const invalid = structuredClone(value);
    mutate(invalid);
    assert.throws(() => parseSnapshot(JSON.stringify(invalid)), /Invalid cockpit state/);
  }
});

test('presenter serializes preset controls, waits before Start, and stops a failing preset', async () => {
  const sent: Control[] = [];
  const busy: boolean[] = [];
  const pending = deferred<void>();
  const run = createControls(async (command) => {
    sent.push(command);
    if (sent.length === 1) await pending.promise;
  }, (value) => busy.push(value));
  const preset = run(scenarioCommands('allowed-swerve'));
  const start = run([{ command: 'start' }]);
  await Promise.resolve();
  assert.deepEqual(sent, [{ command: 'reset' }]);
  pending.resolve();
  await Promise.all([preset, start]);
  assert.deepEqual(sent, [...scenarioCommands('allowed-swerve'), { command: 'start' }]);
  assert.deepEqual(busy, [true, false, true, false]);
  for (const scenario of scenarios) assert.ok(!scenarioCommands(scenario.id).some((command) => command.command === 'start'));
  assert.deepEqual(scenarioCommands('custom'), []);
  const failed: Control[] = [];
  const runFailure = createControls(async (command) => {
    failed.push(command);
    if (command.command === 'mode') throw new Error('Control rejected.');
  }, () => {});
  await assert.rejects(runFailure(scenarioCommands('late-advice-refused')), /Control rejected/);
  assert.deepEqual(failed.map((command) => command.command), ['reset', 'run', 'mode']);
  await runFailure([{ command: 'reset' }]);
  assert.equal(failed.length, 4);
});

test('scenario labels wait for matching authoritative settings and return to Custom after an edit', () => {
  const selection = new ScenarioSelection();
  const state = snapshot();
  assert.equal(selection.update(state), 'custom');
  selection.choose('allowed-swerve');
  assert.equal(selection.update(state), 'custom');
  state.settings.stalenessLimitTicks = 6;
  assert.equal(selection.update(state), 'allowed-swerve');
  state.world.speedKmh = 30;
  state.world.tick = 20;
  assert.equal(selection.update(state), 'allowed-swerve');
  state.world.selectedSpeedKmh = 100;
  assert.equal(selection.update(state), 'custom');
  selection.choose('allowed-swerve');
  selection.custom();
  state.world.selectedSpeedKmh = 90;
  assert.equal(selection.update(state), 'custom');
});

test('freshness age and editable limit share a truthful tick scale, including zero and large limits', () => {
  assert.deepEqual(freshnessPositions(null, 3), { axisMax: 10, agePercent: 0, limitPercent: 30 });
  assert.deepEqual(freshnessPositions(5, 6), { axisMax: 10, agePercent: 50, limitPercent: 60 });
  assert.deepEqual(freshnessPositions(5, 3), { axisMax: 10, agePercent: 50, limitPercent: 30 });
  assert.deepEqual(freshnessPositions(1, 0), { axisMax: 10, agePercent: 10, limitPercent: 0 });
  assert.deepEqual(freshnessPositions(1200, 1000), { axisMax: 1200, agePercent: 100, limitPercent: 1000 / 1200 * 100 });
});

test('cockpit resets before retrying reset-required controls, ignores successful response snapshots, and surfaces other failures', async () => {
  const sent: Control[] = [];
  const request: typeof fetch = async (_url, init) => {
    const command = JSON.parse(String(init?.body)) as Control;
    sent.push(command);
    return sent.length === 1
      ? Response.json({ error: 'Reset before changing mode.' }, { status: 409 })
      : new Response('This successful response must not be parsed as a snapshot.');
  };
  await sendControl({ command: 'mode', value: 'blocking' }, request);
  assert.deepEqual(sent, [
    { command: 'mode', value: 'blocking' }, { command: 'reset' }, { command: 'mode', value: 'blocking' },
  ]);
  let calls = 0;
  await assert.rejects(sendControl({ command: 'hazard', value: 'elk' }, async () => {
    calls++;
    return Response.json({ error: 'Free drive is live-only.' }, { status: 409 });
  }), /live-only/);
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(sendControl({ command: 'mode', value: 'blocking' }, async () => {
    calls++;
    return Response.json({ error: 'Reset before changing mode.' }, { status: 409 });
  }), /Reset before changing/);
  assert.equal(calls, 2);
});
