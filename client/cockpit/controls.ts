import type { HazardVariant, Mode } from '../../src/types.js';

export type Control =
  | { command: 'start' | 'reset' }
  | { command: 'mode'; value: Mode }
  | { command: 'hazard'; value: HazardVariant }
  | { command: 'speed' | 'temperature' | 'threshold' | 'staleness'; value: number };

export type SendControl = (control: Control) => Promise<void>;

export const captions = [
  'The world does not wait. Watch the reflex act without slow reasoning.',
  'A missed hazard costs more. Compare the risk with the notch, not just 0.50.',
  'Agreement is not authority. Watch both independent gate checks.',
  'Can fresh, permitted advice release a prior brake? Watch the application.',
] as const;

export function presetCommands(moment: number, alternate = false): Control[] {
  if (!Number.isInteger(moment) || moment < 1 || moment > 4) throw new Error('Unknown presenter moment.');
  return [
    { command: 'reset' },
    { command: 'mode', value: moment <= 2 ? 'fast_only' : 'async_gated' },
    { command: 'hazard', value: moment === 2 ? 'ambiguous' : 'elk' },
    { command: 'speed', value: 90 },
    { command: 'temperature', value: moment === 3 ? -4 : 12 },
    { command: 'threshold', value: moment === 2 && alternate ? 0.5 : 0.35 },
    { command: 'staleness', value: moment === 4 ? 6 : 3 },
  ];
}

export function createControls(
  send: SendControl,
  onBusy: (busy: boolean) => void,
): (commands: Control[]) => Promise<void> {
  let queue = Promise.resolve();
  return (commands) => {
    const work = queue.then(async () => {
      onBusy(true);
      try {
        for (const command of commands) await send(command);
      } finally {
        onBusy(false);
      }
    });
    // Return the failure to its caller without poisoning the following operation.
    queue = work.then(() => undefined, () => undefined);
    return work;
  };
}
