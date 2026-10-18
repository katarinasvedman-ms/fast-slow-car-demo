import type { HazardVariant, Mode, RunKind, Snapshot } from '../../src/types.js';

export type Control =
  | { command: 'start' | 'reset' | 'stop' }
  | { command: 'run'; value: RunKind }
  | { command: 'mode'; value: Mode }
  | { command: 'hazard'; value: HazardVariant }
  | { command: 'speed' | 'temperature' | 'threshold' | 'staleness' | 'duration'; value: number };

export type SendControl = (control: Control) => Promise<void>;

export const scenarios = [
  { id: 'custom', name: 'Custom', watch: 'Tune, then Start.', settings: null },
  { id: 'confident-elk', name: 'Confident elk', watch: 'Watch: early braking.',
    settings: { mode: 'fast_only', hazard: 'elk', speed: 90, threshold: 0.35, staleness: 3, temperature: 12 } },
  { id: 'ambiguous-hazard', name: 'Ambiguous hazard', watch: 'Watch: risk vs notch.',
    settings: { mode: 'fast_only', hazard: 'ambiguous', speed: 90, threshold: 0.35, staleness: 3, temperature: 12 } },
  { id: 'late-advice-refused', name: 'Late advice refused', watch: 'Watch: both lamps.',
    settings: { mode: 'async_gated', hazard: 'elk', speed: 90, threshold: 0.35, staleness: 3, temperature: -4 } },
  { id: 'allowed-swerve', name: 'Allowed swerve', watch: 'Watch: brake release.',
    settings: { mode: 'async_gated', hazard: 'elk', speed: 90, threshold: 0.35, staleness: 6, temperature: 12 } },
] as const;

export type ScenarioId = typeof scenarios[number]['id'];

export function scenarioFor(id: string): typeof scenarios[number] {
  const scenario = scenarios.find((entry) => entry.id === id);
  if (!scenario) throw new Error('Unknown cockpit scenario.');
  return scenario;
}

export function scenarioCommands(id: ScenarioId): Control[] {
  const { settings } = scenarioFor(id);
  if (!settings) return [];
  return [
    { command: 'reset' },
    { command: 'run', value: 'staged' },
    { command: 'mode', value: settings.mode },
    { command: 'hazard', value: settings.hazard },
    { command: 'speed', value: settings.speed },
    { command: 'temperature', value: settings.temperature },
    { command: 'threshold', value: settings.threshold },
    { command: 'staleness', value: settings.staleness },
  ];
}

function matches(id: ScenarioId, snapshot: Snapshot): boolean {
  const { settings } = scenarioFor(id);
  return settings !== null && snapshot.drive.kind === 'staged' &&
    snapshot.mode === settings.mode && snapshot.hazardVariant === settings.hazard &&
    snapshot.world.selectedSpeedKmh === settings.speed && snapshot.threshold === settings.threshold &&
    snapshot.world.ambientTempC === settings.temperature && snapshot.settings.stalenessLimitTicks === settings.staleness;
}

export class ScenarioSelection {
  private selected: ScenarioId = 'custom';
  private pending: ScenarioId | undefined;

  choose(id: ScenarioId): void {
    this.custom();
    if (id !== 'custom') this.pending = id;
  }

  custom(): void {
    this.selected = 'custom';
    this.pending = undefined;
  }

  update(snapshot: Snapshot): ScenarioId {
    if (this.pending && matches(this.pending, snapshot)) {
      this.selected = this.pending;
      this.pending = undefined;
    } else if (this.selected !== 'custom' && !matches(this.selected, snapshot)) this.custom();
    return this.selected;
  }
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
