import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/server.js';
import { Simulation } from '../src/simulation.js';
import type { Snapshot } from '../src/types.js';
import { fakeModels } from './helpers.js';
import { ServerResponse } from 'node:http';
import { runCommands } from '../client/cockpit/controls.js';

test('local HTTP controls and SSE publish the moving world and both gate records', async (context) => {
  const simulation = new Simulation(loadConfig({ TICK_MS: '50', TICK_BUDGET_MS: '40' }), fakeModels());
  simulation.setMode('fast_only');
  const server = createApp(simulation).listen(0, '127.0.0.1');
  context.after(() => {
    simulation.dispose();
    server.close();
    server.closeAllConnections();
  });

  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const post = (body: unknown, extraHeaders: Record<string, string> = {}) => fetch(`${origin}/api/control`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify(body),
  });
  assert.equal((await fetch(origin)).status, 200);
  assert.match(await (await fetch(`${origin}/main.js`)).text(), /EventSource/);
  for (const animal of ['moose', 'squirrel']) {
    const image = await fetch(`${origin}/images/${animal}.png`);
    assert.equal(image.status, 200);
    assert.match(image.headers.get('content-type') ?? '', /image\/png/);
    assert.equal(Buffer.from(await image.arrayBuffer()).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  }
  assert.equal((await post({ command: 'speed', value: 131 })).status, 400);
  assert.equal((await post({ command: 'start' }, { Origin: 'https://untrusted.example' })).status, 403);
  assert.equal((await post({ command: 'threshold', value: 2 })).status, 400);
  for (const value of [-21, 31, '12', null]) {
    assert.equal((await post({ command: 'temperature', value })).status, 400);
  }
  for (const value of [-20, 30, 0.5, 12]) {
    assert.equal((await post({ command: 'temperature', value })).status, 200);
  }
  for (const value of [-1, 1001, 1.5, '6', null]) {
    assert.equal((await post({ command: 'staleness', value })).status, 400);
  }
  for (const value of [0, 1000, 3]) {
    assert.equal((await post({ command: 'staleness', value })).status, 200);
  }
  const abort = new AbortController();
  context.after(() => abort.abort());
  const timeout = setTimeout(() => abort.abort(), 5000);
  context.after(() => clearTimeout(timeout));
  const stream = await fetch(`${origin}/api/events`, { signal: abort.signal });
  assert.match(stream.headers.get('content-type') ?? '', /text\/event-stream/);
  const reader = stream.body?.getReader();
  assert.ok(reader);
  const decoder = new TextDecoder();
  let buffer = '';
  async function nextSnapshot(): Promise<Snapshot> {
    for (;;) {
      const end = buffer.indexOf('\n\n');
      if (end >= 0) {
        const message = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (message.startsWith('data: ')) return JSON.parse(message.slice(6));
      } else {
        const chunk = await reader!.read();
        if (chunk.done) throw new Error('SSE ended before a snapshot.');
        buffer += decoder.decode(chunk.value, { stream: true });
      }
    }
  }
  assert.equal((await nextSnapshot()).world.tick, 0);
  assert.equal((await post({ command: 'start' })).status, 200);
  let moving = await nextSnapshot();
  while (moving.world.tick < 1) moving = await nextSnapshot();
  assert.ok(moving.world.distanceM < 500);
  assert.equal((await post({ command: 'temperature', value: -4 })).status, 200);
  let cooled = await nextSnapshot();
  while (cooled.world.ambientTempC !== -4) cooled = await nextSnapshot();
  assert.equal(cooled.settings.swerveSpeedLimit, 40);
  assert.equal(cooled.settings.swerveTier, 'ice risk');
  assert.equal((await post({ command: 'staleness', value: 6 })).status, 200);
  let updated = await nextSnapshot();
  while (updated.settings.stalenessLimitTicks !== 6) updated = await nextSnapshot();
  assert.ok(updated.world.tick >= 1);
  assert.equal((await post({ command: 'hazard', value: 'small_animal' })).status, 409);
  assert.equal((await post({ command: 'mode', value: 'blocking' })).status, 409);
  const state = await (await fetch(`${origin}/api/state`)).json();
  assert.partialDeepStrictEqual(state, {
    gate: [
      { phase: 'application', decision: { allowed: true } },
      { phase: 'proposal', decision: { allowed: true } },
    ],
  });
  assert.equal((await post({ command: 'reset' })).status, 200);
  const reset = await (await fetch(`${origin}/api/state`)).json();
  assert.partialDeepStrictEqual(reset, {
    started: false, world: { tick: 0, ambientTempC: -4 }, gate: [], settings: { stalenessLimitTicks: 6 },
  });
  await reader.cancel();
});

test('SSE backpressure retains only the latest snapshot and drains without disconnecting the view', async (context) => {
  const simulation = new Simulation(loadConfig({}), fakeModels());
  const server = createApp(simulation).listen(0, '127.0.0.1');
  const abort = new AbortController();
  let streamResponse: ServerResponse | undefined;
  let writes = 0;
  const originalWrite = ServerResponse.prototype.write;
  context.mock.method(ServerResponse.prototype, 'write', function (this: ServerResponse, ...args: Parameters<typeof originalWrite>) {
    const written = originalWrite.apply(this, args);
    if (String(this.getHeader('Content-Type')).includes('text/event-stream')) {
      streamResponse = this;
      writes += 1;
      if (writes === 1) return false;
    }
    return written;
  });
  context.after(() => { abort.abort(); simulation.dispose(); server.close(); server.closeAllConnections(); });
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const response = await fetch(`http://127.0.0.1:${address.port}/api/events`, { signal: abort.signal });
  const reader = response.body?.getReader();
  assert.ok(reader && streamResponse);
  await reader.read();
  simulation.setTemperature(-4);
  simulation.setTemperature(3);
  simulation.setTemperature(12);
  assert.equal(writes, 1);
  assert.equal(streamResponse.destroyed, false);
  streamResponse.emit('drain');
  assert.equal(writes, 2);
  const frame = await reader.read();
  const text = new TextDecoder().decode(frame.value);
  assert.equal((text.match(/data: /g) ?? []).length, 1);
  assert.equal(JSON.parse(text.slice(6)).world.ambientTempC, 12);
  await reader.cancel();
});

test('continuous run selection preserves explicit HTTP tuning controls without starting requests', async (context) => {
  let calls = 0;
  const simulation = new Simulation(loadConfig({ INITIAL_HAZARD_DISTANCE_M: '80' }), fakeModels({
    fast: { name: 'Mock unused', async decide() { calls++; throw new Error('Must not call before Start.'); } },
  }));
  const server = createApp(simulation).listen(0, '127.0.0.1');
  context.after(() => { simulation.dispose(); server.close(); server.closeAllConnections(); });
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const post = (body: unknown) => fetch(`${origin}/api/control`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  for (const command of [
    { command: 'speed', value: 90 }, { command: 'staleness', value: 6 }, ...runCommands('free'),
  ]) {
    const response = await post(command);
    assert.equal(response.status, 200, JSON.stringify(command));
  }
  const ready = simulation.snapshot();
  assert.equal(ready.started, false);
  assert.equal(ready.drive.kind, 'free');
  assert.equal(ready.drive.durationS, 0);
  assert.equal(ready.world.encounter, 'rear_threat');
  assert.equal(ready.world.selectedSpeedKmh, 90);
  assert.equal(ready.settings.stalenessLimitTicks, 6);
  assert.equal(ready.scene.contact, null);
  assert.equal(ready.scene.followingVehicle?.distanceBehindM, 80);
  assert.equal(calls, 0);
  assert.equal((await post({ command: 'start' })).status, 200);
  assert.equal((await post({ command: 'encounter', value: 'standard' })).status, 409);
  assert.equal((await post({ command: 'stop' })).status, 200);
  assert.equal(simulation.snapshot().drive.finishReason, 'stopped');
  assert.equal((await post({ command: 'reset' })).status, 200);
  assert.equal(simulation.snapshot().drive.durationS, 0);
  assert.equal(simulation.snapshot().world.encounter, 'rear_threat');
});

test('free-drive HTTP controls validate duration, reject STUB, resume collision and finalize Stop', async (context) => {
  for (const stub of [true, false]) {
    const simulation = new Simulation(loadConfig({
      STUB: stub ? '1' : '0', TICK_MS: '50', TICK_BUDGET_MS: '40',
      DRIVE_GAP_S: '0', DRIVE_SEED: '1',
    }), fakeModels());
    simulation.setMode('fast_only');
    const server = createApp(simulation).listen(0, '127.0.0.1');
    context.after(() => { simulation.dispose(); server.close(); server.closeAllConnections(); });
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const origin = `http://127.0.0.1:${address.port}`;
    const post = (command: string, value?: unknown) => fetch(`${origin}/api/control`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command, value }),
    });

    test('rear-threat controls reject recordings, require reset, and restore the original staged encounter', async (context) => {
      for (const stub of [true, false]) {
        const simulation = new Simulation(loadConfig({ STUB: stub ? '1' : '0' }), fakeModels());
        const server = createApp(simulation).listen(0, '127.0.0.1');
        context.after(() => { simulation.dispose(); server.close(); server.closeAllConnections(); });
        await new Promise<void>((resolve) => server.once('listening', resolve));
        const address = server.address();
        assert.ok(address && typeof address !== 'string');
        const post = (value: string) => fetch(`http://127.0.0.1:${address.port}/api/control`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: 'encounter', value }),
        });
        assert.equal((await post('invalid')).status, 400);
        assert.equal((await post('rear_threat')).status, stub ? 409 : 200);
        if (!stub) {
          assert.equal(simulation.snapshot().scene.followingVehicle?.lane, 2);
          simulation.start();
          assert.equal((await post('standard')).status, 409);
          simulation.reset();
          assert.equal(simulation.snapshot().world.encounter, 'rear_threat');
          assert.equal((await post('standard')).status, 200);
          assert.equal(simulation.snapshot().scene.followingVehicle, null);
          assert.equal(simulation.snapshot().world.distanceM, 500);
          simulation.setRunKind('free');
          assert.equal((await post('rear_threat')).status, 200);
          assert.equal(simulation.snapshot().world.encounter, 'rear_threat');
          assert.equal(simulation.snapshot().scene.followingVehicle?.distanceBehindM, 80);
        }
      }
    });
    assert.equal((await fetch(`${origin}/drive.js`)).status, 200);
    for (const invalid of [-1, 3601, 1.5, '120', null]) assert.equal((await post('duration', invalid)).status, 400);
    assert.equal((await post('duration', 0)).status, 200);
    assert.equal(simulation.snapshot().drive.durationS, 0);
    assert.equal((await post('duration', 30)).status, 200);
    assert.equal((await post('stop')).status, 409);
    assert.equal((await post('run', 'free')).status, stub ? 409 : 200);
    if (stub) {
      assert.equal(simulation.snapshot().drive.kind, 'staged');
    } else {
      assert.equal((await post('hazard', 'elk')).status, 409);
      assert.equal((await post('start')).status, 200);
      const deadline = Date.now() + 2000;
      while (simulation.snapshot().drive.phase !== 'collision' && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(simulation.snapshot().drive.phase, 'collision');
      assert.equal(simulation.snapshot().world.identity, 'small_animal');
      assert.equal(simulation.snapshot().drive.score.collisions, 1);
      assert.equal(simulation.snapshot().drive.score.avoidedByBraking, 0);
      assert.equal(simulation.snapshot().drive.score.avoidedBySwerving, 0);
      assert.equal((await post('run', 'staged')).status, 409);
      assert.equal((await post('start')).status, 200);
      assert.equal(simulation.snapshot().drive.phase, 'gap');
      assert.equal((await post('stop')).status, 200);
      assert.equal(simulation.snapshot().drive.phase, 'finished');
      assert.equal((await post('start')).status, 409);
      assert.equal((await post('reset')).status, 200);
      assert.equal(simulation.snapshot().drive.durationS, 30);
      assert.equal((await post('run', 'staged')).status, 200);
    }
    simulation.dispose();
    server.close();
    server.closeAllConnections();
  }
});
