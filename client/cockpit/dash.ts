import type { CockpitEvent, CockpitView } from './model.js';
import { canStart, renderDrive } from '../drive.js';

export function element(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing cockpit element: ${id}`);
  return node;
}

export function input(id: string): HTMLInputElement {
  const node = element(id);
  if (!(node instanceof HTMLInputElement)) throw new Error(`Invalid cockpit input: ${id}`);
  return node;
}

export function select(id: string): HTMLSelectElement {
  const node = element(id);
  if (!(node instanceof HTMLSelectElement)) throw new Error(`Invalid cockpit select: ${id}`);
  return node;
}

const text = (id: string, value: string) => { element(id).textContent = value; };

function animate(id: string, name: string): void {
  const node = element(id);
  for (const animation of node.getAnimations()) animation.cancel();
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (name === 'flash') {
    node.animate([{ opacity: 1 }, { opacity: 0.3 }, { opacity: 1 }], { duration: 650 });
  } else {
    node.animate([
      { transform: 'translateX(100px)', opacity: 0 },
      { transform: 'translateX(0)', opacity: 1, offset: 0.55 },
      { transform: name === 'refused' ? 'translateX(65px)' : 'translateX(-100px)', opacity: 0 },
    ], { duration: 1000 });
  }
}

export function renderDash(view: CockpitView, events: CockpitEvent[], busy: boolean): void {
  const { snapshot, identity } = view;
  const { world, fast, advice, settings } = snapshot;
  renderDrive(snapshot, busy);
  text('backend', snapshot.backend === 'stub' ? 'STUB / OFFLINE' : 'LIVE / FOUNDRY');
  text('tick', `TICK ${world.tick} / ${settings.tickMs} ms`);
  text('speed-value', world.speedKmh.toFixed(0));
  text('speed-label', !snapshot.started && world.tick === 0 ? 'SELECTED KM/H / IDLE' : 'ACTUAL KM/H');
  text('distance', `${world.distanceM.toFixed(0)} m`);
  text('motion-status', snapshot.drive.phase === 'collision' ? 'COLLISION / PRESS START'
    : snapshot.drive.phase === 'finished' ? 'DRIVE COMPLETE'
    : snapshot.drive.phase === 'dwell' ? `SCENARIO CLEAR IN ${snapshot.drive.phaseRemainingS.toFixed(1)} s`
    : snapshot.drive.phase === 'gap' ? `NEXT CONTACT IN ${snapshot.drive.phaseRemainingS.toFixed(1)} s`
    : !snapshot.started && world.tick === 0 ? 'READY TO START'
    : world.outcome !== 'running' ? world.outcome.toUpperCase()
      : world.laneChange ? `CHANGING TO LANE ${world.laneChange.toLane}` : world.braking ? 'BRAKING' : 'ON COURSE');
  text('surface', `ROAD ${snapshot.scene.roadSurface.toUpperCase()} / LANE ${world.carLane}`);
  const caption = element('caption');
  if (caption.dataset.message) {
    caption.textContent = caption.dataset.message + (!snapshot.started && world.tick === 0 ? ' Press Start.' : '');
  }
  text('contact-description', snapshot.scene.contactDescription);
  element('sensor').hidden = !world.hazardActive;
  text('contact-name', identity === null ? 'THERMAL / RADAR CONTACT'
    : identity === 'elk' ? 'ELK' : 'SMALL ANIMAL');
  element('thermal-contact').hidden = identity !== null;
  element('sensor').classList.toggle('revealed', identity !== null);
  element('thermal-contact').classList.toggle('uncertain', /uncertain|occluded|intermittent/i.test(snapshot.scene.contactDescription));
  element('thermal-contact').style.setProperty('--contact-size',
    `${Math.min(95, 18 + 75 * (1 - world.distanceM / settings.initialHazardDistanceM))}px`);
  const image = element('reveal-image');
  if (!(image instanceof HTMLImageElement)) throw new Error('Invalid reveal image.');
  image.hidden = identity === null;
  if (identity === null) {
    image.onload = null;
    image.removeAttribute('src');
    image.classList.remove('revealing');
  }
  else {
    const source = identity === 'elk' ? '/images/moose-cutout.png' : '/images/squirrel-cutout.png';
    if (image.getAttribute('src') !== source) {
      image.classList.remove('revealing');
      image.onload = () => {
        if (!image.hidden && image.getAttribute('src') === source) image.classList.add('revealing');
      };
      image.src = source;
    }
    image.alt = identity === 'elk' ? 'Revealed elk' : 'Revealed small animal';
    image.style.setProperty('--reveal-size', `${Math.max(72, Math.min(180, 42000 / Math.max(1, world.distanceM)))}px`);
    image.style.setProperty('--reveal-light', String(0.65 + 0.35 * Math.max(0, 1 - world.distanceM / 75)));
  }
  text('identity-note', identity === null
    ? 'Sensor overlay / not headlight visibility'
    : 'Identity at outcome / actual range');
  const mirror = snapshot.scene.lanes.filter((lane) => lane.vehicleBehindM !== null);
  text('mirror-label', mirror.map((lane) => `LANE ${lane.lane} / ${lane.vehicleBehindM} m BEHIND`).join(' | ') || 'NO REAR TRAFFIC');
  text('lane-status', snapshot.scene.lanes.map((lane) =>
    `L${lane.lane}: ${lane.vehicleBehindM !== null ? 'BLOCKED' : `${lane.clearAheadM ?? 0} m CLEAR`}`).join(' / '));
  text('fast-model', snapshot.modelName);
  const risk = fast.majorDamageRisk;
  const completedEpisode = snapshot.drive.kind === 'free' && snapshot.drive.phase !== 'episode' && snapshot.drive.phase !== 'idle';
  text('reflex-title', completedEpisode ? 'REFLEX / LAST' : 'REFLEX');
  text('risk-value', risk === null ? '--' : risk.toFixed(2));
  element('risk-needle').hidden = risk === null;
  const fallback = snapshot.scene.contact && (snapshot.scene.contact.lane === world.carLane ||
    snapshot.scene.contact.lane === world.laneChange?.toLane) ? 'BRAKE' : 'PATH CLEAR';
  text('fast-status', fast.status === 'error' ? `SERVICE ERROR / ${fallback}`
    : fast.status === 'idle' ? 'AWAITING START'
      : risk === null && fast.status === 'ready' ? `NO ANSWER / ${fallback}`
        : fast.status.toUpperCase());
  element('risk-needle').style.transform = `rotate(${-120 + (risk ?? 0) * 240}deg)`;
  element('threshold-notch').style.transform = `rotate(${-120 + snapshot.threshold * 240}deg)`;
  text('threshold-label', `Notch ${snapshot.threshold.toFixed(2)}`);
  text('fast-latency', fast.observedAtTick === null ? '-- ms' : `${fast.latencyMs.toFixed(0)} ms`);
  text('clear-value', fast.adjacentLaneClear === null ? 'LANE CLEAR --' : `LANE CLEAR ${fast.adjacentLaneClear.toFixed(2)}`);
  text('misses', `${fast.missedDeadlines} MISSED`);
  text('deadline', fast.missedDeadlines ? `DEADLINE MISSED / TICK ${fast.deadlineTicks[0]}` : `DEADLINE ${settings.tickBudgetMs} ms`);
  text('fast-stamp', fast.observedAtTick === null ? 'No accepted result' : `Latest accepted: tick ${fast.observedAtTick}`);
  text('model-error', [fast.error, advice.error].filter(Boolean).join(' / '));
  element('fresh-lamp').dataset.state = view.fresh;
  element('permitted-lamp').dataset.state = view.permitted;
  text('fresh-value', view.fresh === 'off' ? '--' : view.fresh === 'bad' ? 'STALE' : 'YES');
  text('permitted-value', view.permitted === 'off' ? '--' : view.permitted === 'bad' ? 'TOO FAST' : 'YES');
  text('gate-verdict', advice.gate ? advice.gate.allowed ? 'ALLOWED' : 'REFUSED' : 'WAITING');
  element('gate-verdict').dataset.state = advice.gate ? advice.gate.allowed ? 'good' : 'bad' : 'off';
  text('gate-history', view.historical && advice.gate ? 'Previous' : '');
  text('gate-reasons', advice.gate && !advice.gate.allowed
    ? advice.gate.reasons.map((item) => item.detail).join(' / ')
    : advice.gate ? 'Both checks passed. Application is evaluated separately.' : 'No slow advice checked yet.');
  text('gate-context', view.historical ? 'PREVIOUS ASSESSMENT / GATE RESULT' : 'LATEST SLOW GATE RESULT');
  text('gate-rule', `AGE > ${settings.stalenessLimitTicks} TICKS / SWERVE > ${settings.swerveSpeedLimit} KM/H`);
  text('temperature-status', `OUTSIDE ${world.ambientTempC} °C / ${settings.swerveTier.toUpperCase()} / LIMIT ${settings.swerveSpeedLimit} KM/H`);
  text('gate-temperature', `${world.ambientTempC} °C / ${settings.swerveTier} / ${settings.swerveSpeedLimit} km/h`);
  text('advice-status', completedEpisode ? 'EPISODE ENDED / NO NEW REQUESTS'
    : snapshot.mode === 'fast_only' ? 'FAST ONLY / ADVISER DISABLED'
    : advice.status === 'thinking' ? `THINKING / ${view.age ?? 0} TICKS`
      : advice.status === 'error' ? 'ADVICE FAILED' : advice.status === 'idle' ? 'AWAITING START' : 'ASSESSMENT RECEIVED');
  element('thinking-ring').classList.toggle('thinking', advice.status === 'thinking');
  text('advice-action', advice.data
    ? `${advice.data.action.toUpperCase()}${advice.data.targetLane ? ` / LANE ${advice.data.targetLane}` : ''}`
    : advice.status === 'thinking' ? 'THINKING' : advice.status === 'error' ? 'ADVICE FAILED' : 'NO ADVICE YET');
  text('advice-history', view.historical ? completedEpisode ? 'Previous episode' : `Previous / ${advice.status}`
    : advice.application?.split(' - ')[0] ?? (advice.data ? 'Recommendation' : snapshot.mode === 'fast_only' ? 'Disabled / fast only' : 'Awaiting advice'));
  const rationale = advice.data?.rationale ?? 'The world keeps moving while reasoning works.';
  text('advice-rationale', rationale.split(/(?<=[.!?])\s/)[0] ?? rationale);
  text('advice-rationale-full', rationale);
  text('advice-stamp', advice.data
    ? `Observed #${advice.data.observedAtTick} / arrived #${advice.data.arrivedAtTick} / ${advice.data.latencyMs.toFixed(0)} ms model latency`
    : snapshot.slowModelName);
  text('freshness-label', view.age === null ? 'NO OBSERVATION YET'
    : `CURRENT OBSERVATION AGE ${view.age} / ${settings.stalenessLimitTicks} TICKS`);
  const freshness = element('freshness');
  freshness.style.width = `${(view.freshness ?? 0) * 100}%`;
  freshness.dataset.state = view.age !== null && view.age > settings.stalenessLimitTicks ? 'bad'
    : (view.freshness ?? 1) <= 0.34 ? 'warning' : 'good';
  text('application', advice.application
    ? `${view.historical ? 'Previous assessment: ' : ''}${advice.application}` : snapshot.actionStatus);
  const takeover = snapshot.log.find((entry) => entry.supersession?.envelope.source === 'slow');
  text('supersession', takeover ? `#${takeover.tick} ${takeover.detail}` : '');
  const turning = world.laneChange;
  element('steering-wheel').style.transform = turning
    ? `rotate(${(turning.toLane - turning.fromLane) * Math.sin(Math.PI * turning.elapsedTicks / turning.durationTicks) * 40}deg)` : 'rotate(0deg)';
  element('cockpit').classList.toggle('braking', world.braking);
  element('outcome-card').hidden = world.outcome === 'running';
  text('outcome-title', world.outcome.toUpperCase());
  text('outcome-detail', snapshot.drive.kind === 'free' ? 'Free-drive scenario lifecycle; see running-time status and scenario log.'
    : world.outcome === 'braked' ? 'Stopped. Pending allowed advice may still revise braking.'
    : 'Physical world frozen. Reset to rehearse again.');
  text('observation', snapshot.observation);
  text('observation-stamp', snapshot.observationTick === null ? 'UNSENT PREVIEW'
    : `EXACT CAPTURED INPUT / TICK ${snapshot.observationTick}`);
  text('tick-log', snapshot.log.slice(0, 12).map((entry) => `#${entry.tick} ${entry.detail}`).join('\n'));
  text('staleness-help', `${settings.stalenessLimitTicks} ticks = ${(settings.stalenessLimitTicks * settings.tickMs / 1000).toFixed(1)} s. Age equal to limit is allowed. Reset to retry refused advice.`);
  const locked = busy || snapshot.started || world.tick !== 0 || snapshot.drive.phase !== 'idle';
  select('mode').disabled = locked;
  select('hazard').disabled = locked || snapshot.drive.kind === 'free';
  select('mode').value = snapshot.mode;
  select('hazard').value = snapshot.hazardVariant ?? '';
  select('hazard').closest('label')?.toggleAttribute('hidden', snapshot.drive.kind === 'free');
  for (const [id, value] of [
    ['speed', world.selectedSpeedKmh], ['temperature', world.ambientTempC],
    ['threshold', snapshot.threshold], ['staleness', settings.stalenessLimitTicks],
  ] as const) {
    const control = input(id);
    if (document.activeElement !== control) control.value = String(value);
    control.disabled = busy;
  }
  element('start').toggleAttribute('disabled', busy || !canStart(snapshot));
  element('reset').toggleAttribute('disabled', busy);
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-preset]')) button.disabled = busy;
  for (const event of events) {
    if (event.type === 'reset') {
      for (const id of ['envelope', 'deadline', 'collision-flash']) {
        for (const animation of element(id).getAnimations()) animation.cancel();
      }
      text('delivery', 'NO ADVICE DELIVERY YET');
    } else if (event.type === 'deadline') animate('deadline', 'flash');
    else if (event.type === 'gate') {
      const refused = !event.record.decision.allowed;
      text('delivery', `${event.record.phase.toUpperCase()} / ${refused ? 'REFUSED' : 'ALLOWED'} / TICK ${event.record.atTick}`);
      animate('envelope', refused ? 'refused' : 'allowed');
    } else if (event.type === 'outcome' && event.outcome === 'collision' &&
        !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      element('collision-flash').animate([{ opacity: 0.8 }, { opacity: 0 }], { duration: 350 });
    }
  }
}
