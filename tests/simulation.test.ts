import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../src/config.js';
import { Simulation } from '../src/simulation.js';
import type { FastResult, SlowResult } from '../src/types.js';
import { deferred, fakeModels, flush } from './helpers.js';

const brake = { majorDamageRisk: 0.9, adjacentLaneClear: 0.9, latencyMs: 1 };
const swerve: SlowResult = { action: 'swerve', targetLane: 3, rationale: 'Clear sensor return in lane 3.', latencyMs: 2000 };

test('deadline applies one safe default and discards an eventual late result', async (context) => {
  context.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'] });
  const pending = deferred<FastResult>();
  let calls = 0;
  const simulation = new Simulation(loadConfig({}), fakeModels({
    fast: { name: 'Pending fast', decide: () => ++calls === 1 ? pending.promise : new Promise(() => {}) },
  }), () => Date.now());
  context.after(() => simulation.dispose());
  simulation.setMode('fast_only');
  simulation.start();
  await flush();
  context.mock.timers.tick(350);
  await flush();
  assert.equal(simulation.snapshot().fast.missedDeadlines, 1);
  assert.equal(simulation.snapshot().world.braking, true);
  context.mock.timers.tick(50);
  await flush();
  assert.equal(simulation.snapshot().world.tick, 1);
  pending.resolve({ majorDamageRisk: 0.1, adjacentLaneClear: 0.9, latencyMs: 400 });
  await flush();
  const snapshot = simulation.snapshot();
  assert.equal(snapshot.fast.majorDamageRisk, null);
  assert.equal(snapshot.fast.missedDeadlines, 1);
  assert.ok(snapshot.log.some((entry) => entry.detail.includes('late response discarded')));
  assert.equal(snapshot.world.carLane, 2);
});

test('blocking keeps moving but suppresses fast actions and deadline defaults until advice returns', async (context) => {
  context.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'] });
  const pending = deferred<SlowResult>();
  const simulation = new Simulation(loadConfig({}), fakeModels({
    fast: { name: 'Pending fast', decide: () => new Promise(() => {}) },
    slow: { name: 'Pending slow', advise: () => pending.promise },
  }), () => Date.now());
  context.after(() => simulation.dispose());
  simulation.setMode('blocking');
  simulation.start();
  await flush();
  context.mock.timers.tick(400);
  await flush();
  const snapshot = simulation.snapshot();
  assert.equal(snapshot.world.tick, 1);
  assert.ok(snapshot.world.distanceM < 500);
  assert.equal(snapshot.world.braking, false);
  assert.equal(snapshot.fast.missedDeadlines, 0);
  pending.resolve({ action: 'brake', rationale: 'Brake.', latencyMs: 400 });
  await flush();
  assert.equal(simulation.snapshot().world.braking, true);
  assert.equal(simulation.snapshot().advice.data?.observedAtTick, 0);
  assert.equal(simulation.snapshot().advice.data?.arrivedAtTick, 1);
});

test('async advice shows both refusals or stale-only based on current speed, with two checkpoints', async (context) => {
  context.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'] });
  for (const deceleration of ['1.5', '10']) {
    const pending = deferred<SlowResult>();
    const simulation = new Simulation(loadConfig({ BRAKE_DECEL_MPS2: deceleration }), fakeModels({
      fast: { name: 'Brake fast', decide: async () => brake },
      slow: { name: 'Pending slow', advise: () => pending.promise },
    }), () => Date.now());
    simulation.start();
    await flush();
    for (let i = 0; i < 4; i += 1) { context.mock.timers.tick(400); await flush(); }
    pending.resolve(swerve);
    await flush();
    const snapshot = simulation.snapshot();
    const result = snapshot.advice.gate;
    assert.ok(result && !result.allowed);
    assert.deepEqual(result.reasons.map((reason) => reason.reason),
      deceleration === '1.5' ? ['stale_advice', 'prohibited_action'] : ['stale_advice']);
    assert.equal(snapshot.gate.filter((entry) => entry.envelope.source === 'slow').length, 2);
    assert.equal(snapshot.world.carLane, 2);
    simulation.dispose();
  }
});

test('live staleness changes allow age six but refuse age seven and still enforce the speed rule', async (context) => {
  context.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'] });
  for (const scenario of [
    { age: 6, speed: 60, reason: null },
    { age: 7, speed: 60, reason: 'stale_advice' },
    { age: 6, speed: 90, reason: 'prohibited_action' },
  ]) {
    const pending = deferred<SlowResult>();
    const simulation = new Simulation(loadConfig({}), fakeModels({
      slow: { name: 'Pending slow', advise: () => pending.promise },
    }), () => Date.now());
    context.after(() => simulation.dispose());
    simulation.setSpeed(scenario.speed);
    simulation.start();
    await flush();
    for (let i = 0; i < scenario.age; i += 1) { context.mock.timers.tick(400); await flush(); }
    simulation.setStalenessLimit(6);
    pending.resolve(swerve);
    await flush();
    const snapshot = simulation.snapshot();
    assert.equal(snapshot.world.tick, scenario.age);
    assert.equal(snapshot.settings.stalenessLimitTicks, 6);
    assert.equal(snapshot.world.braking, false);
    if (scenario.reason === null) {
      assert.deepEqual(snapshot.advice.gate, { allowed: true });
      assert.match(snapshot.advice.application ?? '', /^slow swerve applied/);
      assert.equal(snapshot.world.carLane, 2);
      assert.equal(snapshot.world.laneChange?.toLane, 3);
      for (let i = 0; i < 3; i += 1) { context.mock.timers.tick(400); await flush(); }
      assert.equal(simulation.snapshot().world.carLane, 3);
    } else {
      assert.ok(snapshot.advice.gate && !snapshot.advice.gate.allowed);
      assert.deepEqual(snapshot.advice.gate.reasons.map((reason) => reason.reason), [scenario.reason]);
      assert.equal(snapshot.world.carLane, 2);
    }
    simulation.reset();
    assert.equal(simulation.snapshot().settings.stalenessLimitTicks, 6);
    simulation.dispose();
  }
});

test('tightening the live age limit rechecks queued advice without retrying a completed refusal', async (context) => {
  context.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'] });
  const fast = deferred<FastResult>();
  const slow = deferred<SlowResult>();
  const clear = { majorDamageRisk: 0.1, adjacentLaneClear: 0.9, latencyMs: 1 };
  let fastCalls = 0;
  const simulation = new Simulation(loadConfig({}), fakeModels({
    fast: { name: 'Pending tick six', decide: () => ++fastCalls === 7 ? fast.promise : Promise.resolve(clear) },
    slow: { name: 'Pending slow', advise: () => slow.promise },
  }), () => Date.now());
  context.after(() => simulation.dispose());
  simulation.setSpeed(60);
  simulation.setStalenessLimit(6);
  simulation.start();
  await flush();
  for (let i = 0; i < 6; i += 1) { context.mock.timers.tick(400); await flush(); }
  slow.resolve(swerve);
  await flush();
  assert.deepEqual(simulation.snapshot().gate[0]?.decision, { allowed: true });
  assert.equal(simulation.snapshot().advice.application, null);
  simulation.setStalenessLimit(3);
  fast.resolve(clear);
  await flush();
  assert.ok(simulation.snapshot().advice.gate && !simulation.snapshot().advice.gate?.allowed);
  assert.match(simulation.snapshot().advice.application ?? '', /stale_advice/);
  simulation.setStalenessLimit(6);
  assert.equal(simulation.snapshot().world.carLane, 2);
  assert.match(simulation.snapshot().advice.application ?? '', /stale_advice/);
});

test('fast-only never calls reasoning; refusal brakes and service failure is visible', async (context) => {
  context.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'] });
  let slowCalls = 0;
  let fastCalls = 0;
  const simulation = new Simulation(loadConfig({}), fakeModels({
    fast: {
      name: 'Unknown fast',
      async decide() {
        if (++fastCalls > 1) throw new Error('Test service failure.');
        return { majorDamageRisk: null, adjacentLaneClear: 0.9, latencyMs: 1 };
      },
    },
    slow: { name: 'Unused slow', async advise() { slowCalls += 1; return swerve; } },
  }), () => Date.now());
  context.after(() => simulation.dispose());
  simulation.setMode('fast_only');
  simulation.start();
  await flush();
  assert.equal(simulation.snapshot().world.braking, true);
  context.mock.timers.tick(400);
  await flush();
  assert.equal(slowCalls, 0);
  assert.equal(simulation.snapshot().fast.status, 'error');
  assert.match(simulation.snapshot().fast.error ?? '', /Test service failure/);
});

test('slow reassessment uses fresh observations without overlap and can act after an earlier stale refusal', async (context) => {
  context.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'] });
  for (const mode of ['async_gated', 'blocking'] as const) {
    const first = deferred<SlowResult>();
    const second = deferred<SlowResult>();
    const observations: string[] = [];
    const simulation = new Simulation(loadConfig({}), fakeModels({
      slow: {
        name: 'Sequential reasoning',
        advise(observation) {
          observations.push(observation);
          return observations.length === 1 ? first.promise : second.promise;
        },
      },
    }), () => Date.now());
    context.after(() => simulation.dispose());
    simulation.setMode(mode);
    simulation.setSpeed(60);
    simulation.start();
    await flush();
    for (let i = 0; i < 4; i += 1) { context.mock.timers.tick(400); await flush(); }
    assert.equal(observations.length, 1);
    first.resolve(swerve);
    await flush();
    const refused = simulation.snapshot().advice.gate;
    assert.ok(refused && !refused.allowed);
    assert.deepEqual(refused.reasons.map((reason) => reason.reason), ['stale_advice']);
    assert.equal(simulation.snapshot().world.laneChange, null);
    assert.equal(observations.length, 1);

    context.mock.timers.tick(400);
    await flush();
    const reassessing = simulation.snapshot();
    assert.equal(observations.length, 2);
    assert.notEqual(observations[0], observations[1]);
    assert.equal(reassessing.advice.status, 'thinking');
    assert.equal(reassessing.advice.observedAtTick, 5);
    assert.equal(reassessing.advice.data?.observedAtTick, 0);
    assert.deepEqual(reassessing.advice.gate, refused);
    context.mock.timers.tick(400);
    await flush();
    assert.equal(observations.length, 2);
    second.resolve(swerve);
    await flush();
    const applied = simulation.snapshot();
    assert.equal(applied.advice.data?.observedAtTick, 5);
    assert.equal(applied.advice.data?.arrivedAtTick, 6);
    assert.deepEqual(applied.advice.gate, { allowed: true });
    assert.equal(applied.world.laneChange?.toLane, 3);
    assert.equal(applied.gate.filter((record) => record.envelope.source === 'slow' &&
      record.envelope.observedAtTick === 5).length, 2);
    simulation.dispose();
  }
});

test('reset cancels a reassessment and its late result cannot alter the next run', async (context) => {
  context.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'] });
  const pending = deferred<SlowResult>();
  const signals: AbortSignal[] = [];
  const simulation = new Simulation(loadConfig({}), fakeModels({
    slow: {
      name: 'Reassessing reasoning',
      advise(_observation, signal) {
        signals.push(signal);
        return signals.length === 1
          ? Promise.resolve({ action: 'continue', rationale: 'Continue for now.', latencyMs: 1 })
          : signals.length === 2 ? pending.promise : new Promise<SlowResult>(() => {});
      },
    },
  }), () => Date.now());
  context.after(() => simulation.dispose());
  simulation.start();
  await flush();
  context.mock.timers.tick(400);
  await flush();
  assert.equal(signals.length, 2);
  simulation.reset();
  assert.equal(signals[1]?.aborted, true);
  simulation.start();
  await flush();
  const before = simulation.snapshot();
  pending.resolve(swerve);
  await flush();
  assert.equal(simulation.snapshot().world.tick, 0);
  assert.equal(simulation.snapshot().world.laneChange, null);
  assert.deepEqual(simulation.snapshot().advice, before.advice);
});

test('slow reassessment stops on outcomes and does not automatically retry a service error', async (context) => {
  context.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'] });
  for (const fail of [false, true]) {
    let slowCalls = 0;
    const simulation = new Simulation(loadConfig({ BRAKE_DECEL_MPS2: '100' }), fakeModels({
      fast: { name: 'Brake', decide: async () => brake },
      slow: {
        name: 'Stopped reasoning',
        async advise() {
          slowCalls += 1;
          if (fail) throw new Error('Slow service unavailable.');
          return { action: 'brake', rationale: 'Stop.', latencyMs: 1 };
        },
      },
    }), () => Date.now());
    context.after(() => simulation.dispose());
    simulation.start();
    await flush();
    for (let i = 0; i < 5; i += 1) { context.mock.timers.tick(400); await flush(); }
    const snapshot = simulation.snapshot();
    assert.equal(slowCalls, 1);
    assert.equal(snapshot.world.outcome, 'braked');
    assert.equal(snapshot.started, false);
    assert.equal(snapshot.advice.status, fail ? 'error' : 'ready');
    if (fail) assert.match(snapshot.advice.error ?? '', /Slow service unavailable/);
    simulation.dispose();
  }
});

test('reset invalidates pending fast and slow callbacks and cancels their timers', async (context) => {
  context.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'] });
  const fast = deferred<FastResult>();
  const slow = deferred<SlowResult>();
  const simulation = new Simulation(loadConfig({}), fakeModels({
    fast: { name: 'Pending fast', decide: () => fast.promise },
    slow: { name: 'Pending slow', advise: () => slow.promise },
  }), () => Date.now());
  context.after(() => simulation.dispose());
  simulation.start();
  await flush();
  simulation.reset();
  fast.resolve(brake);
  slow.resolve(swerve);
  await flush();
  context.mock.timers.tick(40_000);
  const snapshot = simulation.snapshot();
  assert.equal(snapshot.world.tick, 0);
  assert.equal(snapshot.world.braking, false);
  assert.equal(snapshot.fast.missedDeadlines, 0);
  assert.equal(snapshot.advice.data, null);
  assert.deepEqual(snapshot.gate, []);
});

test('terminal world stays frozen while pending advice ages and is later checked', async (context) => {
  context.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'] });
  const pending = deferred<SlowResult>();
  const simulation = new Simulation(loadConfig({ BRAKE_DECEL_MPS2: '100' }), fakeModels({
    fast: { name: 'Brake fast', decide: async () => brake },
    slow: { name: 'Pending slow', advise: () => pending.promise },
  }), () => Date.now());
  context.after(() => simulation.dispose());
  simulation.start();
  await flush();
  context.mock.timers.tick(400);
  await flush();
  const stopped = simulation.snapshot().world;
  assert.equal(stopped.outcome, 'braked');
  context.mock.timers.tick(1200);
  pending.resolve(swerve);
  await flush();
  const snapshot = simulation.snapshot();
  assert.equal(snapshot.world.distanceM, stopped.distanceM);
  assert.equal(snapshot.world.carLane, stopped.carLane);
  assert.equal(snapshot.world.speedKmh, 0);
  assert.equal(snapshot.advice.data?.arrivedAtTick, 4);
  assert.equal(snapshot.started, false);
});

test('new fast braking wins same-tick conflicts in either completion order', async (context) => {
  context.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'] });
  for (const fastFirst of [false, true]) {
    const fast = deferred<FastResult>();
    const slow = deferred<SlowResult>();
    const simulation = new Simulation(loadConfig({}), fakeModels({
      fast: { name: 'Pending brake', decide: () => fast.promise },
      slow: { name: 'Pending advice', advise: () => slow.promise },
    }), () => Date.now());
    context.after(() => simulation.dispose());
    simulation.setSpeed(60);
    simulation.start();
    await flush();
    if (fastFirst) fast.resolve(brake);
    else slow.resolve(swerve);
    await flush();
    if (fastFirst) slow.resolve(swerve);
    else fast.resolve(brake);
    await flush();
    assert.equal(simulation.snapshot().world.braking, true);
    assert.equal(simulation.snapshot().world.carLane, 2);
    assert.equal(simulation.snapshot().world.laneChange, null);
    assert.match(simulation.snapshot().advice.application ?? '', /same-tick conflict/);
    simulation.dispose();
  }
});

test('later slow advice releases an earlier brake only when allowed, with provenance and a three-tick turn', async (context) => {
  context.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'] });
  for (const speed of [60, 90]) {
    const pending = deferred<SlowResult>();
    const simulation = new Simulation(loadConfig({}), fakeModels({
      fast: { name: 'Brake', decide: async () => brake },
      slow: { name: 'Pending advice', advise: () => pending.promise },
    }), () => Date.now());
    context.after(() => simulation.dispose());
    simulation.setSpeed(speed);
    simulation.start();
    await flush();
    for (let i = 0; i < 2; i += 1) { context.mock.timers.tick(400); await flush(); }
    assert.equal(simulation.snapshot().world.braking, true);
    pending.resolve(swerve);
    await flush();
    const snapshot = simulation.snapshot();
    const speedAtAdvice = snapshot.world.speedKmh;
    assert.equal(snapshot.world.carLane, 2);
    if (speed === 60) {
      assert.equal(snapshot.world.braking, false);
      assert.partialDeepStrictEqual(snapshot.world.laneChange, {
        fromLane: 2, toLane: 3, startedAtTick: 2, elapsedTicks: 0, durationTicks: 3,
      });
      assert.match(snapshot.advice.application ?? '', /applied - superseded fast brake at tick 0/);
      const event = snapshot.log.find((entry) => entry.supersession);
      assert.equal(event?.tick, 2);
      assert.match(event?.detail ?? '', /slow swerve lane 2 -> 3 \/ allowed - fast brake released/);
      const applied = snapshot.gate.find((record) => record.phase === 'application' && record.envelope.source === 'slow');
      assert.deepEqual(applied?.decision, { allowed: true });
      assert.equal(applied?.supersedes?.atTick, 0);
      context.mock.timers.tick(400);
      await flush();
      assert.equal(simulation.snapshot().world.speedKmh, speedAtAdvice);
      assert.equal(simulation.snapshot().world.laneChange?.elapsedTicks, 1);
      for (let i = 0; i < 2; i += 1) { context.mock.timers.tick(400); await flush(); }
      assert.equal(simulation.snapshot().world.carLane, 3);
      assert.equal(simulation.snapshot().world.laneChange, null);
    } else {
      assert.equal(snapshot.world.braking, true);
      assert.equal(snapshot.world.laneChange, null);
      assert.ok(snapshot.advice.gate && !snapshot.advice.gate.allowed);
      assert.deepEqual(snapshot.advice.gate.reasons.map((reason) => reason.reason), ['prohibited_action']);
      assert.equal(snapshot.log.some((entry) => entry.supersession), false);
      context.mock.timers.tick(400);
      await flush();
      assert.ok(simulation.snapshot().world.speedKmh < speedAtAdvice);
    }
    simulation.dispose();
  }
});

test('supersession checks actual application speed rather than the speed observed by reasoning', async (context) => {
  context.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'] });
  const pending = deferred<SlowResult>();
  let captured = '';
  const simulation = new Simulation(loadConfig({ BRAKE_DECEL_MPS2: '10' }), fakeModels({
    fast: { name: 'Brake', decide: async () => brake },
    slow: { name: 'Pending advice', advise: (observation) => { captured = observation; return pending.promise; } },
  }), () => Date.now());
  context.after(() => simulation.dispose());
  simulation.start();
  await flush();
  for (let i = 0; i < 2; i += 1) { context.mock.timers.tick(400); await flush(); }
  pending.resolve(swerve);
  await flush();
  assert.match(captured, /Vehicle speed 90 km\/h/);
  assert.ok(simulation.snapshot().world.speedKmh < 70);
  assert.deepEqual(simulation.snapshot().advice.gate, { allowed: true });
  assert.equal(simulation.snapshot().world.braking, false);
  assert.equal(simulation.snapshot().world.laneChange?.toLane, 3);
});

test('a later fast action may release a brake and a subsequent new brake may supersede it again', async (context) => {
  context.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'] });
  const simulation = new Simulation(loadConfig({}), fakeModels({
    fast: { name: 'Brake risk', decide: async () => brake },
  }), () => Date.now());
  context.after(() => simulation.dispose());
  simulation.setMode('fast_only');
  simulation.start();
  await flush();
  assert.equal(simulation.snapshot().world.braking, true);
  simulation.setThreshold(1);
  context.mock.timers.tick(400);
  await flush();
  assert.equal(simulation.snapshot().world.braking, false);
  assert.equal(simulation.snapshot().gate[0]?.supersedes?.atTick, 0);
  simulation.setThreshold(0.35);
  context.mock.timers.tick(400);
  await flush();
  assert.equal(simulation.snapshot().world.braking, true);
  assert.equal(simulation.snapshot().gate[0]?.supersedes?.atTick, 1);
});

test('a stopped brake can be revised by pending permitted advice without inventing acceleration', async (context) => {
  context.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'] });
  const pending = deferred<SlowResult>();
  const simulation = new Simulation(loadConfig({ BRAKE_DECEL_MPS2: '100' }), fakeModels({
    fast: { name: 'Brake', decide: async () => brake },
    slow: { name: 'Pending advice', advise: () => pending.promise },
  }), () => Date.now());
  context.after(() => simulation.dispose());
  simulation.setSpeed(60);
  simulation.start();
  await flush();
  context.mock.timers.tick(400);
  await flush();
  assert.equal(simulation.snapshot().world.outcome, 'braked');
  pending.resolve(swerve);
  await flush();
  assert.equal(simulation.snapshot().world.braking, false);
  assert.equal(simulation.snapshot().world.outcome, 'running');
  for (let i = 0; i < 3; i += 1) { context.mock.timers.tick(400); await flush(); }
  assert.equal(simulation.snapshot().world.speedKmh, 0);
  assert.equal(simulation.snapshot().world.carLane, 3);
  assert.equal(simulation.snapshot().world.outcome, 'braked');
});

test('elapsed deadline wins over success or failure even if the timer callback has not run', async (context) => {
  context.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  for (const fail of [false, true]) {
    let clock = 0;
    const pending = deferred<void>();
    const simulation = new Simulation(loadConfig({}), fakeModels({
      fast: {
        name: 'Delayed completion',
        async decide() {
          await pending.promise;
          if (fail) throw new Error('Late service failure.');
          return { majorDamageRisk: 0.1, adjacentLaneClear: 0.9, latencyMs: 400 };
        },
      },
    }), () => clock);
    simulation.setMode('fast_only');
    simulation.start();
    await flush();
    clock = 400;
    pending.resolve();
    await flush();
    assert.equal(simulation.snapshot().fast.missedDeadlines, 1);
    assert.equal(simulation.snapshot().world.braking, true);
    assert.equal(simulation.snapshot().fast.majorDamageRisk, null);
    simulation.dispose();
  }
});
