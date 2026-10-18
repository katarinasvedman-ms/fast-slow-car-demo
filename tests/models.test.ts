import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLiveModels, parseFastAnswers, parseSlowAdvice } from '../src/models/live.js';
import { createStubModels } from '../src/models/stub.js';
import { fastAction } from '../src/policy.js';
import { loadConfig } from '../src/config.js';
import { buildObservation } from '../src/observation.js';
import { createWorld } from '../src/world.js';
import { Simulation } from '../src/simulation.js';
import { flush } from './helpers.js';

test('answer variants are narrowed; unknown is not false and the threshold boundary brakes', () => {
  const answers = { major_damage_risk: { type: 'noul', noul: 0.35 }, adjacent_lane_clear: { type: 'noul', noul: 0.9 } };
  const result = { ...parseFastAnswers(answers), latencyMs: 1 };
  assert.equal(fastAction(result, 0.35), 'brake');
  assert.equal(fastAction({ ...result, majorDamageRisk: 0.349 }, 0.35), 'continue');
  const refused = parseFastAnswers({ ...answers, major_damage_risk: { type: 'refusal' } });
  assert.equal(refused.majorDamageRisk, null);
  assert.equal(fastAction({ ...refused, latencyMs: 1 }, 0.35), 'brake');
  assert.equal(fastAction({ ...result, majorDamageRisk: 0.1, adjacentLaneClear: null }, 0.35), 'brake');
  for (const value of [-0.1, 1.1, NaN, undefined]) {
    assert.throws(() => parseFastAnswers({ ...answers, major_damage_risk: { type: 'noul', noul: value } }));
  }
  assert.throws(() => parseFastAnswers({ ...answers, major_damage_risk: { type: 'choice', probability: 0.1 } }));
  assert.throws(() => parseSlowAdvice({ action: 'swerve', rationale: 'Missing lane.' }));
  assert.throws(() => parseSlowAdvice({ action: 'continue', rationale: '' }));
});

test('recorded replay requires no network and preserves actual answers and timing', async (context) => {
  const fetchMock = context.mock.method(globalThis, 'fetch', () => { throw new Error('No network permitted.'); });
  const models = await createStubModels();
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const config = loadConfig({ STUB: '1' });
  const observation = buildObservation(createWorld(config, 90, 'ambiguous'), 'ambiguous');
  const promise = models.fast.decide(observation, new AbortController().signal);
  context.mock.timers.tick(1000);
  const result = await promise;
  assert.ok(result.majorDamageRisk !== null && result.majorDamageRisk >= 0 && result.majorDamageRisk <= 1);
  const slow = await models.slow.advise(observation, new AbortController().signal);
  assert.equal(slow.action, 'swerve');
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('actual offline replay produces a missed deadline and five-tick independent refusals', async (context) => {
  context.mock.method(globalThis, 'fetch', () => { throw new Error('No network permitted.'); });
  const models = await createStubModels();
  context.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'] });
  const simulation = new Simulation(loadConfig({ STUB: '1' }), models, () => Date.now());
  context.after(() => simulation.dispose());
  simulation.start();
  await flush();
  for (let ms = 0; ms < 2240; ms += 20) { context.mock.timers.tick(20); await flush(); }
  const snapshot = simulation.snapshot();
  assert.equal(snapshot.advice.data?.observedAtTick, 0);
  assert.equal(snapshot.advice.data?.arrivedAtTick, 5);
  assert.equal(snapshot.world.braking, true);
  assert.ok(snapshot.fast.missedDeadlines >= 1);
  const decision = snapshot.advice.gate;
  assert.ok(decision && !decision.allowed);
  assert.deepEqual(decision.reasons.map((reason) => reason.reason), ['stale_advice', 'prohibited_action']);
  simulation.reset();
  assert.equal(simulation.snapshot().fast.missedDeadlines, 0);
});

test('recorded slow advice changes lanes with age limit six instead of being refused at three', async (context) => {
  context.mock.method(globalThis, 'fetch', () => { throw new Error('No network permitted.'); });
  const models = await createStubModels();
  context.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'] });
  for (const limit of [3, 6]) {
    const simulation = new Simulation(loadConfig({ STUB: '1' }), models, () => Date.now());
    context.after(() => simulation.dispose());
    simulation.setHazard('ambiguous');
    simulation.setSpeed(60);
    simulation.setThreshold(0.5);
    simulation.setStalenessLimit(limit);
    simulation.start();
    await flush();
    for (let ms = 0; ms < 3440; ms += 20) { context.mock.timers.tick(20); await flush(); }
    const snapshot = simulation.snapshot();
    assert.equal(snapshot.advice.data?.arrivedAtTick, 5);
    assert.equal(snapshot.world.braking, false);
    assert.equal(snapshot.fast.missedDeadlines, 0);
    assert.equal(snapshot.world.carLane, limit === 6 ? 3 : 2);
    assert.equal(snapshot.advice.gate?.allowed, limit === 6);
    if (limit === 6) assert.match(snapshot.advice.application ?? '', /^slow swerve applied/);
    else assert.match(snapshot.advice.application ?? '', /stale_advice/);
    simulation.dispose();
  }
});

test('recorded reasoning is initially prohibited at 90 but fresh reassessment can turn after braking below the limit', async (context) => {
  context.mock.method(globalThis, 'fetch', () => { throw new Error('No network permitted.'); });
  let rationale: string | undefined;
  for (const speed of [60, 90]) {
    await context.test(`${speed} km/h`, async (scenario) => {
      const models = await createStubModels();
      scenario.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'] });
      const simulation = new Simulation(loadConfig({ STUB: '1' }), models, () => Date.now());
      scenario.after(() => simulation.dispose());
      simulation.setStalenessLimit(6);
      simulation.setSpeed(speed);
      simulation.start();
      await flush();
      for (let ms = 0; ms < 2280; ms += 20) { scenario.mock.timers.tick(20); await flush(); }
      const atAdvice = simulation.snapshot();
      assert.equal(atAdvice.advice.data?.arrivedAtTick, 5);
      if (rationale === undefined) rationale = atAdvice.advice.data?.rationale;
      else assert.equal(atAdvice.advice.data?.rationale, rationale);
      if (speed === 60) {
        assert.equal(atAdvice.world.braking, false);
        assert.equal(atAdvice.world.laneChange?.toLane, 3);
        assert.match(atAdvice.advice.application ?? '', /superseded fast brake at tick 0/);
        assert.equal(atAdvice.log.find((entry) => entry.supersession)?.tick, 5);
      } else {
        assert.ok(atAdvice.advice.gate && !atAdvice.advice.gate.allowed);
        assert.deepEqual(atAdvice.advice.gate.reasons.map((reason) => reason.reason), ['prohibited_action']);
        assert.equal(atAdvice.world.braking, true);
        assert.equal(atAdvice.world.laneChange, null);
        assert.equal(atAdvice.log.some((entry) => entry.supersession?.envelope.source === 'slow'), false);
      }
      for (let ms = 0; ms < 2400; ms += 20) { scenario.mock.timers.tick(20); await flush(); }
      if (speed === 90) {
        const reassessed = simulation.snapshot();
        assert.equal(reassessed.advice.data?.observedAtTick, 6);
        assert.equal(reassessed.advice.data?.arrivedAtTick, 11);
        assert.ok(reassessed.world.speedKmh < 70);
        assert.deepEqual(reassessed.advice.gate, { allowed: true });
        assert.equal(reassessed.world.laneChange?.toLane, 3);
      }
      for (let ms = 0; ms < 18_000; ms += 20) { scenario.mock.timers.tick(20); await flush(); }
      assert.equal(simulation.snapshot().world.carLane, 3);
      assert.equal(simulation.snapshot().world.outcome, 'braked');
      assert.equal(simulation.snapshot().world.speedKmh, 0);
    });
  }
});

test('live decision pacing spaces mocked requests and cancels a queued request without sending it', async (context) => {
  const previous = process.env.FOUNDRY_API_KEY;
  process.env.FOUNDRY_API_KEY = 'test-only-not-a-real-key';
  context.after(() => {
    if (previous === undefined) delete process.env.FOUNDRY_API_KEY;
    else process.env.FOUNDRY_API_KEY = previous;
  });
  const started: number[] = [];
  context.mock.method(globalThis, 'fetch', async () => {
    started.push(performance.now());
    return Response.json({
      answers: { major_damage_risk: { type: 'noul', noul: 0.9 }, adjacent_lane_clear: { type: 'noul', noul: 0.9 } },
    });
  });
  const models = createLiveModels(loadConfig({ FOUNDRY_ENDPOINT: 'https://example.invalid' }));
  const cancelled = new AbortController();
  const calls = [
    models.fast.decide('Synthetic observation.', new AbortController().signal),
    models.fast.decide('Synthetic observation.', new AbortController().signal),
    models.fast.decide('Synthetic observation.', new AbortController().signal),
    models.fast.decide('Synthetic observation.', cancelled.signal),
  ];
  await flush();
  cancelled.abort();
  const results = await Promise.allSettled(calls);
  assert.equal(started.length, 3);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  assert.ok((started[2] ?? 0) - (started[0] ?? 0) >= 80);
});
