import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../src/config.js';
import { buildObservation, observeScene } from '../src/observation.js';
import { Simulation } from '../src/simulation.js';
import { advanceWorld, applyAction, createWorld } from '../src/world.js';
import { parseSnapshot } from '../client/cockpit/model.js';
import type { SlowResult } from '../src/types.js';
import { deferred, fakeModels, flush } from './helpers.js';

const config = loadConfig({ BRAKE_DECEL_MPS2: '9', INITIAL_HAZARD_DISTANCE_M: '45', FOLLOWING_VEHICLE_DISTANCE_M: '35' });
const brake = { majorDamageRisk: 0.9, adjacentLaneClear: 0.9, latencyMs: 1 };
const swerve: SlowResult = { action: 'swerve', targetLane: 3, rationale: 'Rear radar is closing; lane 3 is observed clear.', latencyMs: 1600 };

test('the initial-distance setting controls rear-threat staging, observation and Reset just like other staged encounters', () => {
  for (const distance of [80, 300]) {
    const simulation = new Simulation(loadConfig({ INITIAL_HAZARD_DISTANCE_M: String(distance) }), fakeModels());
    simulation.setEncounter('rear_threat');
    let state = simulation.snapshot();
    assert.equal(state.world.distanceM, distance);
    assert.equal(state.settings.initialHazardDistanceM, distance);
    assert.equal(state.scene.contact?.rangeM, distance);
    assert.match(state.observation, new RegExp(`range ${distance} m`));
    simulation.reset();
    state = simulation.snapshot();
    assert.equal(state.world.encounter, 'rear_threat');
    assert.equal(state.world.distanceM, distance);
    simulation.setEncounter('standard');
    assert.equal(simulation.snapshot().world.distanceM, distance);
    simulation.dispose();
  }
});

test('the farther default follower leaves room for a later turn, while a configurable close follower can hit first', () => {
  const settings = loadConfig({ BRAKE_DECEL_MPS2: '9', INITIAL_HAZARD_DISTANCE_M: '80' });
  let world = applyAction(createWorld(settings, 110, 'elk', 12, 'rear_threat'), 'brake');
  assert.equal(observeScene(world, 'elk').followingVehicle?.distanceBehindM, 80);
  for (let i = 0; i < 8; i++) world = advanceWorld(world, settings);
  assert.equal(world.outcome, 'running');
  assert.ok(world.followingVehicle!.distanceBehindM > 30);
  world = applyAction(world, 'swerve', 3);
  for (let i = 0; i < 3; i++) world = advanceWorld(world, settings);
  assert.equal(world.carLane, 3);
  assert.equal(world.collisionCause, null);
  for (let i = 0; i < 80 && world.outcome === 'running'; i++) world = advanceWorld(world, settings);
  assert.equal(world.outcome, 'swerved');
  const tighter = loadConfig({
    BRAKE_DECEL_MPS2: '9', INITIAL_HAZARD_DISTANCE_M: '80', FOLLOWING_VEHICLE_DISTANCE_M: '35',
  });
  let close = applyAction(createWorld(tighter, 110, 'elk', 12, 'rear_threat'), 'brake');
  for (let i = 0; i < 8 && close.outcome === 'running'; i++) close = advanceWorld(close, tighter);
  assert.equal(close.collisionCause, 'rear_vehicle');
  assert.equal(createWorld(settings).followingVehicle, null);
});

test('following traffic reacts after a delay, closes under hard braking, and can hit a stopped ego car', () => {
  let world = applyAction(createWorld(config, 90, 'elk', 12, 'rear_threat'), 'brake');
  for (let i = 0; i < 4; i++) world = advanceWorld(world, config);
  assert.equal(world.followingVehicle?.speedKmh, 90);
  assert.ok(Math.abs(world.followingVehicle!.distanceBehindM - 23.48) < 1e-8);
  world = advanceWorld(world, config);
  assert.ok(world.followingVehicle!.speedKmh < 90);
  while (world.speedKmh > 0) world = advanceWorld(world, config);
  assert.equal(world.outcome, 'running');
  assert.ok(world.hazard.distanceM > 0 && world.hazard.distanceM < 15);
  assert.ok(world.followingVehicle!.speedKmh > 0);
  for (let i = 0; i < 30 && world.outcome === 'running'; i++) world = advanceWorld(world, config);
  assert.equal(world.outcome, 'collision');
  assert.equal(world.collisionCause, 'rear_vehicle');
  assert.ok(world.hazard.distanceM > 0 && world.hazard.distanceM < 15);
  const frozen = advanceWorld(world, config);
  assert.equal(frozen.distanceTravelledM, world.distanceTravelledM);
  assert.deepEqual(frozen.followingVehicle, world.followingVehicle);

  let spacious = applyAction(createWorld(config, 90, 'elk', 12, 'rear_threat'), 'brake');
  spacious.followingVehicle!.distanceBehindM = 100;
  for (let i = 0; i < 40 && spacious.outcome === 'running'; i++) spacious = advanceWorld(spacious, config);
  assert.equal(spacious.outcome, 'braked');
  assert.equal(spacious.collisionCause, null);
});

test('rear radar and road projection share measured motion, including a follower passing in another lane', () => {
  let world = applyAction(createWorld(config, 90, 'elk', 12, 'rear_threat'), 'brake');
  for (let i = 0; i < 4; i++) world = advanceWorld(world, config);
  const scene = observeScene(world, 'elk');
  assert.equal(scene.lanes[1]?.vehicleBehindM, scene.followingVehicle?.distanceBehindM);
  assert.equal(scene.lanes[1]?.clearAheadM, 100);
  assert.equal(scene.followingVehicle?.closingSpeedKmh, scene.followingVehicle!.speedKmh - world.speedKmh);
  const observation = buildObservation(world, 'elk');
  assert.match(observation, /following vehicle in lane 2, 23 m behind, speed 90 km\/h/);
  assert.match(observation, /relative closing speed 52 km\/h/);
  assert.match(observation, /Lane 2: vehicle detected 23 m behind; clear ahead to 100 m\./);
  assert.match(observation, /Lane 1: vehicle detected 20 m behind/);
  assert.match(observation, /Lane 3: clear to 100 m/);
  assert.doesNotMatch(observation, /elk|kind|reactionRemaining|1\.6|4\.5|temperature|grip|collisionCause/i);
  const ahead = { ...world, carLane: 3 as const, followingVehicle: { ...world.followingVehicle!, distanceBehindM: -12 } };
  assert.equal(observeScene(ahead, 'elk').lanes[1]?.vehicleAheadM, 12);
  assert.equal(observeScene(ahead, 'elk').lanes[1]?.vehicleBehindM, null);
  assert.equal(observeScene(ahead, 'elk').lanes[1]?.clearAheadM, null);
  assert.ok(observeScene(ahead, 'elk').followingVehicle!.closingSpeedKmh < 0);
  assert.match(buildObservation(ahead, 'elk'), /Lane 2: vehicle detected 12 m ahead/);
  assert.equal(observeScene(createWorld(config), 'elk').followingVehicle, null);
});

test('a late lane change does not teleport out of a closing rear collision', () => {
  let world = createWorld(config, 90, 'elk', 12, 'rear_threat');
  world.speedKmh = 0;
  world.followingVehicle!.distanceBehindM = 2;
  world = applyAction(world, 'swerve', 3);
  world = advanceWorld(world, config);
  assert.equal(world.outcome, 'collision');
  assert.equal(world.collisionCause, 'rear_vehicle');
  assert.equal(world.carLane, 2);
  assert.equal(world.laneChange?.elapsedTicks, 1);
});

test('persistent traffic keeps moving in another lane during a stopped dwell', () => {
  const stopped = {
    ...applyAction(createWorld(config, 90, 'elk', 12, 'rear_threat'), 'brake'),
    speedKmh: 0, outcome: 'braked' as const,
  };
  stopped.followingVehicle!.lane = 3;
  const advanced = advanceWorld(stopped, config);
  assert.equal(advanced.outcome, 'braked');
  assert.equal(advanced.distanceTravelledM, stopped.distanceTravelledM);
  assert.equal(advanced.followingVehicle?.lane, 3);
  assert.equal(advanced.followingVehicle?.distanceBehindM, 25);
});

test('catching the persistent vehicle ahead is a traffic impact, including an occupied turn target, not an animal collision', () => {
  for (const turning of [false, true]) {
    const world = createWorld(config, 90, 'elk', 12, 'rear_threat');
    world.hazardActive = false;
    world.followingVehicle!.distanceBehindM = -2;
    world.followingVehicle!.speedKmh = 0;
    if (turning) {
      world.carLane = 3;
      world.laneChange = { fromLane: 3, toLane: 2, startedAtTick: 0, elapsedTicks: 0, durationTicks: 3 };
    }
    const advanced = advanceWorld(world, config);
    assert.equal(advanced.outcome, 'collision');
    assert.equal(advanced.collisionCause, 'front_vehicle');
    assert.equal(advanced.followingVehicle?.distanceBehindM, 0);
    world.carLane = 3;
    world.laneChange = null;
    assert.equal(advanceWorld(world, config).outcome, 'running');
  }
});

test('with no confident fast escape, fast-only and brake advice can collide while gated slow swerving can clear', async (context) => {
  context.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'] });
  for (const action of ['fast_only', 'brake', 'swerve'] as const) {
    let slowCalls = 0;
    const pending = deferred<SlowResult>();
    const inputs: string[] = [];
    const simulation = new Simulation(config, fakeModels({
      fast: { name: 'Mock reflex', async decide(input) { inputs.push(input); return { ...brake, adjacentLaneClear: 0.8 }; } },
      slow: { name: 'Mock reasoning', advise(input) { inputs.push(input); slowCalls++; return pending.promise; } },
    }), () => Date.now());
    simulation.setEncounter('rear_threat');
    simulation.setSpeed(90);
    simulation.setMode(action === 'fast_only' ? 'fast_only' : 'async_gated');
    simulation.setStalenessLimit(10);
    simulation.start();
    await flush();
    assert.equal(simulation.snapshot().world.braking, true);
    for (let i = 0; i < 4; i++) { context.mock.timers.tick(400); await flush(); }
    if (action !== 'fast_only') {
      pending.resolve(action === 'swerve' ? swerve : { action: 'brake', rationale: 'Retain braking.', latencyMs: 1600 });
      await flush();
      assert.equal(simulation.snapshot().advice.gate?.allowed, true);
      if (action === 'swerve') assert.equal(simulation.snapshot().world.laneChange?.toLane, 3);
    }
    for (let i = 0; i < 80 && simulation.snapshot().world.outcome === 'running'; i++) {
      context.mock.timers.tick(400);
      await flush();
    }
    const state = simulation.snapshot();
    assert.equal(state.world.outcome, action === 'swerve' ? 'swerved' : 'collision');
    assert.equal(state.world.collisionCause, action === 'swerve' ? null : 'rear_vehicle');
    assert.equal(state.world.carLane, action === 'swerve' ? 3 : 2);
    if (action === 'fast_only') assert.equal(slowCalls, 0);
    else assert.ok(slowCalls >= 1);
    assert.ok(inputs.every((input) => input.includes('Traffic radar: following vehicle')));
    assert.deepEqual(parseSnapshot(JSON.stringify(state)), state);
    if (action === 'swerve') {
      assert.ok(state.log.some((entry) => entry.supersession?.envelope.source === 'slow'));
      assert.ok(inputs.some((input) => /Ego vehicle occupies lane 3\./.test(input)));
      assert.ok(inputs.every((input) => /Lane 3: clear to 100 m\./.test(input)));
    }
    simulation.dispose();
    await flush();
  }
});

test('highway default allows an early turn but does not manufacture time for late reasoning at close range', async (context) => {
  context.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'] });
  for (const delayTicks of [1, 4]) {
    const pending = deferred<SlowResult>();
    const simulation = new Simulation(config, fakeModels({
      fast: { name: 'Mock reflex', async decide() { return brake; } },
      slow: { name: 'Mock reasoning', advise() { return pending.promise; } },
    }), () => Date.now());
    simulation.setEncounter('rear_threat');
    simulation.setStalenessLimit(10);
    assert.equal(simulation.snapshot().world.selectedSpeedKmh, 110);
    simulation.start();
    await flush();
    for (let i = 0; i < delayTicks; i++) { context.mock.timers.tick(400); await flush(); }
    pending.resolve({ ...swerve, latencyMs: delayTicks * 400 });
    await flush();
    for (let i = 0; i < 30 && simulation.snapshot().world.outcome === 'running'; i++) {
      context.mock.timers.tick(400);
      await flush();
    }
    const state = simulation.snapshot();
    assert.equal(state.world.outcome, delayTicks === 1 ? 'swerved' : 'collision');
    assert.equal(state.world.collisionCause, delayTicks === 1 ? null : 'front_contact');
    simulation.dispose();
    await flush();
  }
});

test('rear-threat advice cannot override staleness and Reset cancels it while retaining the encounter', async (context) => {
  context.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'] });
  const pending = deferred<SlowResult>();
  const signals: AbortSignal[] = [];
  const simulation = new Simulation(config, fakeModels({
    fast: { name: 'Mock brake', async decide() { return brake; } },
    slow: { name: 'Pending reasoning', advise(_input, signal) {
      signals.push(signal);
      return signals.length === 1 ? pending.promise : new Promise(() => {});
    } },
  }), () => Date.now());
  context.after(() => simulation.dispose());
  simulation.setEncounter('rear_threat');
  simulation.start();
  await flush();
  for (let i = 0; i < 4; i++) { context.mock.timers.tick(400); await flush(); }
  pending.resolve(swerve);
  await flush();
  assert.equal(simulation.snapshot().advice.gate?.allowed, false);
  assert.equal(simulation.snapshot().world.laneChange, null);
  simulation.reset();
  assert.equal(simulation.snapshot().world.encounter, 'rear_threat');
  assert.equal(simulation.snapshot().scene.followingVehicle?.distanceBehindM, 35);
  assert.equal(simulation.snapshot().world.distanceM, 45);
  simulation.start();
  await flush();
  simulation.reset();
  assert.equal(signals.at(-1)?.aborted, true);
  await flush();
  assert.equal(simulation.snapshot().advice.status, 'idle');
  assert.equal(simulation.snapshot().world.laneChange, null);
  simulation.setStalenessLimit(10);
  simulation.setEncounter('standard');
  assert.equal(simulation.snapshot().scene.followingVehicle, null);
  simulation.setEncounter('rear_threat');
  simulation.setRunKind('free');
  assert.equal(simulation.snapshot().world.encounter, 'standard');
  assert.equal(simulation.snapshot().scene.followingVehicle, null);
  const stub = new Simulation(loadConfig({ STUB: '1' }), fakeModels());
  assert.throws(() => stub.setEncounter('rear_threat'), /live mode/);
  stub.dispose();
});
