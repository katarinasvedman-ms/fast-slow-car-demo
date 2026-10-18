import { CockpitAudio } from './audio.js';
import { canStart } from '../drive.js';
import { createControls, scenarios, scenarioFor, scenarioCommands, ScenarioSelection, sendControl } from './controls.js';
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
let choosingScenario = false;
const selection = new ScenarioSelection();
const scenarioSelect = select('scenario');
scenarioSelect.replaceChildren(...scenarios.map((scenario) => {
  const option = document.createElement('option');
  option.value = scenario.id;
  option.textContent = scenario.name;
  return option;
}));

function render(events: Parameters<typeof renderDash>[1] = []): void {
  if (!current) return;
  renderDash(current, events, busy, choosingScenario);
  const scenario = scenarioFor(selection.update(current.snapshot));
  scenarioSelect.value = scenario.id;
  scenarioSelect.disabled = busy;
  element('scenario-watch').textContent = `What to watch: ${scenario.watch}`;
  element('scenario-caption').textContent = scenario.name;
  element('caption').textContent = `${scenario.name}: ${scenario.watch}`;
}

const run = createControls(sendControl, (value) => {
  busy = value;
  render();
});

function execute(commands: Control[]): void {
  error.textContent = '';
  void run(commands).catch((failure: unknown) => {
    selection.custom();
    render();
    reportError(failure instanceof Error ? failure.message : 'Control request failed.');
  });
}

scenarioSelect.addEventListener('change', () => {
  const scenario = scenarioFor(scenarioSelect.value);
  selection.choose(scenario.id);
  if (scenario.id === 'custom') { render(); return; }
  choosingScenario = true;
  render();
  error.textContent = '';
  void run(scenarioCommands(scenario.id)).catch((failure: unknown) => {
    selection.custom();
    reportError(failure instanceof Error ? failure.message : 'Scenario controls failed.');
  }).finally(() => { choosingScenario = false; render(); });
});

function tune(commands: Control[]): void {
  selection.custom();
  render();
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
element('free-drive').addEventListener('click', () => tune([
  { command: 'reset' }, { command: 'run', value: 'free' }, { command: 'mode', value: 'async_gated' },
]));
select('run').addEventListener('change', () => {
  const value = select('run').value;
  if (value === 'free' || value === 'staged') tune([
    { command: 'reset' }, { command: 'run', value },
    ...(value === 'free' ? [{ command: 'mode', value: 'async_gated' } as const] : []),
  ]);
});
element('mute').addEventListener('click', mute);
select('mode').addEventListener('change', () => {
  const value = select('mode').value;
  if (value === 'fast_only' || value === 'blocking' || value === 'async_gated') tune([{ command: 'mode', value }]);
});
select('hazard').addEventListener('change', () => {
  const value = select('hazard').value;
  if (value === 'elk' || value === 'small_animal' || value === 'ambiguous') tune([{ command: 'hazard', value }]);
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
