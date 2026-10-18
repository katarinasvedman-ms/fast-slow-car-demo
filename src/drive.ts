import type { DriveView, HazardVariant, Lane, WorldState } from './types.js';

export function emptyDrive(seed: number, durationS: number, kind: DriveView['kind'] = 'staged'): DriveView {
  return {
    kind, phase: 'idle', episodeId: null, seed, durationS, elapsedS: 0,
    phaseRemainingS: 0, finishReason: null,
    score: {
      hazardsFaced: 0, avoidedByBraking: 0, avoidedBySwerving: 0,
      slowAllowed: 0, slowRefused: 0, staleAdvice: 0, prohibitedAction: 0,
      collisions: 0, deadlineMisses: 0,
    },
  };
}

export function nextHazard(seed: number, lane: Lane): {
  seed: number; variant: HazardVariant; kind: WorldState['hazard']['kind']; blocked: Lane[];
} {
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  const choice = random();
  const variant = choice < 1 / 3 ? 'elk' : choice < 2 / 3 ? 'small_animal' : 'ambiguous';
  const kind = variant === 'ambiguous' ? random() < 0.5 ? 'elk' : 'small_animal' : variant;
  const blocked = ([1, 2, 3] as const).filter((candidate) =>
    Math.abs(candidate - lane) === 1 && random() < 0.35);
  return { seed, variant, kind, blocked };
}
