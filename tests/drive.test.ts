import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../src/config.js';
import { nextGap, nextHazard, nextSpawnDistance } from '../src/drive.js';
import { Simulation } from '../src/simulation.js';
import { parseSnapshot, mapSnapshot } from '../client/cockpit/model.js';
import type { SlowResult } from '../src/types.js';
import { deferred, fakeModels, flush } from './helpers.js';

const brake = { majorDamageRisk: 0.9, adjacentLaneClear: 0.9, latencyMs: 1 };
const swerve: SlowResult = { action: 'swerve', targetLane: 3, rationale: 'Test sensor lane 3 clear.', latencyMs: 1 };

async function finishGap(simulation: Simulation, tick: (ms: number) => void): Promise<void> {
  const snapshot = simulation.snapshot();
  assert.equal(snapshot.drive.phase, 'gap');
  tick(Math.max(snapshot.settings.tickMs, Math.round(snapshot.drive.phaseRemainingS * 1000)));
  await flush();
}

test('seeded encounters repeat with short quiet stretches and close spawn distances', () => {
  const config = loadConfig({});
  const sequence = (initialSeed: number) => {
    let seed = initialSeed;
    return Array.from({ length: 20 }, () => {
      const gap = nextGap(seed, config.driveGapS);
      const hazard = nextHazard(gap.seed, 2);
      const spawn = nextSpawnDistance(hazard.seed);
      seed = spawn.seed;
      assert.ok(gap.seconds >= 2.55 && gap.seconds <= 3.45);
      assert.ok(spawn.distanceM >= 35 && spawn.distanceM <= 65);
      return { gap, hazard, spawn };
    });
  };
  assert.deepEqual(sequence(42), sequence(42));
  assert.notDeepEqual(sequence(42), sequence(43));
  assert.equal(new Set(sequence(42).map(({ spawn }) => spawn.distanceM)).size, 20);
});

test('free drive starts empty, moves without model work until spawn, and Reset repeats initial timing and distance', async (context) => {
  context.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'] });
  const inputs: string[] = [];
  let slowCalls = 0;
  const simulation = new Simulation(loadConfig({}), fakeModels({
    fast: { name: 'Mock sensor', async decide(input) { inputs.push(input); return brake; } },
    slow: { name: 'Mock pending', advise() { slowCalls += 1; return new Promise(() => {}); } },
  }), () => Date.now());
  context.after(() => simulation.dispose());
  simulation.setRunKind('free');
  assert.equal(simulation.snapshot().scene.contact, null);
  assert.equal(simulation.snapshot().world.hazardActive, false);
  assert.equal(simulation.snapshot().observationTick, null);
  const starts = [];
  for (let run = 0; run < 2; run += 1) {
    simulation.start();
    const gap = simulation.snapshot().drive.phaseRemainingS;
    context.mock.timers.tick(Math.round(gap * 1000) - 1);
    await flush();
    assert.equal(inputs.length, run);
    assert.equal(slowCalls, run);
    assert.equal(simulation.snapshot().scene.contact, null);
    assert.equal(simulation.snapshot().drive.score.hazardsFaced, 0);
    assert.ok(simulation.snapshot().world.distanceTravelledM > 0);
    context.mock.timers.tick(1);
    await flush();
    const spawned = simulation.snapshot();
    assert.equal(spawned.drive.phase, 'episode');
    assert.equal(spawned.drive.score.hazardsFaced, 1);
    assert.equal(spawned.observationTick, spawned.world.tick);
    assert.equal(inputs.length, run + 1);
    assert.equal(slowCalls, run + 1);
    assert.match(inputs[run]!, new RegExp(`range ${Math.round(spawned.world.distanceM)} m`));
    assert.equal(spawned.hazardVariant, null);
    assert.notEqual(spawned.world.identity, null);
    starts.push({ tick: spawned.world.tick, distance: spawned.world.distanceM, gap });
    simulation.reset();
    assert.equal(simulation.snapshot().scene.contact, null);
    assert.equal(simulation.snapshot().observationTick, null);
  }
  assert.deepEqual(starts[0], starts[1]);
  simulation.setDriveDuration(1);
  simulation.start();
  context.mock.timers.tick(1200);
  await flush();
  assert.equal(simulation.snapshot().drive.phase, 'finished');
  assert.equal(simulation.snapshot().drive.score.hazardsFaced, 0);
  assert.equal(inputs.length, 2);
  assert.equal(slowCalls, 2);
  simulation.reset();
  simulation.setRunKind('staged');
  assert.equal(simulation.snapshot().world.distanceM, 500);
  assert.equal(simulation.snapshot().world.hazardActive, true);
});

test('close encounters register collision even with prompt gentle braking', async (context) => {
  context.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'] });
  const simulation = new Simulation(loadConfig({ DRIVE_GAP_S: '0' }), fakeModels({
    fast: { name: 'Mock reaction', async decide() { return brake; } },
  }), () => Date.now());
  context.after(() => simulation.dispose());
  simulation.setMode('fast_only');
  simulation.setRunKind('free');
  simulation.start();
  await finishGap(simulation, (ms) => context.mock.timers.tick(ms));
  assert.equal(simulation.snapshot().world.braking, true);
  for (let i = 0; i < 50 && simulation.snapshot().drive.phase === 'episode'; i += 1) {
    context.mock.timers.tick(400);
    await flush();
  }
  const stopped = simulation.snapshot();
  assert.equal(stopped.drive.phase, 'collision');
  assert.equal(stopped.drive.score.avoidedByBraking, 0);
  assert.equal(stopped.drive.score.collisions, 1);
  assert.ok(stopped.world.speedKmh > 0);
});

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
    { DRIVE_DURATION_S: '-1' }, { DRIVE_DURATION_S: '1.5' }, { DRIVE_GAP_S: '-1' }, { DRIVE_DWELL_S: 'NaN' },
  ]) assert.throws(() => loadConfig(env));
  const stub = new Simulation(loadConfig({ STUB: '1' }), fakeModels());
  assert.throws(() => stub.setRunKind('free'), /live mode/);
  stub.dispose();
});

test('a stopped free-drive encounter retains its animal and pending advice, then permits a gated physical turn', async (context) => {
  context.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'] });
  const pending = deferred<SlowResult>();
  const signals: AbortSignal[] = [];
  let fastCalls = 0;
  const simulation = new Simulation(loadConfig({
    BRAKE_DECEL_MPS2: '100', DRIVE_DWELL_S: '0.8', DRIVE_GAP_S: '2', STALENESS_LIMIT_TICKS: '100', DRIVE_SEED: '41',
  }), fakeModels({
    fast: { name: 'Mock brake', async decide() { fastCalls += 1; return brake; } },
    slow: { name: 'Mock episode', advise(_input, signal) {
      signals.push(signal);
      return signals.length === 1 ? pending.promise : new Promise(() => {});
    } },
  }), () => Date.now());
  context.after(() => simulation.dispose());
  simulation.setRunKind('free');
  simulation.setDriveDuration(0);
  simulation.start();
  await finishGap(simulation, (ms) => context.mock.timers.tick(ms));
  await flush();
  context.mock.timers.tick(400);
  await flush();
  let snapshot = simulation.snapshot();
  assert.equal(snapshot.drive.phase, 'episode');
  assert.equal(snapshot.world.outcome, 'braked');
  assert.equal(snapshot.drive.score.avoidedByBraking, 1);
  assert.notEqual(snapshot.world.identity, null);
  assert.equal(signals[0]?.aborted, false);
  assert.equal(snapshot.advice.status, 'thinking');
  const stopped = snapshot;
  for (let i = 0; i < 8; i += 1) { context.mock.timers.tick(400); await flush(); }
  snapshot = simulation.snapshot();
  assert.equal(snapshot.started, true);
  assert.equal(snapshot.drive.phase, 'episode');
  assert.equal(snapshot.drive.episodeId, 1);
  assert.deepEqual(snapshot.scene.contact, stopped.scene.contact);
  assert.equal(snapshot.world.hazardActive, true);
  assert.equal(snapshot.world.identity, stopped.world.identity);
  assert.equal(snapshot.world.speedKmh, 0);
  assert.equal(snapshot.world.distanceTravelledM, stopped.world.distanceTravelledM);
  assert.equal(snapshot.world.tick, stopped.world.tick + 8);
  assert.equal(snapshot.drive.score.avoidedByBraking, 1);
  assert.equal(snapshot.advice.status, 'thinking');
  assert.equal(signals.length, 1);
  assert.equal(signals[0]?.aborted, false);
  assert.equal(fastCalls, 1);
  assert.equal(snapshot.log.filter((entry) => entry.scenario?.event === 'stopped').length, 1);
  assert.equal(snapshot.log.some((entry) => entry.scenario?.event === 'clear'), false);
  assert.deepEqual(parseSnapshot(JSON.stringify(snapshot)), snapshot);
  pending.resolve(swerve);
  await flush();
  snapshot = simulation.snapshot();
  assert.equal(snapshot.advice.status, 'ready');
  assert.equal(snapshot.advice.data?.observedAtTick, stopped.advice.observedAtTick);
  assert.equal(snapshot.advice.gate?.allowed, true);
  assert.match(snapshot.advice.application!, /slow swerve applied/);
  assert.equal(snapshot.world.braking, false);
  assert.equal(snapshot.world.speedKmh, 0);
  assert.equal(snapshot.world.laneChange?.toLane, 3);
  assert.equal(snapshot.scene.contact?.lane, 2);
  for (let tick = 0; tick < 3; tick++) { context.mock.timers.tick(400); await flush(); }
  assert.equal(simulation.snapshot().world.carLane, 3);
  assert.equal(simulation.snapshot().world.laneChange, null);
  for (let tick = 0; tick < 80 && simulation.snapshot().drive.phase === 'episode'; tick++) {
    context.mock.timers.tick(400);
    await flush();
  }
  snapshot = simulation.snapshot();
  assert.equal(snapshot.drive.phase, 'gap');
  assert.equal(snapshot.drive.episodeId, 1);
  assert.equal(snapshot.drive.score.avoidedByBraking, 0);
  assert.equal(snapshot.drive.score.avoidedBySwerving, 1);
  assert.equal(snapshot.drive.score.hazardsFaced, 1);
  assert.ok(snapshot.world.distanceTravelledM > stopped.world.distanceTravelledM);
  assert.equal(snapshot.scene.contact, null);
  assert.equal(signals.length, 1);
  simulation.stopDrive();
  const finished = simulation.snapshot();
  context.mock.timers.tick(10_000);
  await flush();
  assert.deepEqual(simulation.snapshot(), finished);
});

for (const result of ['stale', 'error'] as const) test(`${result} slow advice leaves a stopped animal in place without retries`, async (context) => {
  context.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'] });
  let answer!: (result: SlowResult) => void;
  let fail!: (error: Error) => void;
  let fastCalls = 0;
  let slowCalls = 0;
  const simulation = new Simulation(loadConfig({
    BRAKE_DECEL_MPS2: '100', DRIVE_GAP_S: '0', STALENESS_LIMIT_TICKS: '1',
  }), fakeModels({
    fast: { name: 'Mock brake', async decide() { fastCalls++; return brake; } },
    slow: { name: 'Mock late answer', advise() {
      slowCalls++;
      return new Promise<SlowResult>((resolve, reject) => { answer = resolve; fail = reject; });
    } },
  }), () => Date.now());
  context.after(() => simulation.dispose());
  simulation.setRunKind('free');
  simulation.setDriveDuration(0);
  simulation.start();
  await finishGap(simulation, (ms) => context.mock.timers.tick(ms));
  for (let tick = 0; tick < 4; tick++) { context.mock.timers.tick(400); await flush(); }
  const stopped = simulation.snapshot();
  assert.equal(stopped.world.outcome, 'braked');
  if (result === 'stale') answer(swerve);
  else fail(new Error('Mock service unavailable.'));
  await flush();
  for (let tick = 0; tick < 20; tick++) { context.mock.timers.tick(400); await flush(); }
  const snapshot = simulation.snapshot();
  assert.equal(snapshot.drive.phase, 'episode');
  assert.equal(snapshot.drive.episodeId, stopped.drive.episodeId);
  assert.equal(snapshot.world.outcome, 'braked');
  assert.equal(snapshot.world.speedKmh, 0);
  assert.deepEqual(snapshot.scene.contact, stopped.scene.contact);
  assert.equal(snapshot.drive.score.avoidedByBraking, 1);
  assert.equal(snapshot.drive.score.avoidedBySwerving, 0);
  assert.equal(slowCalls, 1);
  assert.equal(fastCalls, 1);
  if (result === 'stale') {
    assert.equal(snapshot.advice.gate?.allowed, false);
    assert.equal(snapshot.drive.score.staleAdvice, 1);
  } else assert.equal(snapshot.advice.status, 'error');
});

test('free drive reasons once, applies episode-stamped advice, recovers 90 km/h, and counts a completed swerve only once', async (context) => {
  context.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'] });
  const pending = deferred<SlowResult>();
  let calls = 0;
  const simulation = new Simulation(loadConfig({ DRIVE_GAP_S: '0.8', DRIVE_SEED: '41' }), fakeModels({
    fast: { name: 'Mock damage', decide: async () => brake },
    slow: { name: 'Mock turn', advise() { calls += 1; return pending.promise; } },
  }), () => Date.now());
  context.after(() => simulation.dispose());
  simulation.setSpeed(90);
  simulation.setRunKind('free');
  simulation.setStalenessLimit(6);
  simulation.start();
  await finishGap(simulation, (ms) => context.mock.timers.tick(ms));
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
  assert.ok(passed.world.speedKmh < passed.world.selectedSpeedKmh);
  assert.ok(passed.world.speedKmh > 0);
  assert.equal(passed.world.braking, false);
  assert.equal(passed.drive.score.avoidedBySwerving, 1);
  assert.equal(calls, 1);
  const odometer = mapSnapshot(passed).travelledM;
  await finishGap(simulation, (ms) => context.mock.timers.tick(ms));
  const next = simulation.snapshot();
  assert.equal(next.drive.episodeId, 2);
  assert.equal(next.world.speedKmh, next.world.selectedSpeedKmh);
  assert.equal(next.scene.contact?.lane, 3);
  assert.ok(next.world.distanceM >= 35 && next.world.distanceM <= 65);
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
  simulation.setSpeed(50);
  simulation.setTemperature(-4);
  simulation.start();
  await finishGap(simulation, (ms) => context.mock.timers.tick(ms));
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
  const simulation = new Simulation(loadConfig({ DRIVE_GAP_S: '15' }), fakeModels(), () => Date.now());
  context.after(() => simulation.dispose());
  simulation.setMode('fast_only');
  simulation.setRunKind('free');
  simulation.start();
  await finishGap(simulation, (ms) => context.mock.timers.tick(ms));
  await flush();
  for (let i = 0; i < 40 && simulation.snapshot().started; i += 1) { context.mock.timers.tick(400); await flush(); }
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
  const simulation = new Simulation(loadConfig({ DRIVE_GAP_S: '0' }), fakeModels({
    fast: { name: 'Mock deadline', decide: () => new Promise(() => {}) },
    slow: { name: 'Mock pending', advise: () => slow.promise },
  }), () => Date.now());
  context.after(() => simulation.dispose());
  simulation.setRunKind('free');
  simulation.start();
  await finishGap(simulation, (ms) => context.mock.timers.tick(ms));
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
  assert.equal(ended.advice.status, 'cancelled');
  assert.deepEqual(ended.advice.cancellation, { atTick: ended.world.tick, reason: 'duration' });
  slow.resolve(swerve);
  await flush();
  assert.deepEqual(simulation.snapshot(), ended);
  simulation.reset();
  assert.equal(simulation.snapshot().drive.kind, 'free');
  assert.equal(simulation.snapshot().drive.durationS, 1);
  assert.equal(simulation.snapshot().drive.score.hazardsFaced, 0);
});

test('collision retains the unanswered assessment, freezes its wait age, and rejects late advice after resume', async (context) => {
  context.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'] });
  const pending = deferred<SlowResult>();
  const signals: AbortSignal[] = [];
  const simulation = new Simulation(loadConfig({
    BRAKE_DECEL_MPS2: '9', INITIAL_HAZARD_DISTANCE_M: '80', DRIVE_GAP_S: '0',
  }), fakeModels({
    slow: { name: 'Pending assessment', advise(_input, signal) { signals.push(signal); return pending.promise; } },
  }), () => Date.now());
  context.after(() => simulation.dispose());
  simulation.setRunKind('free');
  simulation.setEncounter('rear_threat');
  simulation.start();
  await finishGap(simulation, (ms) => context.mock.timers.tick(ms));
  const observed = simulation.snapshot().advice.observedAtTick;
  assert.notEqual(observed, null);
  for (let i = 0; i < 20 && simulation.snapshot().started; i++) {
    context.mock.timers.tick(400);
    await flush();
  }
  const collision = simulation.snapshot();
  assert.equal(collision.world.collisionCause, 'front_contact');
  assert.equal(collision.advice.status, 'cancelled');
  assert.equal(collision.advice.observedAtTick, observed);
  assert.deepEqual(collision.advice.cancellation, { atTick: collision.world.tick, reason: 'collision' });
  assert.equal(collision.advice.data, null);
  assert.equal(collision.advice.gate, null);
  assert.equal(collision.advice.application, null);
  assert.equal(signals[0]?.aborted, true);
  assert.deepEqual(parseSnapshot(JSON.stringify(collision)), collision);
  pending.resolve(swerve);
  await flush();
  assert.deepEqual(simulation.snapshot(), collision);
  const age = mapSnapshot(collision).age;
  simulation.start();
  context.mock.timers.tick(400);
  await flush();
  assert.equal(mapSnapshot(simulation.snapshot()).age, age);
  simulation.reset();
  assert.equal(simulation.snapshot().advice.status, 'idle');
  assert.equal(simulation.snapshot().advice.observedAtTick, null);
  assert.equal(simulation.snapshot().advice.cancellation, null);
});

test('continuous driving defaults to running beyond the former limit until Stop, and Reset preserves the setup', async (context) => {
  context.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'] });
  let calls = 0;
  const simulation = new Simulation(loadConfig({ DRIVE_GAP_S: '300' }), fakeModels({
    fast: { name: 'Mock unused', async decide() { calls++; return brake; } },
  }), () => Date.now());
  context.after(() => simulation.dispose());
  simulation.setRunKind('free');
  simulation.setEncounter('rear_threat');
  simulation.start();
  context.mock.timers.tick(125_000);
  await flush();
  const running = simulation.snapshot();
  assert.equal(running.started, true);
  assert.ok(running.drive.elapsedS > 120);
  assert.equal(running.drive.phase, 'gap');
  assert.equal(calls, 0);
  simulation.stopDrive();
  const stopped = simulation.snapshot();
  assert.equal(stopped.drive.finishReason, 'stopped');
  context.mock.timers.tick(10_000);
  assert.deepEqual(simulation.snapshot(), stopped);
  simulation.reset();
  const reset = simulation.snapshot();
  assert.equal(reset.drive.durationS, 0);
  assert.equal(reset.drive.kind, 'free');
  assert.equal(reset.world.encounter, 'rear_threat');
  assert.equal(reset.scene.contact, null);
  assert.equal(reset.scene.followingVehicle?.distanceBehindM, 80);
});

test('continuous rear threats keep the same physical car through gaps and new hazards without repositioning or model work between encounters', async (context) => {
  context.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'] });
  const slow: ReturnType<typeof deferred<SlowResult>>[] = [];
  const inputs: string[] = [];
  const simulation = new Simulation(loadConfig({
    BRAKE_DECEL_MPS2: '9', INITIAL_HAZARD_DISTANCE_M: '80', DRIVE_SEED: '41',
  }), fakeModels({
    fast: { name: 'Mock brake', async decide(input) { inputs.push(input); return brake; } },
    slow: { name: 'Mock per-episode', advise() { const pending = deferred<SlowResult>(); slow.push(pending); return pending.promise; } },
  }), () => Date.now());
  context.after(() => simulation.dispose());
  simulation.setRunKind('free');
  simulation.setEncounter('rear_threat');
  simulation.setDriveDuration(0);
  simulation.setStalenessLimit(10);
  simulation.start();
  assert.equal(simulation.snapshot().scene.followingVehicle?.distanceBehindM, 80);
  const step = async () => {
    const before = simulation.snapshot();
    context.mock.timers.tick(400);
    await flush();
    const after = simulation.snapshot();
    const previousPosition = before.world.distanceTravelledM - before.scene.followingVehicle!.distanceBehindM;
    const position = after.world.distanceTravelledM - after.scene.followingVehicle!.distanceBehindM;
    assert.equal(after.scene.followingVehicle?.lane, 2);
    assert.ok(position >= previousPosition - 1e-8);
    assert.ok(position - previousPosition <= before.scene.followingVehicle!.speedKmh / 3.6 * 0.4 + 1e-8);
  };
  let travelled = 0;
  for (const [index, targetLane] of ([3, 2] as const).entries()) {
    const callsBefore = inputs.length;
    for (let tick = 0; tick < 100 && simulation.snapshot().drive.phase === 'gap'; tick++) {
      await step();
      if (simulation.snapshot().drive.phase === 'gap') {
        assert.equal(inputs.length, callsBefore);
        assert.equal(slow.length, index);
        assert.notEqual(simulation.snapshot().scene.followingVehicle, null);
      }
    }
    const spawned = simulation.snapshot();
    assert.equal(spawned.drive.phase, 'episode');
    assert.equal(spawned.drive.episodeId, index + 1);
    assert.equal(spawned.world.speedKmh, 110);
    assert.equal(spawned.world.distanceM, 80);
    assert.equal(spawned.scene.followingVehicle?.lane, 2);
    if (index === 0) {
      assert.equal(spawned.scene.followingVehicle?.distanceBehindM, 80);
      assert.equal(spawned.scene.followingVehicle?.speedKmh, 110);
    } else {
      assert.notEqual(spawned.scene.followingVehicle?.distanceBehindM, 80);
      assert.ok(spawned.scene.followingVehicle!.speedKmh < 110);
    }
    assert.equal(spawned.hazardVariant, null);
    assert.ok(spawned.world.distanceTravelledM > travelled);
    assert.match(spawned.observation, /Traffic radar: following vehicle/);
    assert.doesNotMatch(spawned.observation, /kind|reactionRemaining|temperature|grip|elk/i);
    await step();
    slow[index]!.resolve({ ...swerve, targetLane });
    await flush();
    assert.equal(simulation.snapshot().advice.data?.episodeId, index + 1);
    for (let tick = 0; tick < 100 && simulation.snapshot().drive.phase === 'episode'; tick++) {
      await step();
    }
    const passed = simulation.snapshot();
    assert.equal(passed.drive.phase, 'gap');
    assert.equal(passed.started, true);
    assert.equal(passed.world.carLane, targetLane);
    assert.equal(passed.drive.score.avoidedBySwerving, index + 1);
    assert.equal(passed.drive.score.collisions, 0);
    assert.notEqual(passed.scene.followingVehicle, null);
    assert.equal(passed.scene.contact, null);
    assert.equal(slow.length, index + 1);
    travelled = passed.world.distanceTravelledM;
    assert.deepEqual(parseSnapshot(JSON.stringify(passed)), passed);
  }
  simulation.stopDrive();
  const stopped = simulation.snapshot();
  context.mock.timers.tick(20_000);
  await flush();
  assert.deepEqual(simulation.snapshot(), stopped);
});

test('continuous rear impacts pause once, cancel old advice, and resume with the involved car stopped at its actual position', async (context) => {
  context.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'] });
  const pending = deferred<SlowResult>();
  const signals: AbortSignal[] = [];
  const simulation = new Simulation(loadConfig({
    BRAKE_DECEL_MPS2: '9', INITIAL_HAZARD_DISTANCE_M: '80',
  }), fakeModels({
    fast: { name: 'Mock brake / no confident fast escape', async decide() { return { ...brake, adjacentLaneClear: 0.8 }; } },
    slow: { name: 'Mock late advice', advise(_input, signal) { signals.push(signal); return pending.promise; } },
  }), () => Date.now());
  context.after(() => simulation.dispose());
  simulation.setRunKind('free');
  simulation.setEncounter('rear_threat');
  simulation.setDriveDuration(0);
  simulation.start();
  await finishGap(simulation, (ms) => context.mock.timers.tick(ms));
  for (let tick = 0; tick < 100 && simulation.snapshot().started; tick++) {
    context.mock.timers.tick(400);
    await flush();
  }
  const collision = simulation.snapshot();
  assert.equal(collision.drive.phase, 'collision');
  assert.equal(collision.world.collisionCause, 'rear_vehicle');
  assert.equal(collision.drive.score.collisions, 1);
  assert.equal(collision.started, false);
  assert.equal(signals[0]?.aborted, true);
  context.mock.timers.tick(10_000);
  await flush();
  assert.deepEqual(simulation.snapshot(), collision);
  simulation.start();
  const resumed = simulation.snapshot();
  assert.equal(resumed.world.speedKmh, 0);
  assert.equal(resumed.world.collisionCause, null);
  assert.equal(resumed.scene.followingVehicle?.distanceBehindM, collision.scene.followingVehicle?.distanceBehindM);
  assert.equal(resumed.scene.followingVehicle?.lane, collision.scene.followingVehicle?.lane);
  assert.equal(resumed.scene.followingVehicle?.speedKmh, 0);
  assert.equal(resumed.scene.contact, null);
  assert.ok(resumed.drive.phaseRemainingS > 15);
  pending.resolve(swerve);
  await flush();
  assert.deepEqual(simulation.snapshot(), resumed);
  for (let tick = 0; tick < 20; tick++) { context.mock.timers.tick(400); await flush(); }
  assert.equal(simulation.snapshot().drive.phase, 'gap');
  assert.ok(simulation.snapshot().world.speedKmh > 0);
  assert.equal(signals.length, 1);
  simulation.stopDrive();
  assert.equal(simulation.snapshot().drive.score.collisions, 1);
});

test('fast-only rear-threat stops retain the animal and following car without auto-clearance or extra calls', async (context) => {
  context.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'] });
  let calls = 0;
  const simulation = new Simulation(loadConfig({
    BRAKE_DECEL_MPS2: '9', INITIAL_HAZARD_DISTANCE_M: '80', DRIVE_GAP_S: '0', DRIVE_DWELL_S: '0.8',
  }), fakeModels({
    fast: { name: 'Mock brake / no confident fast escape', async decide() { calls++; return { ...brake, adjacentLaneClear: 0.8 }; } },
  }), () => Date.now());
  context.after(() => simulation.dispose());
  simulation.setMode('fast_only');
  simulation.setSpeed(50);
  simulation.setRunKind('free');
  simulation.setEncounter('rear_threat');
  simulation.setDriveDuration(0);
  simulation.start();
  await finishGap(simulation, (ms) => context.mock.timers.tick(ms));
  for (let tick = 0; tick < 100 && simulation.snapshot().world.outcome === 'running'; tick++) {
    context.mock.timers.tick(400);
    await flush();
  }
  const stopped = simulation.snapshot();
  assert.equal(stopped.drive.phase, 'episode');
  assert.equal(stopped.world.outcome, 'braked');
  assert.equal(stopped.world.speedKmh, 0);
  assert.equal(stopped.drive.score.avoidedByBraking, 1);
  assert.equal(stopped.scene.followingVehicle?.speedKmh, 0);
  const callsAtStop = calls;
  for (let tick = 0; tick < 30; tick++) {
    context.mock.timers.tick(400);
    await flush();
  }
  const held = simulation.snapshot();
  assert.equal(held.drive.phase, 'episode');
  assert.equal(held.drive.episodeId, stopped.drive.episodeId);
  assert.equal(held.world.speedKmh, 0);
  assert.deepEqual(held.scene.contact, stopped.scene.contact);
  assert.deepEqual(held.scene.followingVehicle, stopped.scene.followingVehicle);
  assert.equal(held.world.braking, true);
  assert.equal(held.drive.score.avoidedByBraking, 1);
  assert.equal(held.drive.score.hazardsFaced, 1);
  assert.equal(calls, callsAtStop);
  simulation.stopDrive();
  const finished = simulation.snapshot();
  context.mock.timers.tick(10_000);
  await flush();
  assert.deepEqual(simulation.snapshot(), finished);
  assert.deepEqual(finished.scene.contact, stopped.scene.contact);
  simulation.reset();
  assert.equal(simulation.snapshot().scene.contact, null);
  assert.equal(simulation.snapshot().drive.score.avoidedByBraking, 0);
});

test('persistent rear traffic can collide during a quiet stretch and pauses once without making model calls', async (context) => {
  context.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'] });
  let calls = 0;
  const simulation = new Simulation(loadConfig({ DRIVE_GAP_S: '300' }), fakeModels({
    fast: { name: 'Mock unused', async decide() { calls++; return brake; } },
  }), () => Date.now());
  context.after(() => simulation.dispose());
  simulation.setRunKind('free');
  simulation.setEncounter('rear_threat');
  simulation.setDriveDuration(0);
  simulation.start();
  context.mock.timers.tick(400);
  await flush();
  simulation.setSpeed(50);
  for (let tick = 0; tick < 30 && simulation.snapshot().started; tick++) {
    context.mock.timers.tick(400);
    await flush();
  }
  const collision = simulation.snapshot();
  assert.equal(collision.drive.phase, 'collision');
  assert.equal(collision.world.collisionCause, 'rear_vehicle');
  assert.equal(collision.drive.score.collisions, 1);
  assert.equal(collision.drive.score.hazardsFaced, 0);
  assert.equal(calls, 0);
  context.mock.timers.tick(5000);
  await flush();
  assert.deepEqual(simulation.snapshot(), collision);
});
