import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../src/config.js';
import { evaluateGate } from '../src/gate.js';
import { observeScene } from '../src/observation.js';
import { fastProposal } from '../src/policy.js';
import { Simulation } from '../src/simulation.js';
import { createWorld } from '../src/world.js';
import { parseSnapshot } from '../client/cockpit/model.js';
import type { FastResult, SlowResult } from '../src/types.js';
import { deferred, fakeModels, flush } from './helpers.js';

const known: FastResult = { majorDamageRisk: 0.1, adjacentLaneClear: 0.95, latencyMs: 1 };
const swerve: SlowResult = { action: 'swerve', targetLane: 3, rationale: 'Observed lane 3 clear.', latencyMs: 400 };

test('fast steering needs the speed boundary, confidence and a specific observed-clear adjacent route', () => {
  const config = loadConfig({});
  const car = createWorld(config, 40);
  const scene = observeScene(car, 'elk');
  assert.deepEqual(fastProposal(known, 0.35, scene, car, config), { action: 'swerve', targetLane: 3 });
  assert.equal(fastProposal(known, 0.35, scene, { ...car, speedKmh: 40.01 }, config).action, 'slow_down');
  assert.equal(fastProposal({ ...known, adjacentLaneClear: 0.89 }, 0.35, scene, car, config).action, 'slow_down');
  assert.equal(fastProposal({ ...known, majorDamageRisk: null }, 0.35, scene, car, config).action, 'brake');
  assert.equal(fastProposal({ ...known, adjacentLaneClear: null }, 0.35, scene, car, config).action, 'brake');
  assert.equal(fastProposal(known, 0.35, { ...scene, contact: { lane: 1, rangeM: 30 } }, car, config).action, 'continue');
  for (const change of [
    { vehicleBehindM: 100 }, { vehicleAheadM: 100 }, { clearAheadM: null }, { clearAheadM: 10 },
  ]) {
    const unsafe = structuredClone(scene);
    Object.assign(unsafe.lanes[2]!, change);
    assert.equal(fastProposal(known, 0.35, unsafe, car, config).action, 'slow_down');
  }
  const left = structuredClone(scene);
  left.lanes[0] = { lane: 1, vehicleBehindM: null, clearAheadM: 100 };
  left.lanes[2]!.vehicleBehindM = 5;
  assert.equal(fastProposal(known, 0.35, left, car, config).targetLane, 1);
  assert.equal(fastProposal(known, 0.35, scene, {
    ...car, laneChange: { fromLane: 2, toLane: 1, elapsedTicks: 1, durationTicks: 3, startedAtTick: 0 },
  }, config).action, 'slow_down');
});

test('fast steering uses a tracked rear gap and closing speed instead of rejecting all rear traffic', () => {
  const config = loadConfig({});
  const car = createWorld(config, 40, 'small_animal', 12, 'rear_threat');
  car.carLane = 1;
  car.hazard.lane = 1;
  car.adjacentLanesBlocked = [];
  for (const [gap, rearSpeed, eligible] of [
    [226, 0, true], [20, 0, true], [19, 0, false],
    [40, 40, true], [80, 130, false], [101, 130, true],
    [-100, 0, false],
  ] as const) {
    car.followingVehicle!.distanceBehindM = gap;
    car.followingVehicle!.speedKmh = rearSpeed;
    const scene = observeScene(car, 'small_animal');
    assert.deepEqual(fastProposal(known, 0.35, scene, car, config),
      eligible ? { action: 'swerve', targetLane: 2 } : { action: 'slow_down' }, `rear ${gap} m at ${rearSpeed} km/h`);
  }
  car.followingVehicle!.distanceBehindM = 226;
  const scene = observeScene(car, 'small_animal');
  assert.equal(fastProposal(known, 0.35, { ...scene, followingVehicle: null }, car, config).action, 'slow_down');
  assert.equal(fastProposal(known, 0.35, { ...scene, followingVehicle: { ...scene.followingVehicle!, lane: 3 } }, car, config).action, 'slow_down');
  const unknownAhead = structuredClone(scene);
  unknownAhead.lanes[1]!.clearAheadM = null;
  assert.equal(fastProposal(known, 0.35, unknownAhead, car, config).action, 'slow_down');
  const slowerTurn = { ...config, tickMs: 1000 };
  car.followingVehicle!.distanceBehindM = 101;
  car.followingVehicle!.speedKmh = 130;
  assert.equal(fastProposal(known, 0.35, observeScene(car, 'small_animal'), car, slowerTurn).action, 'slow_down');
});

test('fast steering requires confidence in the actual target side, never borrowing the opposite side score', () => {
  const config = loadConfig({});
  const car = createWorld(config, 40);
  car.adjacentLanesBlocked = [];
  const scene = observeScene(car, 'elk');
  const left = { ...known, laneClear: { left: 0.95, right: 0.2 } };
  assert.deepEqual(fastProposal(left, 0.35, scene, car, config), { action: 'swerve', targetLane: 1 });
  assert.deepEqual(fastProposal({ ...left, laneClear: { left: 0.95, right: 0.95 } }, 0.35, scene, car, config),
    { action: 'swerve', targetLane: 3 });
  const blockedLeft = structuredClone(scene);
  blockedLeft.lanes[0]!.vehicleBehindM = 5;
  assert.equal(fastProposal(left, 0.35, blockedLeft, car, config).action, 'slow_down');
  assert.equal(fastProposal({ ...left, laneClear: { left: null, right: 0.2 } }, 0.35, scene, car, config).action, 'slow_down');
  assert.equal(fastProposal({ ...left, adjacentLaneClear: null, laneClear: { left: null, right: null } }, 0.35, scene, car, config).action, 'brake');
  assert.equal(fastProposal({ ...left, laneClear: { left: null, right: 0.95 } }, 0.35, scene, car, config).targetLane, 3);
  for (const ego of [1, 3] as const) {
    car.carLane = ego;
    car.hazard.lane = ego;
    const absentHigh = { ...known, laneClear: ego === 1 ? { left: 0.99, right: 0.2 } : { left: 0.2, right: 0.99 } };
    assert.equal(fastProposal(absentHigh, 0.35, observeScene(car, 'elk'), car, config).action, 'slow_down');
    const adjacentHigh = { ...known, laneClear: ego === 1 ? { left: 0.2, right: 0.95 } : { left: 0.95, right: 0.2 } };
    assert.equal(fastProposal(adjacentHigh, 0.35, observeScene(car, 'elk'), car, config).targetLane, 2);
  }
});

test('continuous fast steering can return past distant stopped traffic to avoid the next small contact', async (context) => {
  context.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'] });
  const simulation = new Simulation(loadConfig({
    BRAKE_DECEL_MPS2: '9', GENTLE_DECEL_MPS2: '4', INITIAL_HAZARD_DISTANCE_M: '80', DRIVE_SEED: '42',
  }), fakeModels({
    fast: { name: 'Measured sensor response', async decide(input) {
      return { ...known, majorDamageRisk: input.includes('estimated mass low.') ? 0.08 : 0.9 };
    } },
    slow: { name: 'Must not run', async advise() { assert.fail('Fast-only must not invoke reasoning.'); } },
  }), () => Date.now());
  context.after(() => simulation.dispose());
  simulation.setRunKind('free');
  simulation.setEncounter('rear_threat');
  simulation.setMode('fast_only');
  simulation.setSpeed(80);
  simulation.start();
  await flush();
  let turnState;
  for (let i = 0; i < 250 && simulation.snapshot().started; i++) {
    context.mock.timers.tick(400);
    await flush();
    const state = simulation.snapshot();
    if (state.drive.episodeId === 2 && state.world.laneChange) turnState = state;
    if (state.drive.score.avoidedBySwerving === 2) break;
  }
  const state = simulation.snapshot();
  assert.ok(turnState);
  assert.equal(turnState.world.laneChange?.fromLane, 1);
  assert.equal(turnState.world.laneChange?.toLane, 2);
  assert.equal(turnState.scene.followingVehicle?.lane, 2);
  assert.equal(turnState.scene.followingVehicle?.speedKmh, 0);
  assert.ok(turnState.scene.followingVehicle!.distanceBehindM > 80);
  assert.ok(turnState.world.speedKmh <= 40);
  assert.equal(state.drive.score.collisions, 0);
  assert.equal(state.drive.score.avoidedBySwerving, 2);
  assert.ok(state.execution.some((event) => event.episodeId === 2 && event.source === 'fast' && event.phase === 'completed'));
});

test('the gate enforces fast actor cap and temperature independently of slow proposals', () => {
  const envelope = { action: 'swerve', source: 'fast', fromLane: 2, toLane: 3, speedKmh: 40, observedAtTick: 0, proposedAtTick: 0 } as const;
  const policy = { fastSwerveSpeedLimit: 40, swerveSpeedLimit: 110, swerveTier: 'normal grip', ambientTempC: 12, stalenessLimitTicks: 3 } as const;
  assert.equal(evaluateGate(envelope, 0, 40, policy).allowed, true);
  const capped = evaluateGate(envelope, 0, 40.01, policy);
  assert.equal(capped.allowed, false);
  assert.match(!capped.allowed ? capped.reasons[0].detail : '', /actor cap/);
  assert.equal(evaluateGate({ ...envelope, source: 'slow' }, 0, 110, policy).allowed, true);
  assert.equal(evaluateGate({ ...envelope, source: 'slow' }, 0, 110.01, policy).allowed, false);
  const cold = { ...policy, swerveSpeedLimit: 35, swerveTier: 'ice risk', ambientTempC: -4 } as const;
  for (const source of ['fast', 'slow'] as const) {
    const rejected = evaluateGate({ ...envelope, source }, 4, 40, cold);
    assert.deepEqual(rejected.allowed ? [] : rejected.reasons.map((item) => item.reason), ['stale_advice', 'prohibited_action']);
  }
});

test('fast-only slows from 50 to 40 and completes its own three-tick turn without invoking reasoning', async (context) => {
  context.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'] });
  let slowCalls = 0;
  const simulation = new Simulation(loadConfig({ BRAKE_DECEL_MPS2: '9', INITIAL_HAZARD_DISTANCE_M: '85' }), fakeModels({
    fast: { name: 'Known low risk', async decide() { return { ...known, laneClear: { left: 0.2, right: 0.95 } }; } },
    slow: { name: 'Must not run', async advise() { slowCalls++; return swerve; } },
  }), () => Date.now());
  context.after(() => simulation.dispose());
  simulation.setMode('fast_only');
  simulation.setSpeed(50);
  simulation.start();
  await flush();
  for (let i = 0; i < 30 && simulation.snapshot().started; i++) {
    context.mock.timers.tick(400);
    await flush();
  }
  const state = simulation.snapshot();
  assert.equal(slowCalls, 0);
  assert.equal(state.world.outcome, 'swerved');
  assert.equal(state.world.carLane, 3);
  assert.deepEqual(state.fast.laneClear, { left: 0.2, right: 0.95 });
  assert.ok(state.log.some((entry) => entry.laneClear?.right === 0.95 && entry.laneClear.left === 0.2));
  const applied = state.execution.find((event) => event.phase === 'applied' && event.action === 'swerve');
  const completed = state.execution.find((event) => event.phase === 'completed');
  assert.equal(applied?.source, 'fast');
  assert.ok(applied && completed && completed.tick - applied.tick === 3);
  assert.equal(completed.source, 'fast');
  assert.match(applied.detail, /GATE ALLOWED/);
  assert.deepEqual(parseSnapshot(JSON.stringify(state)), state);
  simulation.reset();
  assert.deepEqual(simulation.snapshot().execution, []);
});

test('current colder limits can refuse a captured fast proposal at 40 without releasing its slowdown', async (context) => {
  context.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'] });
  const pending = deferred<FastResult>();
  let calls = 0;
  const simulation = new Simulation(loadConfig({
    BRAKE_DECEL_MPS2: '9', INITIAL_HAZARD_DISTANCE_M: '80', SWERVE_SPEED_LIMIT_ICE: '35',
  }), fakeModels({
    fast: { name: 'Captured sensors', decide() { return ++calls === 4 ? pending.promise : Promise.resolve(known); } },
  }), () => Date.now());
  context.after(() => simulation.dispose());
  simulation.setMode('fast_only');
  simulation.setSpeed(50);
  simulation.start();
  await flush();
  for (let i = 0; i < 3; i++) { context.mock.timers.tick(400); await flush(); }
  simulation.setTemperature(-4);
  pending.resolve(known);
  await flush();
  const state = simulation.snapshot();
  assert.equal(state.world.speedKmh, 40);
  assert.equal(state.world.slowing, true);
  assert.equal(state.world.laneChange, null);
  assert.ok(state.execution.some((event) => event.source === 'fast' && event.action === 'swerve' && event.phase === 'refused'));
});

test('the shared scenario can show fast slowing plus optional slow steering beating either incomplete response alone', async (context) => {
  context.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'] });
  for (const mode of ['fast_only', 'blocking', 'async_gated'] as const) {
    const pending = deferred<SlowResult>();
    const simulation = new Simulation(loadConfig({ BRAKE_DECEL_MPS2: '9', INITIAL_HAZARD_DISTANCE_M: '80' }), fakeModels({
      fast: { name: 'Known low risk', async decide() { return known; } },
      slow: { name: 'Controlled 2000 ms answer', advise() { return pending.promise; } },
    }), () => Date.now());
    simulation.setMode(mode);
    simulation.setHazard('small_animal');
    simulation.setStalenessLimit(10);
    simulation.start();
    await flush();
    for (let i = 0; i < 5; i++) { context.mock.timers.tick(400); await flush(); }
    pending.resolve({ ...swerve, latencyMs: 2000 });
    await flush();
    for (let i = 0; i < 30 && simulation.snapshot().world.outcome === 'running'; i++) {
      context.mock.timers.tick(400);
      await flush();
    }
    const state = simulation.snapshot();
    assert.equal(state.world.outcome, mode === 'async_gated' ? 'swerved' : 'collision', mode);
    if (mode === 'async_gated') {
      assert.ok(state.execution.some((event) => event.source === 'fast' && event.action === 'slow_down' && event.phase === 'applied'));
      assert.ok(state.execution.some((event) => event.source === 'slow' && event.action === 'swerve' && event.phase === 'applied'));
      assert.ok(state.execution.some((event) => event.source === 'slow' && event.phase === 'completed'));
    }
    simulation.dispose();
    await flush();
  }
});
