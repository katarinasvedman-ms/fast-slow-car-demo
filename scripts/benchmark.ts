import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { loadConfig } from '../src/config.js';
import { buildObservation } from '../src/observation.js';
import { createWorld } from '../src/world.js';
import { foundryQuestions } from '../src/models/questions.js';
import { azureCredential } from '../src/models/auth.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--check' && arg !== '--allow-paid-requests')) {
    throw new Error('Use --check or --allow-paid-requests. Only Decision-1 is measured; no model comparison.');
  }
  const config = loadConfig();
  if (config.stub) throw new Error('The latency measurement requires live mode; unset STUB.');
  if (!config.foundryEndpoint) throw new Error('Configure FOUNDRY_ENDPOINT.');
  const network = process.env.BENCHMARK_NETWORK?.trim();
  if (!network) throw new Error('Set BENCHMARK_NETWORK to identify the local connection being measured.');
  const credential = azureCredential(process.env.FOUNDRY_API_KEY);
  const headers = await credential.headers();
  if (args.includes('--check')) {
    console.log('Decision-1 configuration and authentication ready. No inference calls made.');
    return;
  }
  if (!args.includes('--allow-paid-requests')) {
    throw new Error('Pass --allow-paid-requests to authorize 20 live Decision-1 requests.');
  }
  const observation = buildObservation(createWorld(config), 'elk');
  const samples: { latencyMs: number; answers: unknown }[] = [];
  let failures = 0;
  console.log(`Decision-1 local timing calibration / ${network}; 20 requests, no retries.`);
  for (let request = 1; request <= 20; request += 1) {
    if (request > 1) await delay(50);
    const started = performance.now();
    try {
      const response = await fetch(new URL('/providers/microsoft/v1/systemone', config.foundryEndpoint), {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: config.fastDeployment, state: observation, questions: foundryQuestions() }),
        signal: AbortSignal.timeout(15_000),
        redirect: 'error',
      });
      if (!response.ok) {
        const body: unknown = await response.json();
        console.error(`Request ${request}: HTTP ${response.status}; ${JSON.stringify(body).slice(0, 800)}`);
        failures += 1;
        continue;
      }
      const body: unknown = await response.json();
      if (!body || typeof body !== 'object' || !('answers' in body)) {
        throw new Error('Decision-1 returned no answers.');
      }
      const latencyMs = performance.now() - started;
      samples.push({ latencyMs, answers: body.answers });
      console.log(`${request}/20: ${latencyMs.toFixed(1)} ms`);
      if (request === 1) console.log(`Answer shape: ${JSON.stringify(body.answers)}`);
    } catch (error) {
      failures += 1;
      console.error(`Request ${request}: ${error instanceof Error ? error.name : 'unknown failure'}; no retry.`);
    }
  }
  const sorted = samples.map((sample) => sample.latencyMs).sort((a, b) => a - b);
  const p50Ms = sorted[Math.ceil(sorted.length * 0.5) - 1] ?? null;
  const p95Ms = sorted[Math.ceil(sorted.length * 0.95) - 1] ?? null;
  console.table([{ provider: 'Microsoft Decision-1', successes: samples.length, failures, p50Ms, p95Ms }]);
  if (failures || p95Ms === null) throw new Error('Measurement failed; successful-only percentiles are not accepted as a healthy run.');
  const tickMs = p95Ms > 350 && p95Ms <= 550 ? 600 : 400;
  const result = {
    measuredAt: new Date().toISOString(), network, requests: 20, failures,
    model: 'Microsoft-Decision-1', deployment: config.fastDeployment,
    p50Ms, p95Ms, tickMs, tickBudgetMs: tickMs - 50, samples,
  };
  await mkdir('fixtures', { recursive: true });
  await writeFile('fixtures/latency.json', JSON.stringify(result, null, 2) + '\n');
  console.log(`TICK_MS=${tickMs}; TICK_BUDGET_MS=${tickMs - 50}.`);
  if (p95Ms > 550) console.log('Decision-1 exceeds the budget; keep visible safe-default deadline handling. No second provider is required.');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Latency measurement failed.');
  process.exitCode = 1;
});
