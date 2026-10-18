import { mkdir, writeFile } from 'node:fs/promises';
import { loadConfig } from '../src/config.js';
import { createLiveModels } from '../src/models/live.js';
import { buildObservation } from '../src/observation.js';
import { createWorld } from '../src/world.js';
import type { HazardVariant } from '../src/types.js';

async function main(): Promise<void> {
  if (!process.argv.includes('--allow-paid-requests')) throw new Error('Pass --allow-paid-requests to capture up to 16 decisions and one reasoning response.');
  const config = loadConfig();
  if (config.stub) throw new Error('Fixture capture requires live mode.');
  const models = createLiveModels(config);
  await models.ready();
  const entries = [];
  for (const variant of ['elk', 'small_animal', 'ambiguous'] satisfies HazardVariant[]) {
    const observation = buildObservation(createWorld(config, 90, variant), variant);
    const samples = [];
    let attempts = 0;
    for (; attempts < (variant === 'ambiguous' ? 12 : 2) && samples.length < 2; attempts += 1) {
      const result = await models.fast.decide(observation, AbortSignal.timeout(15_000));
      console.log(`${variant}: risk=${result.majorDamageRisk}, clear=${result.adjacentLaneClear}, ${result.latencyMs.toFixed(1)} ms`);
      if (variant !== 'ambiguous' || (result.majorDamageRisk !== null && result.majorDamageRisk >= 0.35 && result.majorDamageRisk < 0.5)) {
        samples.push({ answers: result.answers, latencyMs: result.latencyMs });
      }
    }
    if (samples.length < 2) throw new Error('No suitable ambiguous rehearsal samples were captured; live probabilities vary. Existing fixtures were not overwritten.');
    entries.push({
      variant, observation, samples, attempts,
      selection: variant === 'ambiguous' ? 'Real samples curated into [0.35, 0.5) for deterministic threshold rehearsal; not a benchmark.' : 'First two real responses.',
    });
  }
  const observation = buildObservation(createWorld(config), 'elk');
  const slow = await models.slow.advise(observation, AbortSignal.timeout(30_000));
  console.log(`Slow: ${slow.action}, ${slow.latencyMs.toFixed(1)} ms; ${slow.rationale}`);
  await mkdir('fixtures', { recursive: true });
  await writeFile('fixtures/recorded.json', JSON.stringify({
    recordedAt: new Date().toISOString(),
    source: 'Live Foundry responses to synthetic observations; no credentials or endpoint stored.',
    fastModel: 'Microsoft-Decision-1', slowModel: config.slowModel,
    entries, slow,
  }, null, 2) + '\n');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Fixture recording failed.');
  process.exitCode = 1;
});
