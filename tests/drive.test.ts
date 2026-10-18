import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../src/config.js';
import { nextHazard } from '../src/drive.js';
import { Simulation } from '../src/simulation.js';
import { parseSnapshot, mapSnapshot } from '../client/cockpit/model.js';
import type { SlowResult } from '../src/types.js';
import { deferred, fakeModels, flush } from './helpers.js';

const brake = { majorDamageRisk: 0.9, adjacentLaneClear: 0.9, latencyMs: 1 };
const swerve: SlowResult = { action: 'swerve', targetLane: 3, rationale: 'Test sensor lane 3 clear.', latencyMs: 1 };

test('seeded episodes repeat their kinds and only select adjacent traffic; new settings reject invalid input', () => {
  let seed = 42;
  const variants = new Set<string>();
  const kinds = new Set<string>();
  for (let i = 0; i < 60; i += 1) {
    for (const lane of [1, 2, 3] as const) {
      const next = nextHazard(seed, lane);
      assert.deepEqual(next, nextHazard(seed, lane));
      assert.ok(next.blocked.every((blocked) => Math.abs(blocked - lane) === 1));
      variants.add(next.variant);
      kinds.add(next.kind);
      seed = next.seed;
    }
  }
  assert.equal(variants.size, 3);
  assert.equal(kinds.size, 2);
  for (const env of [
    { ACCEL_MPS2: '0' }, { DRIVE_SEED: '-1' }, { DRIVE_SEED: '1.5' },
    { DRIVE_DURATION_S: '0' }, { DRIVE_DURATION_S: '1.5' }, { DRIVE_GAP_S: '-1' }, { DRIVE_DWELL_S: 'NaN' },
  ]) assert.throws(() => loadConfig(env));
  const stub = new Simulation(loadConfig({ STUB: '1' }), fakeModels());
  assert.throws(() => stub.setRunKind('free'), /live mode/);
  stub.dispose();
});

test('a stopped free-drive episode clears as a scenario, accelerates in the gap, and isolates late episode work', async (context) => {
  context.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'] });
  const pending = deferred<SlowResult>();
  const signals: AbortSignal[] = [];
  let fastCalls = 0;
  const simulation = new Simulation(loadConfig({ BRAKE_DECEL_MPS2: '100', DRIVE_DWELL_S: '0.8', DRIVE_GAP_S: '2' }), fakeModels({
    fast: { name: 'Mock brake', async decide() { fastCalls += 1; return brake; } },
    slow: { name: 'Mock episode', advise(_input, signal) {
      signals.push(signal);
      return signals.length === 1 ? pending.promise : new Promise(() => {});
    } },
  }), () => Date.now());
  context.after(() => simulation.dispose());
  simulation.setRunKind('free');
  simulation.start();
  await flush();
  context.mock.timers.tick(400);
  await flush();
  let snapshot = simulation.snapshot();
  assert.equal(snapshot.drive.phase, 'dwell');
  assert.equal(snapshot.drive.score.avoidedByBraking, 1);
  assert.equal(snapshot.world.identity, 'elk');
  assert.equal(signals[0]?.aborted, true);
  for (let i = 0; i < 2; i += 1) { context.mock.timers.tick(400); await flush(); }
  snapshot = simulation.snapshot();
  assert.equal(snapshot.drive.phase, 'gap');
  assert.equal(snapshot.scene.contact, null);
  assert.equal(snapshot.world.hazardActive, false);
  assert.equal(snapshot.world.identity, null);
  assert.equal(fastCalls, 1);
  assert.ok(snapshot.log.some((entry) => entry.scenario?.event === 'clear' && /not model output/.test(entry.detail)));
  context.mock.timers.tick(400);
  await flush();
  assert.ok(Math.abs(simulation.snapshot().world.speedKmh - 2.88) < 1e-9);
  const travelled = simulation.snapshot().world.distanceTravelledM;
  for (let i = 0; i < 4; i += 1) { context.mock.timers.tick(400); await flush(); }
  snapshot = simulation.snapshot();
  assert.equal(snapshot.drive.phase, 'episode');
  assert.equal(snapshot.drive.episodeId, 2);
  assert.equal(snapshot.drive.score.hazardsFaced, 2);
  assert.equal(signals.length, 2);
  assert.equal(fastCalls, 2);
  assert.ok(snapshot.world.distanceTravelledM > travelled);
  assert.equal(snapshot.hazardVariant, null);
  assert.equal(snapshot.world.identity, null);
  assert.equal(snapshot.scene.contact?.lane, snapshot.world.carLane);
  assert.deepEqual(parseSnapshot(JSON.stringify(snapshot)), snapshot);
  pending.resolve(swerve);
  await flush();
  assert.deepEqual(simulation.snapshot().advice, snapshot.advice);
  assert.deepEqual(simulation.snapshot().gate, snapshot.gate);
});

test('free drive reasons once, applies episode-stamped advice, recovers selected speed, and counts a completed swerve only once', async (context) => {
  context.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'] });
  const pending = deferred<SlowResult>();
  let calls = 0;
  const simulation = new Simulation(loadConfig({ DRIVE_GAP_S: '0.8' }), fakeModels({
    fast: { name: 'Mock damage', decide: async () => brake },
    slow: { name: 'Mock turn', advise() { calls += 1; return pending.promise; } },
  }), () => Date.now());
  context.after(() => simulation.dispose());
  simulation.setRunKind('free');
  simulation.setStalenessLimit(6);
  simulation.start();
  await flush();
  context.mock.timers.tick(400);
  await flush();
  pending.resolve(swerve);
  await flush();
  const applied = simulation.snapshot();
  assert.equal(applied.advice.data?.episodeId, 1);
  assert.equal(applied.gate.find((entry) => entry.envelope.source === 'slow')?.envelope.episodeId, 1);
  assert.equal(applied.drive.score.slowAllowed, 1);
  assert.equal(applied.drive.score.avoidedBySwerving, 0);
  for (let i = 0; i < 70 && simulation.snapshot().drive.phase === 'episode'; i += 1) {
    context.mock.timers.tick(400);
    await flush();
  }
  const passed = simulation.snapshot();
  assert.equal(passed.drive.phase, 'gap');
  assert.equal(passed.world.carLane, 3);
  assert.equal(passed.world.speedKmh, 90);
  assert.equal(passed.world.braking, false);
  assert.equal(passed.drive.score.avoidedBySwerving, 1);
  assert.equal(calls, 1);
  const odometer = mapSnapshot(passed).travelledM;
  for (let i = 0; i < 2; i += 1) { context.mock.timers.tick(400); await flush(); }
  const next = simulation.snapshot();
  assert.equal(next.drive.episodeId, 2);
  assert.equal(next.scene.contact?.lane, 3);
  assert.equal(next.world.distanceM, 500);
  assert.ok(mapSnapshot(next).travelledM > odometer);
  assert.equal(next.drive.score.avoidedBySwerving, 1);
  assert.equal(calls, 2);
});

test('free-drive refusal counts both gate reasons once and never automatically reassesses the episode', async (context) => {
  context.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'] });
  const pending = deferred<SlowResult>();
  let calls = 0;
  const simulation = new Simulation(loadConfig({}), fakeModels({
    fast: { name: 'Mock brake', decide: async () => brake },
    slow: { name: 'Mock refusal', advise() { calls += 1; return pending.promise; } },
  }), () => Date.now());
  context.after(() => simulation.dispose());
  simulation.setRunKind('free');
  simulation.setTemperature(-4);
  simulation.start();
  await flush();
  for (let i = 0; i < 4; i += 1) { context.mock.timers.tick(400); await flush(); }
  pending.resolve(swerve);
  await flush();
  for (let i = 0; i < 5; i += 1) { context.mock.timers.tick(400); await flush(); }
  const score = simulation.snapshot().drive.score;
  assert.equal(calls, 1);
  assert.equal(score.slowAllowed, 0);
  assert.equal(score.slowRefused, 1);
  assert.equal(score.staleAdvice, 1);
  assert.equal(score.prohibitedAction, 1);
});

test('collision pauses world and duration, Start explicitly recovers from rest, and Stop freezes the scoreboard', async (context) => {
  context.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'] });
  const simulation = new Simulation(loadConfig({ INITIAL_HAZARD_DISTANCE_M: '11', DRIVE_GAP_S: '15' }), fakeModels(), () => Date.now());
  context.after(() => simulation.dispose());
  simulation.setMode('fast_only');
  simulation.setRunKind('free');
  simulation.start();
  await flush();
  for (let i = 0; i < 2; i += 1) { context.mock.timers.tick(400); await flush(); }
  const collision = simulation.snapshot();
  assert.equal(collision.drive.phase, 'collision');
  assert.equal(collision.started, false);
  assert.equal(collision.drive.score.collisions, 1);
  context.mock.timers.tick(10_000);
  await flush();
  assert.deepEqual(simulation.snapshot(), collision);
  simulation.start();
  assert.equal(simulation.snapshot().world.speedKmh, 0);
  context.mock.timers.tick(400);
  await flush();
  assert.ok(Math.abs(simulation.snapshot().drive.elapsedS - collision.drive.elapsedS - 0.4) < 1e-9);
  assert.ok(simulation.snapshot().world.speedKmh > 0);
  assert.ok(simulation.snapshot().log.some((entry) => entry.scenario?.event === 'resume'));
  simulation.stopDrive();
  const stopped = simulation.snapshot();
  assert.equal(stopped.drive.phase, 'finished');
  assert.equal(stopped.drive.finishReason, 'stopped');
  context.mock.timers.tick(10_000);
  await flush();
  assert.deepEqual(simulation.snapshot(), stopped);
  simulation.start();
  assert.equal(simulation.snapshot().started, false);
});

test('live duration ends on the first clock boundary, cancels work, and deadline counts remain final across late results', async (context) => {
  context.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'] });
  const slow = deferred<SlowResult>();
  const simulation = new Simulation(loadConfig({}), fakeModels({
    fast: { name: 'Mock deadline', decide: () => new Promise(() => {}) },
    slow: { name: 'Mock pending', advise: () => slow.promise },
  }), () => Date.now());
  context.after(() => simulation.dispose());
  simulation.setRunKind('free');
  simulation.start();
  await flush();
  for (let i = 0; i < 2; i += 1) {
    context.mock.timers.tick(350);
    await flush();
    context.mock.timers.tick(50);
    await flush();
  }
  assert.equal(simulation.snapshot().drive.score.deadlineMisses, 2);
  simulation.setDriveDuration(1);
  context.mock.timers.tick(400);
  await flush();
  const ended = simulation.snapshot();
  assert.equal(ended.started, false);
  assert.equal(ended.drive.phase, 'finished');
  assert.equal(ended.drive.finishReason, 'duration');
  assert.equal(ended.drive.elapsedS, 1.2);
  slow.resolve(swerve);
  await flush();
  assert.deepEqual(simulation.snapshot(), ended);
  simulation.reset();
  assert.equal(simulation.snapshot().drive.kind, 'free');
  assert.equal(simulation.snapshot().drive.durationS, 1);
  assert.equal(simulation.snapshot().drive.score.hazardsFaced, 0);
});
