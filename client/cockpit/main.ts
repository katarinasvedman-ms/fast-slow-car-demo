import { CockpitAudio } from './audio.js';
import { canStart } from '../drive.js';
import { createControls, runCommands, sendControl } from './controls.js';
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

function render(events: Parameters<typeof renderDash>[1] = []): void {
  if (!current) return;
  renderDash(current, events, busy);
}

const run = createControls(sendControl, (value) => {
  busy = value;
  render();
});

function execute(commands: Control[]): void {
  error.textContent = '';
  void run(commands).catch((failure: unknown) => {
    render();
    reportError(failure instanceof Error ? failure.message : 'Control request failed.');
  });
}

function tune(commands: Control[]): void {
  execute(commands);
}

function start(): void {
  if (busy || !current || !canStart(current.snapshot)) return;
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
element('stop').addEventListener('click', () => execute([{ command: 'stop' }]));
select('run').addEventListener('change', () => {
  const value = select('run').value;
  if (value === 'free' || value === 'staged') tune(runCommands(value));
});
element('mute').addEventListener('click', mute);
select('mode').addEventListener('change', () => {
  const value = select('mode').value;
  if (value === 'fast_only' || value === 'blocking' || value === 'async_gated') tune([{ command: 'mode', value }]);
});
for (const [command, ids] of [
  ['speed', ['speed', 'speed-number']],
  ['temperature', ['temperature', 'temperature-number']],
  ['threshold', ['threshold', 'threshold-number']],
  ['staleness', ['staleness', 'staleness-range']],
  ['duration', ['duration']],
] as const) {
  for (const id of ids) {
    const control = input(id);
    control.addEventListener(control.type === 'range' ? 'input' : 'change', () => {
      if (!control.reportValidity()) { render(); return; }
      const precision = command === 'threshold' ? 100 : command === 'temperature' ? 10 : 1;
      const value = Math.round(control.valueAsNumber * precision) / precision;
      if (control.type === 'number') control.blur();
      tune([{ command, value }]);
    });
  }
}

const removePresenter = installPresenter(run, start, mute, () => busy || !current, reportError);
const disconnect = connect((view, events) => {
  current = view;
  render(events);
  scene?.update(view, events);
  audio.update(view, events);
}, (status) => {
  element('connection').textContent = status;
  element('connection').dataset.state = status === 'CONNECTED' ? 'good' : 'warning';
  if (status !== 'CONNECTED') audio.reset();
}, reportError);

try {
  const { RoadScene } = await import('./scene.js');
  const canvas = element('road');
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Missing road canvas.');
  if (!disposed) {
    scene = new RoadScene(canvas, element('mirror'), element('sensor'), reportError);
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
