import { CockpitAudio } from './audio.js';
import { createControls } from './controls.js';
import type { Control } from './controls.js';
import { element, input, renderDash, select } from './dash.js';
import type { CockpitView } from './model.js';
import { installPresenter } from './presenter.js';
import { connect } from './state.js';
import type { RoadScene } from './scene.js';

const error = element('error');
const reportError = (message: string) => { error.textContent = message; };
const audio = new CockpitAudio();
let scene: RoadScene | undefined;
let current: CockpitView | undefined;
let busy = false;
let disposed = false;

async function send(control: Control, retryAfterReset = true): Promise<void> {
  const response = await fetch('/api/control', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(control),
  });
  if (!response.ok) {
    const body: unknown = await response.json();
    const message = typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
      ? body.error : `Control failed: HTTP ${response.status}`;
    if (retryAfterReset && response.status === 409 && (control.command === 'mode' || control.command === 'hazard')) {
      await send({ command: 'reset' });
      await send(control, false);
      return;
    }
    throw new Error(message);
  }
}

const run = createControls(send, (value) => {
  busy = value;
  if (current) renderDash(current, [], busy);
});

function execute(commands: Control[]): void {
  error.textContent = '';
  void run(commands).catch((failure: unknown) =>
    reportError(failure instanceof Error ? failure.message : 'Control request failed.'));
}

function start(): void {
  if (busy || !current || current.snapshot.started || current.snapshot.world.outcome !== 'running') return;
  // Resume in the click/keyboard gesture, not after the HTTP operation.
  void audio.start().catch((failure: unknown) =>
    reportError(failure instanceof Error ? `Audio unavailable: ${failure.message}` : 'Audio unavailable.'));
  execute([{ command: 'start' }]);
}

function mute(): void {
  const muted = audio.toggle();
  element('mute').textContent = muted ? 'SOUND OFF [M]' : 'SOUND ON [M]';
  element('mute').setAttribute('aria-pressed', String(muted));
}

element('start').addEventListener('click', start);
element('reset').addEventListener('click', () => execute([{ command: 'reset' }]));
element('mute').addEventListener('click', mute);
select('mode').addEventListener('change', () => {
  const value = select('mode').value;
  if (value === 'fast_only' || value === 'blocking' || value === 'async_gated') execute([{ command: 'mode', value }]);
});
select('hazard').addEventListener('change', () => {
  const value = select('hazard').value;
  if (value === 'elk' || value === 'small_animal' || value === 'ambiguous') execute([{ command: 'hazard', value }]);
});
for (const command of ['speed', 'temperature', 'threshold', 'staleness'] as const) {
  const control = input(command);
  control.addEventListener('change', () => {
    if (control.reportValidity()) execute([{ command, value: control.valueAsNumber }]);
  });
}

const removePresenter = installPresenter(run, start, mute, () => busy || !current, reportError);
const disconnect = connect((view, events) => {
  current = view;
  renderDash(view, events, busy);
  scene?.update(view, events);
  audio.update(view, events);
}, (status) => {
  element('connection').textContent = status;
  element('connection').hidden = status === 'CONNECTED';
  element('connection').dataset.state = status === 'CONNECTED' ? 'good' : 'warning';
  if (status !== 'CONNECTED') audio.reset();
}, reportError);

try {
  const { RoadScene } = await import('./scene.js');
  const canvas = element('road');
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Missing road canvas.');
  if (!disposed) {
    scene = new RoadScene(canvas, element('mirror'), reportError);
    if (current) scene.update(current, []);
  }
} catch (failure) {
  reportError(`3D view unavailable. Dashboard remains live; use the 2D view for the road. ${failure instanceof Error ? failure.message : ''}`);
}

window.addEventListener('pagehide', () => {
  disposed = true;
  disconnect();
  removePresenter();
  scene?.dispose();
  void audio.dispose().catch((failure: unknown) =>
    reportError(failure instanceof Error ? failure.message : 'Audio cleanup failed.'));
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted) window.location.reload();
});
