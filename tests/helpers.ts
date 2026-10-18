import type { ModelServices } from '../src/models/live.js';

export function fakeModels(overrides: Partial<ModelServices> = {}): ModelServices {
  return {
    fast: {
      name: 'Test decision',
      decide: async () => ({ majorDamageRisk: 0.1, adjacentLaneClear: 0.9, latencyMs: 1 }),
    },
    slow: {
      name: 'Test reasoning',
      advise: async () => ({ action: 'swerve', targetLane: 3, rationale: 'Clear sensor return in lane 3.', latencyMs: 1 }),
    },
    ...overrides,
  };
}

export async function flush(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

export function deferred<T>() {
  let complete: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => { complete = resolve; });
  return {
    promise,
    resolve(value: T): void {
      if (!complete) throw new Error('Deferred promise not initialized.');
      complete(value);
    },
  };
}
