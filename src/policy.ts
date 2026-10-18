import type { Action, FastResult } from './types.js';

export function fastAction(result: FastResult, threshold: number): Action {
  return result.majorDamageRisk === null || result.adjacentLaneClear === null ||
    result.majorDamageRisk >= threshold ? 'brake' : 'continue';
}
