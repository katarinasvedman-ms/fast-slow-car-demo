import type { Snapshot } from '../src/types.js';
import { canStart, renderDrive } from './drive.js';

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing element: ${id}`);
  return found;
}

function inputControl(id: string): HTMLInputElement {
  const found = element(id);
  if (!(found instanceof HTMLInputElement)) throw new Error(`Invalid ${id} control.`);
  return found;
}

function hazardControl(): HTMLSelectElement {
  const found = element('hazard');
  if (!(found instanceof HTMLSelectElement)) throw new Error('Invalid hazard control.');
  return found;
}

const speed = inputControl('speed');
const temperature = inputControl('temperature');
const staleness = inputControl('staleness');
const hazard = hazardControl();
const connection = element('connection');
const errorMessage = element('error');
let choosingRun = false;
let latestSnapshot: Snapshot | undefined;

function render(snapshot: Snapshot): void {
  latestSnapshot = snapshot;
  const world = snapshot.world;
  renderDrive(snapshot, choosingRun);
  if (document.activeElement !== speed) speed.value = String(world.selectedSpeedKmh);
  if (document.activeElement !== temperature) temperature.value = String(world.ambientTempC);
  hazard.value = snapshot.hazardVariant ?? '';
  hazard.closest('label')?.toggleAttribute('hidden', snapshot.drive.kind === 'free');
  hazard.disabled = choosingRun || snapshot.started || world.tick !== 0 || snapshot.drive.kind === 'free';
  element('start').toggleAttribute('disabled', choosingRun || !canStart(snapshot));
  element('reset').toggleAttribute('disabled', choosingRun);
  element('speed-value').textContent = `${speed.value} km/h selected`;
  element('actual-speed').textContent = `${world.speedKmh.toFixed(1)} km/h actual`;
  element('car-lane').textContent = world.laneChange
    ? `Car lane ${world.laneChange.fromLane} -> ${world.laneChange.toLane} (${world.laneChange.elapsedTicks}/${world.laneChange.durationTicks} ticks)`
    : `Car lane ${world.carLane}`;
  element('tick').textContent = `Tick ${world.tick}`;
  element('range').textContent = world.hazardActive ? `${world.distanceM.toFixed(0)} m` : 'No active contact';
  element('outcome').textContent = snapshot.drive.kind === 'free' ? `${snapshot.drive.phase} / ${snapshot.drive.phaseRemainingS.toFixed(1)} s`
    : world.outcome + (world.braking && world.outcome === 'running' ? ' / braking' : '');
  element('observation').textContent = snapshot.observation;
  element('observation-stamp').textContent = snapshot.observationTick === null
    ? 'Preview only: no observation sent yet.'
    : `Exact per-tick input captured at tick ${snapshot.observationTick}, before actions or later control edits.` +
      (snapshot.observationTick !== world.tick ? ' No new input was sent this tick.' : '') +
      (snapshot.advice.observedAtTick !== null ? ` Slow reasoning captured tick ${snapshot.advice.observedAtTick}.` : '');
  element('contact-description').textContent = `Thermal / radar: ${snapshot.scene.contactDescription}`;
  element('road-surface').textContent = `ROAD: ${snapshot.scene.roadSurface.toUpperCase()}`;
  element('timing').textContent = `${snapshot.settings.tickMs} ms fixed clock`;
  element('physics').textContent =
    `Braking ${snapshot.settings.brakeDecelMps2} m/s² / acceleration ${snapshot.settings.accelMps2} m/s² / initial range ${snapshot.settings.initialHazardDistanceM} m`;
  element('backend').textContent = snapshot.backend === 'stub' ? 'STUB / recorded / no network' : 'LIVE / Foundry / Entra';
  element('model-name').textContent = snapshot.modelName;
  element('fast-status').textContent = snapshot.fast.status;
  element('fast-stamp').textContent = snapshot.fast.observedAtTick === null ? 'No accepted response yet'
    : `Latest accepted response: tick ${snapshot.fast.observedAtTick}`;
  element('latency').textContent = snapshot.fast.observedAtTick === null ? '-- ms' : `${snapshot.fast.latencyMs.toFixed(0)} ms`;
  element('misses').textContent = String(snapshot.fast.missedDeadlines);
  element('fast-error').textContent = snapshot.fast.error ?? '';
  element('deadline-marker').textContent = snapshot.fast.deadlineTicks.length
    ? `Deadline missed -> default applied. Latest: tick ${snapshot.fast.deadlineTicks[0]}` : 'No missed deadlines';
  element('deadline-marker').className = snapshot.fast.missedDeadlines ? 'refused' : 'muted';
  const threshold = document.querySelector<HTMLInputElement>('#threshold');
  if (!threshold) throw new Error('Missing threshold slider.');
  if (document.activeElement !== threshold) threshold.value = String(snapshot.threshold);
  element('threshold-value').textContent = snapshot.threshold.toFixed(2);
  element('threshold-marker').style.left = `${snapshot.threshold * 100}%`;
  for (const [name, value] of [
    ['damage', snapshot.fast.majorDamageRisk],
    ['clear', snapshot.fast.adjacentLaneClear],
  ] as const) {
    element(`${name}-value`).textContent = value === null ? 'unknown' : value.toFixed(2);
    element(`${name}-fill`).style.width = `${(value ?? 0) * 100}%`;
    const bar = element(`${name}-bar`);
    if (value === null) bar.removeAttribute('aria-valuenow');
    else bar.setAttribute('aria-valuenow', String(value));
    bar.setAttribute('aria-valuetext', value === null ? 'unknown' : value.toFixed(2));
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-mode]')) {
    button.setAttribute('aria-pressed', String(button.dataset.mode === snapshot.mode));
    button.disabled = choosingRun || snapshot.started || world.tick !== 0 || snapshot.drive.phase !== 'idle';
  }
  const advice = snapshot.advice;
  const previousAdvice = advice.data !== null && (advice.status !== 'ready' ||
    (snapshot.drive.kind === 'free' && snapshot.drive.phase !== 'episode'));
  const assessmentLabel = previousAdvice ? 'Previous assessment: ' : '';
  const age = advice.observedAtTick === null ? 0 : world.tick - advice.observedAtTick;
  element('advice-age').textContent = advice.observedAtTick === null ? 'No observation yet'
    : `Current observation age: ${age} ticks / limit ${snapshot.settings.stalenessLimitTicks}`;
  element('advice-age').className = age > snapshot.settings.stalenessLimitTicks
    ? 'refused' : age >= Math.max(0, snapshot.settings.stalenessLimitTicks - 1) ? 'warning' : 'allowed';
  element('slow-model').textContent = snapshot.slowModelName;
  element('advice-title').textContent = advice.status === 'thinking'
    ? `${previousAdvice ? 'Reassessing' : 'Thinking'}... ${age} ticks`
    : advice.status === 'error' ? 'Advice failed'
      : advice.data ? `${advice.data.action.toUpperCase()}${advice.data.targetLane ? ` to lane ${advice.data.targetLane}` : ''}`
        : snapshot.mode === 'fast_only' ? 'Disabled in fast-only mode' : 'Waiting for start';
  element('rationale').textContent = advice.data ? `${assessmentLabel}${advice.data.rationale}` : '';
  element('advice-stamps').textContent = advice.data
    ? `${assessmentLabel}Observed tick ${advice.data.observedAtTick} / arrived tick ${advice.data.arrivedAtTick} / model ${advice.data.latencyMs.toFixed(0)} ms`
    : '';
  element('advice-error').textContent = advice.error ?? '';
  element('advice-application').textContent = advice.application ? `${assessmentLabel}${advice.application}` : '';
  element('advice-reasons').textContent = advice.gate && !advice.gate.allowed
    ? assessmentLabel + advice.gate.reasons.map((reason) => `${reason.reason}: ${reason.detail}`).join(' ') : '';
  const car = element('car');
  const turning = world.laneChange;
  const lanePosition = turning
    ? world.outcome === 'running' ? turning.toLane
      : turning.fromLane + (turning.toLane - turning.fromLane) * turning.elapsedTicks / turning.durationTicks
    : world.carLane;
  car.style.transition = world.tick === 0 || world.outcome !== 'running'
    ? 'none' : `transform ${snapshot.settings.tickMs * 3}ms linear`;
  car.style.transform = `translate(${110 + (lanePosition - 1) * 160}px, 350px)`;
  const takeover = snapshot.log.find((entry) =>
    entry.supersession?.envelope.source === 'slow' && entry.supersession.envelope.action === 'swerve');
  element('supersession-marker').setAttribute('visibility',
    takeover && world.tick - takeover.tick < 3 ? 'visible' : 'hidden');
  element('supersession-marker-label').textContent = takeover ? `#${takeover.tick} SLOW TAKEOVER` : '';
  const scale = Math.min(
    280 / Math.max(snapshot.settings.initialHazardDistanceM, ...snapshot.scene.lanes.map((lane) => lane.clearAheadM ?? 0)),
    55 / Math.max(1, ...snapshot.scene.lanes.map((lane) => lane.vehicleBehindM ?? 0)),
  );
  const roadY = (distanceAheadM: number) => 350 - distanceAheadM * scale;
  element('contact').setAttribute('transform', `translate(${110 + (world.hazardLane - 1) * 160}, ${roadY(world.distanceM)})`);
  element('contact').setAttribute('visibility', world.hazardActive ? 'visible' : 'hidden');
  const contactIdentity = snapshot.drive.kind === 'free' || snapshot.hazardVariant === 'ambiguous' ? world.identity : snapshot.hazardVariant;
  element('contact-label').textContent = contactIdentity === null
    ? '?' : contactIdentity === 'elk' ? 'ELK' : 'SMALL';
  const contactImage = element('contact-image');
  element('contact-unidentified').setAttribute('visibility', contactIdentity === null ? 'visible' : 'hidden');
  contactImage.setAttribute('visibility', contactIdentity === null ? 'hidden' : 'visible');
  if (contactIdentity === null) {
    contactImage.removeAttribute('href');
    contactImage.removeAttribute('aria-label');
  } else {
    const animal = contactIdentity === 'elk' ? 'moose' : 'squirrel';
    contactImage.setAttribute('href', `/images/${animal}.png`);
    contactImage.setAttribute('aria-label', animal === 'moose' ? 'Moose' : 'Squirrel');
  }
  element('contact-distance').textContent = `${Math.round(world.distanceM)} m ahead`;
  for (const lane of snapshot.scene.lanes) {
    const x = 110 + (lane.lane - 1) * 160;
    const blocked = lane.vehicleBehindM !== null;
    const status = element(`lane-${lane.lane}-status`);
    status.textContent = lane.lane === world.carLane
      ? blocked ? 'EGO / BLOCKED' : 'EGO LANE' : blocked ? 'BLOCKED' : 'CLEAR';
    status.setAttribute('fill', blocked ? '#f87171' : lane.lane === world.carLane ? '#dedede' : '#4ade80');
    const vehicle = element(`vehicle-${lane.lane}`);
    vehicle.setAttribute('visibility', blocked ? 'visible' : 'hidden');
    vehicle.setAttribute('transform', `translate(${x}, ${roadY(-(lane.vehicleBehindM ?? 0))})`);
    vehicle.setAttribute('aria-label', `Vehicle in lane ${lane.lane}, ${lane.vehicleBehindM ?? 0} m behind`);
    element(`vehicle-${lane.lane}-distance`).textContent = `${lane.vehicleBehindM ?? 0} m behind`;
    const clearance = element(`lane-${lane.lane}-clearance`);
    clearance.setAttribute('visibility', lane.lane !== world.carLane && !blocked ? 'visible' : 'hidden');
    const top = roadY(lane.clearAheadM ?? 0);
    const zone = element(`lane-${lane.lane}-clear-zone`);
    zone.setAttribute('y', String(top));
    zone.setAttribute('height', String(350 - top));
    const label = element(`lane-${lane.lane}-clear-distance`);
    label.setAttribute('y', String(top - 8));
    label.textContent = `${lane.clearAheadM ?? 0} m clear traffic`;
  }
  element('road-lines').style.strokeDashoffset =
    String(-world.distanceTravelledM * scale);
  element('tick-log').replaceChildren(...snapshot.log.map((entry) => {
    const row = document.createElement('li');
    const probability = (value: number | null) => value === null ? '?' : value.toFixed(2);
    row.className = entry.supersession ? 'supersession' : entry.scenario ? 'scenario' : '';
    row.textContent = entry.supersession ? `#${entry.tick} ${entry.detail}`
      : `#${entry.tick} risk=${probability(entry.majorDamageRisk)} clear=${probability(entry.adjacentLaneClear)} / ${entry.detail}`;
    return row;
  }));
  element('action-status').textContent = snapshot.actionStatus;
  const limit = snapshot.settings.stalenessLimitTicks;
  if (document.activeElement !== staleness) staleness.value = String(limit);
  const seconds = (limit * snapshot.settings.tickMs / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 });
  element('staleness-help').textContent =
    `One tick = ${snapshot.settings.tickMs} ms. ${limit} ticks = ${seconds} seconds of simulation tick time, not an added reasoning delay. ` +
    `Observation age ${limit} is allowed; age ${limit + 1} is stale. Changes affect future gate checks; reset to retry advice already refused.`;
  element('gate-rules').textContent =
    `Refuse age > ${snapshot.settings.stalenessLimitTicks} ticks; independently refuse swerve > ${snapshot.settings.swerveSpeedLimit} km/h.`;
  element('temperature-status').textContent =
    `Outside ${world.ambientTempC} °C / ${snapshot.settings.swerveTier} / active swerve limit ${snapshot.settings.swerveSpeedLimit} km/h.`;
  const records = snapshot.gate.map((record) => {
    const row = document.createElement('li');
    row.className = record.decision.allowed ? 'allowed' : 'refused';
    const title = document.createElement('strong');
    title.textContent =
      `#${record.atTick} ${record.phase}: ${record.envelope.source} ${record.envelope.action} / ${record.decision.allowed ? 'allowed' : 'refused'}` +
      (record.supersedes ? ` / supersedes #${record.supersedes.atTick}` : '');
    row.append(title);
    if (!record.decision.allowed) {
      for (const refusal of record.decision.reasons) {
        const detail = document.createElement('p');
        detail.textContent = `${refusal.reason}: ${refusal.detail}`;
        row.append(detail);
      }
    }
    return row;
  });
  if (records.length === 0) {
    const empty = document.createElement('li');
    empty.textContent = 'No proposals yet. Start the world.';
    records.push(empty);
  }
  element('gate-log').replaceChildren(...records);
}

async function control(command: string, value?: string | number): Promise<boolean> {
  errorMessage.textContent = '';
  try {
    const response = await fetch('/api/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, value }),
    });
    if (!response.ok) {
      const failure: { error?: string } = await response.json();
      throw new Error(failure.error ?? `Control failed: HTTP ${response.status}`);
    }
    // SSE is authoritative so an older HTTP response cannot rewind the scene.
    return true;
  } catch (error) {
    errorMessage.textContent = error instanceof Error ? error.message : 'Control request failed.';
    return false;
  }
}

element('start').addEventListener('click', () => { void control('start'); });
element('reset').addEventListener('click', () => { void control('reset'); });
element('stop').addEventListener('click', () => { void control('stop'); });
async function chooseRun(value: string): Promise<void> {
  choosingRun = true;
  if (latestSnapshot) render(latestSnapshot);
  try {
    if (!await control('reset') || !await control('run', value)) return;
    if (value === 'free') await control('mode', 'async_gated');
  } finally {
    choosingRun = false;
    if (latestSnapshot) render(latestSnapshot);
  }
}
element('free-drive').addEventListener('click', () => { void chooseRun('free'); });
element('run').addEventListener('change', (event) => {
  if (event.target instanceof HTMLSelectElement) void chooseRun(event.target.value);
});
inputControl('duration').addEventListener('change', () => {
  const duration = inputControl('duration');
  if (duration.reportValidity()) void control('duration', duration.valueAsNumber);
});
speed.addEventListener('input', () => {
  element('speed-value').textContent = `${speed.value} km/h selected`;
});
speed.addEventListener('change', () => { void control('speed', Number(speed.value)); });
temperature.addEventListener('change', () => {
  if (temperature.reportValidity()) void control('temperature', temperature.valueAsNumber);
});
hazard.addEventListener('change', () => { void control('hazard', hazard.value); });
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-mode]')) {
  button.addEventListener('click', () => { void control('mode', button.dataset.mode); });
}
element('threshold').addEventListener('change', (event) => {
  if (event.target instanceof HTMLInputElement) void control('threshold', Number(event.target.value));
});
staleness.addEventListener('change', () => {
  if (staleness.reportValidity()) void control('staleness', staleness.valueAsNumber);
});

const events = new EventSource('/api/events');
events.onopen = () => {
  connection.textContent = 'Connected';
  connection.className = 'badge connected';
};
events.onmessage = (event: MessageEvent<string>) => {
  try {
    const snapshot: Snapshot = JSON.parse(event.data);
    render(snapshot);
  } catch {
    errorMessage.textContent = 'Invalid state received from server. Reload to reconnect.';
  }
};
events.onerror = () => {
  connection.textContent = 'Disconnected / reconnecting';
  connection.className = 'badge warning';
};
window.addEventListener('pagehide', () => { events.close(); });
