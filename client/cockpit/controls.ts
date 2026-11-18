import type { Encounter, HazardVariant, Mode, RunKind } from '../../src/types.js';

export type Control =
  | { command: 'start' | 'reset' | 'stop' }
  | { command: 'run'; value: RunKind }
  | { command: 'mode'; value: Mode }
  | { command: 'hazard'; value: HazardVariant }
  | { command: 'encounter'; value: Encounter }
  | { command: 'speed' | 'temperature' | 'threshold' | 'staleness' | 'duration'; value: number };

export type SendControl = (control: Control) => Promise<void>;

export function runCommands(kind: RunKind): Control[] {
  return [
    { command: 'reset' },
    { command: 'run', value: kind },
    { command: 'encounter', value: kind === 'free' ? 'rear_threat' : 'standard' },
    ...(kind === 'free' ? [{ command: 'duration', value: 0 } as const] : []),
  ];
}

export async function sendControl(control: Control, request: typeof fetch = fetch, retryAfterReset = true): Promise<void> {
  const response = await request('/api/control', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(control),
  });
  if (response.ok) return;
  const body: unknown = await response.json();
  const message = typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
    ? body.error : `Control failed: HTTP ${response.status}`;
  if (retryAfterReset && response.status === 409 && message.startsWith('Reset before changing') &&
      (control.command === 'mode' || control.command === 'hazard')) {
    await sendControl({ command: 'reset' }, request, false);
    await sendControl(control, request, false);
    return;
  }
  throw new Error(message);
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
