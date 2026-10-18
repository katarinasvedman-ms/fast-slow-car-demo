import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/server.js';
import { Simulation } from '../src/simulation.js';
import type { Snapshot } from '../src/types.js';
import { fakeModels } from './helpers.js';

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
