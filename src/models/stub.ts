import { readFile } from 'node:fs/promises';
import type { ModelServices } from './live.js';
import { parseFastAnswers, parseSlowAdvice } from './live.js';

interface RecordedSample { answers: unknown; latencyMs: number }

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function samples(value: unknown): RecordedSample[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('Recorded fixture has no fast samples.');
  return value.map((sample: unknown) => {
    if (!record(sample) || typeof sample.latencyMs !== 'number' || !Number.isFinite(sample.latencyMs) || sample.latencyMs < 0) {
      throw new Error('Recorded fixture has invalid latency.');
    }
    parseFastAnswers(sample.answers);
    return { answers: sample.answers, latencyMs: sample.latencyMs };
  });
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('Replay request cancelled.')); return; }
    const abort = () => {
      clearTimeout(timer);
      reject(new Error('Replay request cancelled.'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}

export async function createStubModels(): Promise<ModelServices> {
  const raw: unknown = JSON.parse(await readFile(new URL('../../../fixtures/recorded.json', import.meta.url), 'utf8'));
  const latency: unknown = JSON.parse(await readFile(new URL('../../../fixtures/latency.json', import.meta.url), 'utf8'));
  if (!record(raw) || !Array.isArray(raw.entries) || !record(raw.slow) || !record(latency)) {
    throw new Error('Recorded fixture files are invalid. Run the live recording command first.');
  }
  const byVariant = new Map<string, RecordedSample[]>();
  for (const entry of raw.entries) {
    if (!record(entry) || typeof entry.variant !== 'string') throw new Error('Invalid recorded scenario.');
    byVariant.set(entry.variant, samples(entry.samples));
  }
  // The real cold-call sample preserves a reproducible missed deadline offline.
  byVariant.set('elk', [...samples(latency.samples), ...(byVariant.get('elk') ?? [])]);
  for (const variant of ['elk', 'small_animal', 'ambiguous']) {
    if (!byVariant.has(variant)) throw new Error(`Recorded fixture is missing ${variant}.`);
  }
  const advice = parseSlowAdvice(raw.slow);
  if (typeof raw.slow.latencyMs !== 'number' || !Number.isFinite(raw.slow.latencyMs) || raw.slow.latencyMs < 0) {
    throw new Error('Recorded slow latency is invalid.');
  }
  const slowLatencyMs = raw.slow.latencyMs;
  const positions = new Map<string, number>();
  return {
    reset: () => positions.clear(),
    fast: {
      name: 'Microsoft Decision-1 / recorded',
      async decide(observation, signal) {
        const variant = observation.includes('mass uncertain') ? 'ambiguous'
          : observation.includes('estimated mass low') ? 'small_animal' : 'elk';
        const recorded = byVariant.get(variant);
        if (!recorded) throw new Error(`No recorded samples for ${variant}.`);
        const position = positions.get(variant) ?? 0;
        positions.set(variant, position + 1);
        const sample = recorded[position % recorded.length];
        if (!sample) throw new Error('Recorded sample is missing.');
        await wait(sample.latencyMs, signal);
        return { ...parseFastAnswers(sample.answers), latencyMs: sample.latencyMs };
      },
    },
    slow: {
      name: `${String(raw.slowModel)} / recorded`,
      async advise(_observation, signal) {
        signal.throwIfAborted();
        return { ...advice, latencyMs: slowLatencyMs };
      },
    },
  };
}
