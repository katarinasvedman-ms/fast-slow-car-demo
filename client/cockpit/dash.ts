import type { CockpitEvent, CockpitView } from './model.js';
import { canStart, renderDrive } from '../drive.js';
import { freshnessPositions } from './model.js';

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
      { transform: 'translateX(-12px)', opacity: 0 },
      { transform: name === 'refused' ? 'translateX(130px)' : 'translateX(145px)', opacity: 1, offset: 0.5 },
      { transform: name === 'refused' ? 'translateX(112px) rotate(-12deg)' : 'translateX(190px)', opacity: 1, offset: 0.7 },
      { transform: name === 'refused' ? 'translateX(-12px) rotate(8deg)' : 'translateX(205px)', opacity: 0 },
    ], { duration: 1400 });
    const delivery = element('gate-delivery');
    for (const animation of delivery.getAnimations()) animation.cancel();
    delivery.dataset.state = name === 'refused' ? 'bad' : 'good';
    delivery.setAttribute('aria-label', `Advice ${name} by the deterministic gate`);
    delivery.animate([{ opacity: 0 }, { opacity: 1, offset: 0.12 }, { opacity: 1, offset: 0.85 }, { opacity: 0 }], { duration: 1400 });
  }
}

export function renderDash(view: CockpitView, events: CockpitEvent[], busy: boolean, tuningLocked = false): void {
  const { snapshot, identity } = view;
  const { world, fast, advice, settings } = snapshot;
  renderDrive(snapshot, busy);
  text('backend', snapshot.backend === 'stub' ? 'STUB / OFFLINE' : 'LIVE / FOUNDRY');
  text('tick', `TICK ${world.tick} / ${settings.tickMs} ms`);
  text('speed-value', world.speedKmh.toFixed(0));
  text('speed-label', 'KM/H');
  element('speed-value').setAttribute('aria-label', `Actual speed ${world.speedKmh.toFixed(1)} km/h`);
  text('selected-speed', `SET ${world.selectedSpeedKmh}`);
  element('selected-speed-marker').style.left = `${(world.selectedSpeedKmh - 50) / 80 * 100}%`;
  element('selected-speed-track').setAttribute('aria-label', `Selected speed ${world.selectedSpeedKmh} km/h; scale 50 to 130`);
  text('distance', snapshot.scene.contact ? `${snapshot.scene.contact.rangeM.toFixed(0)} m` : '-- m');
  text('motion-status', snapshot.drive.phase === 'collision' ? 'COLLISION / PRESS START'
    : snapshot.drive.phase === 'finished' ? 'DRIVE COMPLETE'
    : snapshot.drive.phase === 'dwell' ? `SCENARIO CLEAR IN ${snapshot.drive.phaseRemainingS.toFixed(1)} s`
    : snapshot.drive.phase === 'gap' ? `NEXT CONTACT IN ${snapshot.drive.phaseRemainingS.toFixed(1)} s`
    : !snapshot.started && world.tick === 0 ? 'READY TO START'
    : world.outcome !== 'running' ? world.outcome.toUpperCase()
      : world.laneChange ? `CHANGING TO LANE ${world.laneChange.toLane}` : world.braking ? 'BRAKING' : 'ON COURSE');
  text('surface', `ROAD ${snapshot.scene.roadSurface.toUpperCase()} / LANE ${world.carLane}`);
  text('contact-description', snapshot.scene.contactDescription);
  element('sensor').hidden = snapshot.scene.contact === null || !world.hazardActive || world.outcome === 'collision';
  text('contact-name', identity === null ? 'THERMAL / RADAR CONTACT'
    : identity === 'elk' ? 'ELK' : 'SMALL ANIMAL');
  element('thermal-contact').hidden = identity !== null;
  element('sensor').classList.toggle('revealed', identity !== null);
  element('thermal-contact').classList.toggle('uncertain', /uncertain|occluded|intermittent/i.test(snapshot.scene.contactDescription));
  const image = element('impact-image');
  if (!(image instanceof HTMLImageElement)) throw new Error('Invalid impact image.');
  const impact = events.some((event) => event.type === 'outcome' && event.outcome === 'collision');
  image.hidden = identity === null || world.outcome !== 'collision';
  if (image.hidden) {
    image.onload = null;
    image.removeAttribute('src');
    image.classList.remove('impact-active');
  }
  else {
    const source = identity === 'elk' ? '/images/moose-cutout.png' : '/images/squirrel-cutout.png';
    if (image.getAttribute('src') !== source) {
      image.classList.remove('impact-active');
      image.onload = () => {
        if (impact && !image.hidden && image.getAttribute('src') === source) image.classList.add('impact-active');
      };
      image.src = source;
    }
    image.alt = identity === 'elk' ? 'Elk at collision' : 'Small animal at collision';
  }
  text('identity-note', identity === null
    ? 'Sensor overlay / not headlight visibility'
    : 'Identity at outcome / actual range');
  element('collision-overlay').hidden = world.outcome !== 'collision';
  text('collision-detail', `${world.distanceM.toFixed(0)} m / ${snapshot.drive.kind === 'free' && snapshot.drive.phase === 'collision'
    ? 'Press Start to resume' : 'Reset to replay'}`);
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
  text('fresh-value', view.fresh === 'off' ? '--' : view.fresh === 'bad' ? 'NO' : 'YES');
  text('permitted-value', view.permitted === 'off' ? '--' : view.permitted === 'bad' ? 'NO' : 'YES');
  text('gate-verdict', advice.gate ? advice.gate.allowed ? 'ALLOWED' : 'REFUSED' : 'WAITING');
  element('gate-verdict').dataset.state = advice.gate ? advice.gate.allowed ? 'good' : 'bad' : 'off';
  text('gate-history', view.historical && advice.gate ? 'Previous' : '');
  text('gate-reasons', advice.gate && !advice.gate.allowed
    ? advice.gate.reasons.map((item) => item.detail).join(' / ')
    : advice.gate ? 'Both checks passed. Application is evaluated separately.' : 'No slow advice checked yet.');
  element('gate-reasons-visible').replaceChildren(...(advice.gate && !advice.gate.allowed
    ? advice.gate.reasons.map((reason) => {
      const line = document.createElement('div');
      line.textContent = reason.detail;
      return line;
    }) : []));
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
    : advice.status === 'thinking' ? 'THINKING' : advice.status === 'error' ? 'FAILED' : 'NO ADVICE');
  text('advice-action-full', advice.data
    ? `${advice.data.action.toUpperCase()}${advice.data.targetLane ? ` / LANE ${advice.data.targetLane}` : ''}`
    : 'No recommendation received.');
  text('advice-history', view.historical ? completedEpisode ? 'Previous episode' : `Previous / ${advice.status}`
    : advice.application?.split(' - ')[0] ?? (advice.data ? 'Recommendation' : snapshot.mode === 'fast_only' ? 'Disabled / fast only' : 'Awaiting advice'));
  const rationale = advice.data?.rationale ?? 'The world keeps moving while reasoning works.';
  text('advice-rationale', rationale);
  text('advice-rationale-full', rationale);
  text('advice-stamp', advice.data
    ? `Observed #${advice.data.observedAtTick} / arrived #${advice.data.arrivedAtTick} / ${advice.data.latencyMs.toFixed(0)} ms model latency`
    : snapshot.slowModelName);
  text('freshness-label', view.age === null ? 'NO OBSERVATION YET'
    : `CURRENT OBSERVATION AGE ${view.age} / ${settings.stalenessLimitTicks} TICKS`);
  text('advice-stamp-visible', element('advice-stamp').textContent ?? '');
  text('freshness-label-visible', element('freshness-label').textContent ?? '');
  const freshness = element('freshness');
  const positions = freshnessPositions(view.age, settings.stalenessLimitTicks);
  freshness.style.width = `${positions.agePercent}%`;
  freshness.hidden = view.age === null;
  element('freshness-limit').style.left = `${positions.limitPercent}%`;
  element('freshness-track').setAttribute('aria-label',
    `${view.age === null ? 'No observation yet' : `Observation age ${view.age} ticks`}; limit ${settings.stalenessLimitTicks} ticks; scale 0 to ${positions.axisMax} ticks`);
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
  const resetRequired = snapshot.started || world.tick !== 0 || snapshot.drive.phase !== 'idle';
  const locked = busy || resetRequired;
  select('mode').disabled = locked;
  select('hazard').disabled = locked || snapshot.drive.kind === 'free';
  select('mode').value = snapshot.mode;
  select('hazard').value = snapshot.hazardVariant ?? '';
  select('hazard').closest('label')?.toggleAttribute('hidden', snapshot.drive.kind === 'free');
  element('reset-help').hidden = !resetRequired;
  text('temperature-help', `${settings.swerveTier} / ${settings.swerveSpeedLimit} km/h`);
  text('staleness-help', `${settings.stalenessLimitTicks} ticks = ${(settings.stalenessLimitTicks * settings.tickMs / 1000).toFixed(1)} s`);
  for (const [id, value] of [
    ['speed', world.selectedSpeedKmh], ['speed-number', world.selectedSpeedKmh],
    ['temperature', world.ambientTempC], ['temperature-number', world.ambientTempC],
    ['threshold', snapshot.threshold], ['threshold-number', snapshot.threshold],
    ['staleness', settings.stalenessLimitTicks], ['staleness-range', settings.stalenessLimitTicks],
  ] as const) {
    const control = input(id);
    control.value = String(value);
    control.disabled = tuningLocked;
  }
  element('start').toggleAttribute('disabled', busy || !canStart(snapshot));
  element('reset').toggleAttribute('disabled', busy);
  for (const event of events) {
    if (event.type === 'reset') {
      for (const id of ['envelope', 'gate-delivery', 'deadline', 'collision-flash']) {
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
