import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../src/config.js';
import { buildObservation, observeScene } from '../src/observation.js';
import { Simulation } from '../src/simulation.js';
import { advanceWorld, applyAction, createWorld, publicWorld, setWorldSpeed } from '../src/world.js';
import { fakeModels, flush } from './helpers.js';
import { fastAction, hazardInPath } from '../src/policy.js';

test('gradual braking integrates distance, preserves braking on speed changes, and stops without negative speed', () => {
  const config = loadConfig({ TICK_MS: '600', TICK_BUDGET_MS: '550', BRAKE_DECEL_MPS2: '2' });
  let world = applyAction(createWorld(config), 'brake');
  const first = advanceWorld(world, config);
  assert.ok(Math.abs(first.hazard.distanceM - (500 - 25 * 0.6 + 0.5 * 2 * 0.6 ** 2)) < 1e-9);
  assert.ok(first.speedKmh < world.speedKmh);
  world = setWorldSpeed(first, 130);
  assert.equal(world.speedKmh, first.speedKmh);
  assert.equal(world.selectedSpeedKmh, 130);
  const released = applyAction(world, 'continue');
  assert.equal(released.braking, false);
  assert.equal(released.speedKmh, world.speedKmh);
  for (let i = 0; i < 100; i += 1) world = advanceWorld(world, config);
  assert.equal(world.outcome, 'braked');
  assert.equal(world.speedKmh, 0);
  assert.equal(world.hazard.distanceM > 0, true);
  const terminal = advanceWorld(world, config);
  assert.equal(terminal.hazard.distanceM, world.hazard.distanceM);
  const collision = { ...terminal, outcome: 'collision' as const };
  assert.equal(applyAction(collision, 'swerve', 3), collision);
});

test('ground truth resolves collision, safe passage, and blocked swerves without ending early', () => {
  const config = loadConfig({ INITIAL_HAZARD_DISTANCE_M: '11' });
  const elk = createWorld(config);
  assert.equal(applyAction(elk, 'continue').outcome, 'running');
  assert.equal(advanceWorld(advanceWorld(elk, config), config).outcome, 'collision');
  assert.equal(advanceWorld(advanceWorld(createWorld(config, 90, 'small_animal'), config), config).outcome, 'continued');
  const swerving = applyAction(elk, 'swerve', 3);
  assert.equal(swerving.outcome, 'running');
  assert.equal(swerving.carLane, 2);
  assert.equal(advanceWorld(advanceWorld(swerving, config), config).outcome, 'collision');
  let clear = applyAction(createWorld(loadConfig({ INITIAL_HAZARD_DISTANCE_M: '41' })), 'swerve', 3);
  for (let i = 0; i < 3; i += 1) {
    assert.equal(clear.carLane, 2);
    assert.equal(clear.laneChange?.elapsedTicks, i);
    clear = advanceWorld(clear, config);
  }
  assert.equal(clear.carLane, 3);
  assert.equal(clear.laneChange, null);
  assert.equal(advanceWorld(advanceWorld(clear, config), config).outcome, 'swerved');
  assert.equal(applyAction(elk, 'swerve', 1).outcome, 'collision');
  assert.throws(() => applyAction(elk, 'swerve', 2));
});

test('sensor path includes both occupied lanes during a turn, and fast decisions never brake outside it', () => {
  const car = createWorld(loadConfig({}));
  const turning = applyAction(car, 'swerve', 3);
  assert.equal(hazardInPath({ lane: 2, rangeM: 100 }, turning), true);
  assert.equal(hazardInPath({ lane: 3, rangeM: 100 }, turning), true);
  assert.equal(hazardInPath({ lane: 1, rangeM: 100 }, turning), false);
  assert.equal(hazardInPath(null, turning), false);
  assert.equal(hazardInPath({ lane: 2, rangeM: 100 }, { ...car, carLane: 3 }), false);
  for (const result of [
    { majorDamageRisk: 0.9, adjacentLaneClear: 0.9, latencyMs: 1 },
    { majorDamageRisk: null, adjacentLaneClear: null, latencyMs: 1 },
    { majorDamageRisk: 0.1, adjacentLaneClear: null, latencyMs: 1 },
  ]) {
    assert.equal(fastAction(result, 0.35, true), 'brake');
    assert.equal(fastAction(result, 0.35, false), 'continue');
  }
});

test('clear-path recovery integrates acceleration and caps speed, but cannot accelerate during a turn or in the hazard path', () => {
  const config = loadConfig({ ACCEL_MPS2: '2' });
  const original = createWorld(config);
  const slow = { ...original, carLane: 3 as const, speedKmh: 36 };
  const accelerated = advanceWorld(slow, config);
  assert.ok(Math.abs(accelerated.speedKmh - 38.88) < 1e-9);
  assert.ok(Math.abs(accelerated.distanceTravelledM - (10 * 0.4 + 0.5 * 2 * 0.4 ** 2)) < 1e-9);
  const capped = advanceWorld({ ...slow, selectedSpeedKmh: 37 }, config);
  assert.equal(capped.speedKmh, 37);
  const untilCap = (37 / 3.6 - 10) / 2;
  assert.ok(Math.abs(capped.distanceTravelledM - (10 * 0.4 + 2 * untilCap * (0.4 - untilCap / 2))) < 1e-9);
  const turning = applyAction({ ...original, speedKmh: 36 }, 'swerve', 3);
  assert.equal(advanceWorld(turning, config).speedKmh, 36);
  assert.equal(advanceWorld({ ...original, speedKmh: 36 }, config).speedKmh, 36);
  assert.ok(advanceWorld({ ...slow, braking: true }, config).speedKmh < 36);
  const gap = advanceWorld({ ...original, hazardActive: false, speedKmh: 0 }, config);
  assert.ok(Math.abs(gap.speedKmh - 2.88) < 1e-9);
  assert.equal(gap.hazard.distanceM, original.hazard.distanceM);
  assert.equal(observeScene(gap, 'elk').contact, null);
  assert.equal(observeScene(gap, 'elk').contactDescription, 'No active sensor contact.');
  assert.throws(() => buildObservation(gap, 'elk'), /active sensor contact/);
});

test('observations contain only derived sensors; public snapshots conceal truth until the outcome', () => {
  const config = loadConfig({});
  const world = createWorld(config, 90, 'ambiguous');
  const text = buildObservation(world, 'ambiguous');
  assert.match(text, /uncertain/);
  assert.doesNotMatch(text, /elk|small_animal|adjacentLanesBlocked|"kind"/);
  assert.match(text, /Lane 1: vehicle detected/);
  assert.match(text, /Lane 3: clear/);
  const view = publicWorld(world);
  assert.equal(view.ambientTempC, 12);
  const cold = { ...world, ambientTempC: -4 };
  assert.equal(buildObservation(cold, 'ambiguous'), text);
  assert.deepEqual(observeScene(cold, 'ambiguous'), observeScene(world, 'ambiguous'));
  assert.equal(view.identity, null);
  assert.equal('hazard' in view, false);
  assert.equal('adjacentLanesBlocked' in view, false);
  assert.equal(publicWorld({ ...world, outcome: 'braked' }).identity, 'elk');
});

test('neither model receives the trusted temperature or grip policy', async () => {
  const inputs: string[] = [];
  for (const temperature of [-4, 12]) {
    const simulation = new Simulation(loadConfig({}), fakeModels({
      fast: { name: 'Capture fast', async decide(observation) {
        inputs.push(observation);
        return { majorDamageRisk: 0.1, adjacentLaneClear: 0.9, latencyMs: 1 };
      } },
      slow: { name: 'Capture slow', advise(observation) {
        inputs.push(observation);
        return new Promise(() => {});
      } },
    }));
    simulation.setTemperature(temperature);
    simulation.start();
    await flush();
    simulation.dispose();
  }
  assert.equal(inputs.length, 4);
  for (const observation of inputs) {
    assert.equal(observation, inputs[0]);
    assert.doesNotMatch(observation, /ambientTempC|temperature|°C|normal grip|frost risk|ice risk/i);
  }
});

test('rendered traffic, clearance and contact descriptions share the observation source', () => {
  const original = createWorld(loadConfig({}));
  const world = {
    ...original, adjacentLanesBlocked: [3 as const],
    adjacentVehicleDistanceBehindM: 35, clearLaneDistanceM: 80,
  };
  const scene = observeScene(world, 'ambiguous');
  const observation = buildObservation(world, 'ambiguous');
  assert.deepEqual(scene.lanes, [
    { lane: 1, vehicleBehindM: null, clearAheadM: 80 },
    { lane: 2, vehicleBehindM: null, clearAheadM: 80 },
    { lane: 3, vehicleBehindM: 35, clearAheadM: null },
  ]);
  assert.match(observation, /Lane 1: clear to 80 m\./);
  assert.match(observation, /Lane 3: vehicle detected 35 m behind\./);
  assert.ok(observation.includes(scene.contactDescription));
  assert.ok(observation.includes(`Road surface ${scene.roadSurface}.`));
  assert.doesNotMatch(JSON.stringify(scene), /"kind"|"identity"|elk|small_animal/);
  const advanced = advanceWorld(world, loadConfig({}));
  assert.deepEqual(observeScene(advanced, 'ambiguous').lanes, scene.lanes);
  assert.ok(advanced.hazard.distanceM < world.hazard.distanceM);
});

test('the model-input snapshot retains the exact sent text through within-tick changes', async (context) => {
  context.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'] });
  const sent: string[] = [];
  const simulation = new Simulation(loadConfig({}), fakeModels({
    fast: { name: 'Capture input', async decide(observation) {
      sent.push(observation);
      return { majorDamageRisk: 0.1, adjacentLaneClear: 0.9, latencyMs: 1 };
    } },
  }), () => Date.now());
  context.after(() => simulation.dispose());
  simulation.setMode('fast_only');
  assert.equal(simulation.snapshot().observationTick, null);
  simulation.start();
  await flush();
  simulation.setSpeed(60);
  assert.equal(simulation.snapshot().observation, sent[0]);
  assert.match(simulation.snapshot().observation, /Vehicle speed 90 km\/h/);
  assert.equal(simulation.snapshot().observationTick, 0);
  context.mock.timers.tick(400);
  await flush();
  assert.equal(simulation.snapshot().observation, sent[1]);
  assert.match(simulation.snapshot().observation, /Vehicle speed 60 km\/h/);
  assert.equal(simulation.snapshot().observationTick, 1);
  assert.deepEqual(simulation.snapshot().scene.lanes[0], { lane: 1, vehicleBehindM: 20, clearAheadM: null });
  simulation.reset();
  assert.equal(simulation.snapshot().observationTick, null);
});

test('fixed clock advances independently and reset stops old ticks', async (context) => {
  context.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'] });
  const simulation = new Simulation(loadConfig({}), fakeModels(), () => Date.now());
  simulation.setMode('fast_only');
  context.after(() => simulation.dispose());
  const before = simulation.snapshot().world.distanceM;
  simulation.start();
  simulation.start();
  await flush();
  for (let i = 0; i < 3; i += 1) { context.mock.timers.tick(400); await flush(); }
  assert.equal(simulation.snapshot().world.tick, 3);
  assert.ok(simulation.snapshot().world.distanceM < before);
  simulation.setSpeed(130);
  assert.equal(simulation.snapshot().world.tick, 3);
  assert.equal(simulation.snapshot().world.speedKmh, 90);
  assert.equal(simulation.snapshot().world.selectedSpeedKmh, 130);
  simulation.reset();
  context.mock.timers.tick(800);
  assert.equal(simulation.snapshot().world.tick, 0);
  assert.equal(simulation.snapshot().started, false);
});
