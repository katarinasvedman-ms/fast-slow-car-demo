import type { Snapshot } from '../src/types.js';

function element(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing driving element: ${id}`);
  return node;
}

export function canStart(snapshot: Snapshot): boolean {
  return !snapshot.started && snapshot.drive.phase !== 'finished' &&
    (snapshot.world.outcome === 'running' || (snapshot.drive.kind === 'free' && snapshot.drive.phase === 'collision'));
}

export function renderDrive(snapshot: Snapshot, busy = false): void {
  const { drive, world } = snapshot;
  const run = element('run');
  const duration = element('duration');
  if (!(run instanceof HTMLSelectElement) || !(duration instanceof HTMLInputElement)) {
    throw new Error('Invalid driving controls.');
  }
  run.value = drive.kind;
  run.disabled = busy || snapshot.started || world.tick !== 0 || drive.phase !== 'idle';
  const continuousOption = run.querySelector<HTMLOptionElement>('option[value=free]');
  if (!continuousOption) throw new Error('Missing continuous-driving option.');
  continuousOption.disabled = snapshot.backend === 'stub';
  if (document.activeElement !== duration) duration.value = String(drive.durationS);
  duration.disabled = busy;
  element('drive-availability').textContent = snapshot.backend === 'stub'
    ? 'Continuous rear threats require live mode. STUB supports the four staged moments only; its single slow recording does not fit other scenes.'
    : `Continuous rear threats: hazards appear ${snapshot.settings.initialHazardDistanceM} m ahead. The same following car remains between encounters; it can pass or fall behind, not teleport back. Recover to selected speed before the next hazard. ` +
      'Duration 0 runs until Stop. Paid live models run only during contacts (one slow request per episode). Any impact pauses the run; Start resumes from rest.';
  element('stop').hidden = drive.kind !== 'free';
  element('stop').toggleAttribute('disabled', busy || drive.phase === 'idle' || drive.phase === 'finished');
  const modes = { fast_only: 'Fast only', blocking: 'Blocking', async_gated: 'Async + gated' };
  element('drive-status').textContent = drive.kind === 'staged' ? `STAGED / ${modes[snapshot.mode]}`
    : `CONTINUOUS / episode ${drive.episodeId ?? '-'} / ` +
      (drive.durationS === 0 ? `${drive.elapsedS.toFixed(1)} s / until Stop` : `${Math.max(0, drive.durationS - drive.elapsedS).toFixed(1)} s left`) +
      (drive.phase === 'collision' ? ' / COLLISION PAUSED: Start to resume' : '');
  const scoreboard = element('drive-scoreboard');
  scoreboard.hidden = drive.phase !== 'finished';
  element('drive-summary').textContent = `${drive.finishReason === 'duration' ? 'Duration reached' : 'Stopped by presenter'} / ${drive.elapsedS.toFixed(1)} s running time / seed ${drive.seed}`;
  if (!scoreboard.hidden) {
    const score = drive.score;
    const rows: [string, number][] = [
      ['Hazards faced', score.hazardsFaced], ['Avoided by braking', score.avoidedByBraking],
      ['Avoided by swerving', score.avoidedBySwerving], ['Collisions', score.collisions],
      ['Slow advice allowed', score.slowAllowed], ['Slow advice refused', score.slowRefused],
      ['Refused: stale advice', score.staleAdvice], ['Refused: too fast', score.prohibitedAction],
      ['Deadline misses', score.deadlineMisses],
    ];
    element('drive-score').replaceChildren(...rows.map(([label, value]) => {
      const row = document.createElement('div');
      const term = document.createElement('dt');
      const count = document.createElement('dd');
      term.textContent = label;
      count.textContent = String(value);
      row.append(term, count);
      return row;
    }));
  }
}
