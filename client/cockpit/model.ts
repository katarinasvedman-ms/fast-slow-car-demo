import type { GateDecision, GateRecord, Snapshot } from '../../src/types.js';

export interface CockpitView {
  snapshot: Snapshot;
  age: number | null;
  freshness: number | null;
  lane: number;
  travelledM: number;
  identity: Snapshot['world']['identity'];
  fresh: 'off' | 'good' | 'bad';
  permitted: 'off' | 'good' | 'bad';
  historical: boolean;
}

export type CockpitEvent =
  | { type: 'reset' }
  | { type: 'tick' }
  | { type: 'deadline' }
  | { type: 'gate'; record: GateRecord }
  | { type: 'outcome'; outcome: Snapshot['world']['outcome'] };

export function mapSnapshot(snapshot: Snapshot): CockpitView {
  const { world, advice, settings } = snapshot;
  const age = advice.observedAtTick === null ? null : Math.max(0, world.tick - advice.observedAtTick);
  const decision = advice.gate;
  const refused = (reason: 'stale_advice' | 'prohibited_action') =>
    decision !== null && !decision.allowed && decision.reasons.some((item) => item.reason === reason);
  const turning = world.laneChange;
  return {
    snapshot,
    age,
    freshness: age === null ? null : settings.stalenessLimitTicks === 0
      ? age === 0 ? 1 : 0
      : Math.max(0, 1 - age / settings.stalenessLimitTicks),
    lane: turning
      ? turning.fromLane + (turning.toLane - turning.fromLane) * turning.elapsedTicks / turning.durationTicks
      : world.carLane,
    travelledM: world.distanceTravelledM,
    identity: world.identity,
    fresh: decision === null ? 'off' : refused('stale_advice') ? 'bad' : 'good',
    permitted: decision === null ? 'off' : refused('prohibited_action') ? 'bad' : 'good',
    historical: advice.data !== null && (advice.status !== 'ready' ||
      (snapshot.drive.kind === 'free' && snapshot.drive.phase !== 'episode')),
  };
}

const recordKey = (record: GateRecord) =>
  `${record.atTick}:${record.phase}:${record.envelope.source}:${record.envelope.observedAtTick}:${record.envelope.action}:${JSON.stringify(record.decision)}`;

export class EventTracker {
  private previous: Snapshot | undefined;
  private gates = new Set<string>();

  update(snapshot: Snapshot): CockpitEvent[] {
    const previous = this.previous;
    const events: CockpitEvent[] = [];
    const reset = previous !== undefined && (
      snapshot.world.tick < previous.world.tick ||
      (!snapshot.started && snapshot.world.tick === 0 && previous.started) ||
      (snapshot.fast.missedDeadlines < previous.fast.missedDeadlines)
    );
    if (reset) {
      this.gates.clear();
      events.push({ type: 'reset' });
    }
    // An initial/reconnected snapshot is history, not a burst of new sound/animation.
    if (previous && !reset) {
      if (snapshot.world.tick > previous.world.tick) events.push({ type: 'tick' });
      if (snapshot.fast.missedDeadlines > previous.fast.missedDeadlines) events.push({ type: 'deadline' });
      for (const record of [...snapshot.gate].reverse()) {
        if (record.envelope.source === 'slow' && !this.gates.has(recordKey(record))) {
          events.push({ type: 'gate', record });
        }
      }
      if (snapshot.world.outcome !== previous.world.outcome && snapshot.world.outcome !== 'running') {
        events.push({ type: 'outcome', outcome: snapshot.world.outcome });
      }
    }
    this.gates = new Set(snapshot.gate.map(recordKey));
    this.previous = snapshot;
    return events;
  }

  reconnect(): void {
    this.previous = undefined;
    this.gates.clear();
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function nullableNumber(value: unknown): boolean {
  return value === null || finite(value);
}

function lane(value: unknown): boolean {
  return value === 1 || value === 2 || value === 3;
}

function episodeId(value: unknown): boolean {
  return finite(value) && Number.isSafeInteger(value) && value > 0;
}

function decision(value: unknown): value is GateDecision {
  return object(value) && (value.allowed === true || (value.allowed === false &&
    Array.isArray(value.reasons) && value.reasons.length > 0 && value.reasons.every((item: unknown) =>
      object(item) && ['stale_advice', 'prohibited_action'].includes(String(item.reason)) &&
      typeof item.detail === 'string')));
}

function envelope(value: unknown): boolean {
  return object(value) && ['brake', 'continue', 'swerve'].includes(String(value.action)) &&
    ['fast', 'slow'].includes(String(value.source)) && lane(value.fromLane) &&
    (value.episodeId === undefined || episodeId(value.episodeId)) &&
    (value.toLane === undefined || lane(value.toLane)) &&
    ['speedKmh', 'observedAtTick', 'proposedAtTick'].every((key) => finite(value[key]));
}

function applied(value: unknown): boolean {
  return object(value) && finite(value.atTick) && envelope(value.envelope);
}

export function parseSnapshot(text: string): Snapshot {
  const value: unknown = JSON.parse(text);
  if (!validSnapshot(value)) throw new Error('Invalid cockpit state received. Reload to reconnect.');
  return value;
}

function validSnapshot(value: unknown): value is Snapshot {
  if (!object(value) || !object(value.world) || !object(value.settings) || !object(value.fast) ||
      !object(value.advice) || !object(value.scene) || !object(value.drive)) return false;
  const { world, settings, fast, advice, scene, drive } = value;
  const change = world.laneChange;
  const data = advice.data;
  const score = drive.score;
  return ['live', 'stub'].includes(String(value.backend)) &&
    ['fast_only', 'blocking', 'async_gated'].includes(String(value.mode)) &&
    (value.hazardVariant === null || ['elk', 'small_animal', 'ambiguous'].includes(String(value.hazardVariant))) &&
    typeof value.started === 'boolean' && finite(value.threshold) &&
    ['modelName', 'slowModelName', 'observation', 'actionStatus'].every((key) => typeof value[key] === 'string') &&
    nullableNumber(value.observationTick) &&
    ['tick', 'speedKmh', 'selectedSpeedKmh', 'ambientTempC', 'distanceM', 'distanceTravelledM'].every((key) => finite(world[key])) &&
    typeof world.hazardActive === 'boolean' &&
    lane(world.carLane) && lane(world.hazardLane) && typeof world.braking === 'boolean' &&
    ['running', 'braked', 'swerved', 'continued', 'collision'].includes(String(world.outcome)) &&
    (world.identity === null || ['elk', 'small_animal'].includes(String(world.identity))) &&
    (change === null || (object(change) && lane(change.fromLane) && lane(change.toLane) &&
      finite(change.elapsedTicks) && finite(change.durationTicks) && change.durationTicks > 0 &&
      finite(change.startedAtTick))) &&
    ['tickMs', 'tickBudgetMs', 'initialHazardDistanceM', 'brakeDecelMps2', 'accelMps2', 'stalenessLimitTicks', 'swerveSpeedLimit']
      .every((key) => finite(settings[key])) &&
    finite(settings.tickMs) && settings.tickMs > 0 &&
    finite(settings.stalenessLimitTicks) && settings.stalenessLimitTicks >= 0 &&
    ['normal grip', 'frost risk', 'ice risk'].includes(String(settings.swerveTier)) &&
    ['idle', 'pending', 'ready', 'deadline', 'error'].includes(String(fast.status)) &&
    ['majorDamageRisk', 'adjacentLaneClear', 'observedAtTick'].every((key) => nullableNumber(fast[key])) &&
    finite(fast.latencyMs) && finite(fast.missedDeadlines) &&
    (fast.error === null || typeof fast.error === 'string') &&
    Array.isArray(fast.deadlineTicks) && fast.deadlineTicks.every(finite) &&
    ['idle', 'thinking', 'ready', 'error'].includes(String(advice.status)) &&
    nullableNumber(advice.observedAtTick) && (advice.gate === null || decision(advice.gate)) &&
    (advice.application === null || typeof advice.application === 'string') &&
    (advice.error === null || typeof advice.error === 'string') &&
    (data === null || (object(data) && ['swerve', 'brake', 'continue'].includes(String(data.action)) &&
      (data.targetLane === undefined || lane(data.targetLane)) && typeof data.rationale === 'string' &&
      (data.episodeId === undefined || episodeId(data.episodeId)) &&
      ['observedAtTick', 'arrivedAtTick', 'latencyMs'].every((key) => finite(data[key])))) &&
    (scene.contact === null || (object(scene.contact) && lane(scene.contact.lane) && finite(scene.contact.rangeM))) &&
    typeof scene.contactDescription === 'string' && scene.roadSurface === 'dry' &&
    ['staged', 'free'].includes(String(drive.kind)) &&
    ['idle', 'episode', 'dwell', 'gap', 'collision', 'finished'].includes(String(drive.phase)) &&
    (drive.episodeId === null || episodeId(drive.episodeId)) &&
    (drive.finishReason === null || ['duration', 'stopped'].includes(String(drive.finishReason))) &&
    ['seed', 'durationS', 'elapsedS', 'phaseRemainingS'].every((key) => finite(drive[key])) &&
    object(score) && ['hazardsFaced', 'avoidedByBraking', 'avoidedBySwerving', 'slowAllowed', 'slowRefused',
      'staleAdvice', 'prohibitedAction', 'collisions', 'deadlineMisses'].every((key) => finite(score[key])) &&
    Array.isArray(scene.lanes) && scene.lanes.length === 3 && scene.lanes.every((item: unknown) =>
      object(item) && lane(item.lane) && nullableNumber(item.vehicleBehindM) && nullableNumber(item.clearAheadM)) &&
    Array.isArray(value.gate) && value.gate.every((record: unknown) =>
      object(record) && finite(record.atTick) && ['proposal', 'application'].includes(String(record.phase)) &&
      envelope(record.envelope) && decision(record.decision) &&
      (record.supersedes === undefined || applied(record.supersedes))) &&
    Array.isArray(value.log) && value.log.every((entry: unknown) =>
      object(entry) && finite(entry.tick) && typeof entry.detail === 'string' &&
      nullableNumber(entry.majorDamageRisk) && nullableNumber(entry.adjacentLaneClear) &&
      typeof entry.deadlineMissed === 'boolean' &&
      (entry.scenario === undefined || (object(entry.scenario) &&
        (entry.scenario.episodeId === null || episodeId(entry.scenario.episodeId)) &&
        ['spawn', 'stopped', 'clear', 'passed', 'collision', 'resume', 'finished'].includes(String(entry.scenario.event)))) &&
      (entry.supersession === undefined || (object(entry.supersession) &&
        applied(entry.supersession.previous) && envelope(entry.supersession.envelope))));
}
