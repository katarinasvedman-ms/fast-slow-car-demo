import OpenAI from 'openai';
import { setTimeout as delay } from 'node:timers/promises';
import type { Config } from '../config.js';
import type { FastResult, SlowResult } from '../types.js';
import { azureCredential } from './auth.js';
import { foundryQuestions } from './questions.js';

export interface ModelServices {
  reset?: () => void;
  fast: { name: string; decide: (observation: string, signal: AbortSignal) => Promise<FastResult> };
  slow: { name: string; advise: (observation: string, signal: AbortSignal) => Promise<SlowResult> };
}

export function parseFastAnswers(answers: unknown): Omit<FastResult, 'latencyMs'> {
  if (
    !answers || typeof answers !== 'object' ||
    !('major_damage_risk' in answers) || !('adjacent_lane_clear' in answers)
  ) throw new Error('Decision-1 returned no complete answers object.');
  const probability = (name: 'major_damage_risk' | 'adjacent_lane_clear'): number | null => {
    const answer: unknown = name === 'major_damage_risk' ? answers.major_damage_risk : answers.adjacent_lane_clear;
    if (!answer || typeof answer !== 'object' || !('type' in answer)) {
      throw new Error(`Decision-1 returned no typed ${name} answer.`);
    }
    if (answer.type === 'refusal') return null;
    if (answer.type !== 'noul' || !('noul' in answer)) {
      throw new Error(`Decision-1 returned an unsupported ${name} answer.`);
    }
    if (answer.noul === null) return null;
    if (typeof answer.noul !== 'number' || !Number.isFinite(answer.noul) || answer.noul < 0 || answer.noul > 1) {
      throw new Error(`Decision-1 returned an invalid ${name} probability.`);
    }
    return answer.noul;
  };
  return { majorDamageRisk: probability('major_damage_risk'), adjacentLaneClear: probability('adjacent_lane_clear') };
}

export function parseSlowAdvice(value: unknown): Omit<SlowResult, 'latencyMs'> {
  if (
    !value || typeof value !== 'object' || !('action' in value) ||
    (value.action !== 'brake' && value.action !== 'swerve' && value.action !== 'continue') ||
    !('rationale' in value) || typeof value.rationale !== 'string' ||
    value.rationale.trim().length === 0 || value.rationale.length > 600
  ) throw new Error('Reasoning model returned an invalid action or rationale.');
  if (value.action === 'swerve') {
    if (!('targetLane' in value) || (value.targetLane !== 1 && value.targetLane !== 2 && value.targetLane !== 3)) {
      throw new Error('Reasoning model omitted a valid swerve lane.');
    }
    return { action: value.action, targetLane: value.targetLane, rationale: value.rationale };
  }
  return { action: value.action, rationale: value.rationale };
}

export function createLiveModels(config: Config) {
  if (!config.foundryEndpoint) throw new Error('Set FOUNDRY_ENDPOINT, or use STUB=1 for offline rehearsal.');
  const credential = azureCredential(process.env.FOUNDRY_API_KEY);
  const fastUrl = new URL('/providers/microsoft/v1/systemone', config.foundryEndpoint);
  const slowUrl = new URL('/openai/v1/', config.foundryEndpoint);
  const client = new OpenAI({ baseURL: slowUrl.href, apiKey: credential.token, maxRetries: 0, timeout: 30_000 });
  let nextDecisionAt = 0;
  return {
    ready: async (): Promise<void> => { await credential.token(); },
    fast: {
      name: 'Microsoft Decision-1',
      async decide(observation: string, signal: AbortSignal): Promise<FastResult & { answers: unknown }> {
        const headers = await credential.headers();
        signal.throwIfAborted();
        // Shared across ticks/resets: leave headroom below the deployment's 60/s limit.
        const scheduledAt = Math.max(performance.now(), nextDecisionAt);
        nextDecisionAt = scheduledAt + 50;
        const waitMs = scheduledAt - performance.now();
        if (waitMs > 0) await delay(waitMs, undefined, { signal });
        signal.throwIfAborted();
        const started = performance.now();
        const response = await fetch(fastUrl, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: config.fastDeployment, state: observation, questions: foundryQuestions() }),
          signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
          redirect: 'error',
        });
        if (!response.ok) throw new Error(`Decision-1 HTTP ${response.status}.`);
        const value: unknown = await response.json();
        if (!value || typeof value !== 'object' || !('answers' in value)) {
          throw new Error('Decision-1 returned no answers.');
        }
        return { ...parseFastAnswers(value.answers), latencyMs: performance.now() - started, answers: value.answers };
      },
    },
    slow: {
      name: config.slowModel,
      async advise(observation: string, signal: AbortSignal): Promise<SlowResult> {
        const started = performance.now();
        const result = await client.responses.create({
          model: config.slowModel,
          store: false,
          instructions:
            'This is a synthetic toy simulation, not real driving advice. You are an advisory route planner, not the policy authority. ' +
            'Recommend one action from the sensor observation. When an obstacle may be large and an adjacent lane is observed clear, ' +
            'prefer moving to that clear adjacent lane. A separate deterministic gate may refuse your recommendation. ' +
            'Do not assume hidden facts. Give a short rationale of one or two sentences.',
          input: observation,
          reasoning: { effort: 'medium' },
          max_output_tokens: 4096,
          text: {
            format: {
              type: 'json_schema',
              name: 'toy_advice',
              strict: true,
              schema: {
                type: 'object',
                properties: {
                  action: { type: 'string', enum: ['swerve', 'brake', 'continue'] },
                  targetLane: { anyOf: [{ type: 'integer', enum: [1, 2, 3] }, { type: 'null' }] },
                  rationale: { type: 'string' },
                },
                required: ['action', 'targetLane', 'rationale'],
                additionalProperties: false,
              },
            },
          },
        }, { signal });
        if (result.status !== 'completed' || !result.output_text) {
          throw new Error(`Reasoning model did not complete: ${result.status}.`);
        }
        const parsed: unknown = JSON.parse(result.output_text);
        return { ...parseSlowAdvice(parsed), latencyMs: performance.now() - started };
      },
    },
  };
}
