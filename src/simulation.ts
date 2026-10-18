import type { Config } from './config.js';
import { buildObservation, observeScene, senseContact } from './observation.js';
import { emptyDrive, nextHazard } from './drive.js';
import { evaluateGate } from './gate.js';
import { fastAction, hazardInPath, swerveSpeedLimitFor, swerveTierFor } from './policy.js';
import type { ModelServices } from './models/live.js';
import type {
  ActionEnvelope, AppliedAction, GateDecision, GateRecord, HazardVariant, Mode,
  DriveView, RunKind, SlowResult, Snapshot, TickEntry, WorldState,
} from './types.js';
import { advanceWorld, applyAction, createWorld, publicWorld, setWorldSpeed } from './world.js';

interface FastFlight {
  generation: number;
  episodeId: number | null;
  tick: number;
  began: number;
  entry: TickEntry;
  controller: AbortController;
  deadline: ReturnType<typeof setTimeout>;
  expired: boolean;
  suppressed: boolean;
}

export class Simulation {
  private world: WorldState;
  private hazardVariant: HazardVariant = 'elk';
  private mode: Mode = 'async_gated';
  private threshold = 0.35;
  private stalenessLimitTicks: number;
  private timer: ReturnType<typeof setInterval> | undefined;
  private listeners = new Set<(snapshot: Snapshot) => void>();
  private log: TickEntry[] = [];
  private gate: GateRecord[] = [];
  private actionStatus = 'No action proposed.';
  private appliedAction: AppliedAction | null = null;
  private capturedObservation: { tick: number; text: string } | null = null;
  private generation = 0;
  private fastFlights = new Set<FastFlight>();
  private fast: Snapshot['fast'] = this.emptyFast();
  private advice: Snapshot['advice'] = this.emptyAdvice();
  private slowFlight: { controller: AbortController; timeout: ReturnType<typeof setTimeout> } | undefined;
  private delayedStubAdvice: { observedAtTick: number; result: SlowResult } | undefined;
  private queuedSlow: { envelope: ActionEnvelope; proposed: GateDecision } | undefined;
  private drive: DriveView;
  private sequenceSeed: number;
  private phaseUntilTick = 0;
  private driveTicks = 0;
  private slowEpisodeId: number | null = null;

  constructor(
    private readonly config: Config,
    private readonly models: ModelServices,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.world = createWorld(config);
    this.stalenessLimitTicks = config.stalenessLimitTicks;
    this.drive = emptyDrive(config.driveSeed, config.driveDurationS);
    this.sequenceSeed = config.driveSeed;
  }

  snapshot(): Snapshot {
    return {
      backend: this.config.stub ? 'stub' : 'live',
      modelName: this.models.fast.name,
      slowModelName: this.models.slow.name,
      mode: this.mode,
      threshold: this.threshold,
      started: this.timer !== undefined,
      drive: {
        ...structuredClone(this.drive),
        phaseRemainingS: this.drive.phase === 'gap' || this.drive.phase === 'dwell'
          ? Math.max(0, this.phaseUntilTick - this.world.tick) * this.config.tickMs / 1000 : 0,
      },
      world: publicWorld(this.world),
      hazardVariant: this.drive.kind === 'free' ? null : this.hazardVariant,
      observation: this.capturedObservation?.text ?? buildObservation(this.world, this.hazardVariant),
      observationTick: this.capturedObservation?.tick ?? null,
      scene: observeScene(this.world, this.hazardVariant),
      settings: {
        tickMs: this.config.tickMs,
        tickBudgetMs: this.config.tickBudgetMs,
        initialHazardDistanceM: this.config.initialHazardDistanceM,
        brakeDecelMps2: this.config.brakeDecelMps2,
        accelMps2: this.config.accelMps2,
        stalenessLimitTicks: this.stalenessLimitTicks,
        swerveSpeedLimit: swerveSpeedLimitFor(this.world.ambientTempC, this.config),
        swerveTier: swerveTierFor(this.world.ambientTempC, this.config),
      },
      log: structuredClone(this.log),
      gate: structuredClone(this.gate),
      actionStatus: this.actionStatus,
      fast: structuredClone(this.fast),
      advice: structuredClone(this.advice),
    };
  }

  subscribe(listener: (snapshot: Snapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(): void {
    if (this.timer !== undefined) return;
    if (this.drive.kind === 'free') {
      if (this.drive.phase === 'finished') return;
      if (this.drive.phase === 'collision') {
        this.world = { ...this.world, speedKmh: 0, braking: false, laneChange: null, outcome: 'running', hazardActive: false };
        this.scenario('resume', 'Collision recovery: Start resumes from rest; contact cleared by scenario.');
        this.waitFor('gap', this.config.driveGapS);
      } else if (this.drive.phase === 'idle') this.spawnEpisode();
    } else if (this.world.outcome !== 'running') return;
    const timer = setInterval(() => {
      if (this.timer === timer) this.advance();
    }, this.config.tickMs);
    this.timer = timer;
    if (this.drive.kind === 'staged' || this.drive.phase === 'episode') this.beginTick();
    this.publish();
  }

  reset(): void {
    this.stop();
    this.cancelRequests();
    this.models.reset?.();
    this.world = createWorld(this.config, this.world.selectedSpeedKmh, this.hazardVariant, this.world.ambientTempC);
    this.log = [];
    this.gate = [];
    this.fast = this.emptyFast();
    this.advice = this.emptyAdvice();
    this.actionStatus = 'No action proposed.';
    this.appliedAction = null;
    this.capturedObservation = null;
    this.drive = emptyDrive(this.config.driveSeed, this.drive.durationS, this.drive.kind);
    this.sequenceSeed = this.config.driveSeed;
    this.driveTicks = 0;
    this.phaseUntilTick = 0;
    this.slowEpisodeId = null;
    this.publish();
  }

  setSpeed(speedKmh: number): void {
    if (!Number.isFinite(speedKmh) || speedKmh < 50 || speedKmh > 130) {
      throw new Error('Speed must be between 50 and 130 km/h.');
    }
    this.world = setWorldSpeed(this.world, speedKmh);
    if (this.world.tick === 0 && this.timer === undefined) this.world.speedKmh = speedKmh;
    this.publish();
  }

  setThreshold(threshold: number): void {
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new Error('Threshold must be between 0 and 1.');
    this.threshold = threshold;
    this.publish();
  }

  setTemperature(ambientTempC: number): void {
    if (!Number.isFinite(ambientTempC) || ambientTempC < -20 || ambientTempC > 30) {
      throw new Error('Temperature must be between -20 and 30 °C.');
    }
    this.world = { ...this.world, ambientTempC };
    this.publish();
  }

  setStalenessLimit(ticks: number): void {
    if (!Number.isInteger(ticks) || ticks < 0 || ticks > 1000) {
      throw new Error('Staleness limit must be an integer between 0 and 1000 ticks.');
    }
    this.stalenessLimitTicks = ticks;
    this.publish();
  }

  setMode(mode: Mode): void {
    if (this.timer !== undefined || this.world.tick !== 0 || this.drive.phase !== 'idle') throw new Error('Reset before changing mode.');
    this.mode = mode;
    this.publish();
  }

  setHazard(variant: HazardVariant): void {
    if (this.drive.kind === 'free') throw new Error('Free-drive hazards come from the seeded sequence.');
    if (this.timer !== undefined || this.world.tick !== 0) throw new Error('Reset before changing the hazard.');
    this.hazardVariant = variant;
    this.world = createWorld(this.config, this.world.selectedSpeedKmh, variant, this.world.ambientTempC);
    this.publish();
  }

  setRunKind(kind: RunKind): void {
    if (this.timer !== undefined || this.world.tick !== 0 || this.drive.phase !== 'idle') {
      throw new Error('Reset before changing the run type.');
    }
    if (kind === 'free' && this.config.stub) throw new Error('Free drive requires live mode; recorded advice covers only the staged scene.');
    this.drive = emptyDrive(this.config.driveSeed, this.drive.durationS, kind);
    this.publish();
  }

  setDriveDuration(seconds: number): void {
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 3600) {
      throw new Error('Drive duration must be an integer between 1 and 3600 seconds.');
    }
    this.drive.durationS = seconds;
    if (this.drive.kind === 'free' && this.drive.phase !== 'idle' &&
        this.drive.phase !== 'finished' && this.drive.elapsedS >= seconds) this.finishDrive('duration');
    this.publish();
  }

  stopDrive(): void {
    if (this.drive.kind !== 'free') throw new Error('Stop is available in free drive; use Reset for staged moments.');
    if (this.drive.phase !== 'finished') this.finishDrive('stopped');
    this.publish();
  }

  dispose(): void {
    this.stop();
    this.cancelRequests();
    this.listeners.clear();
  }

  private emptyFast(): Snapshot['fast'] {
    return {
      status: 'idle', observedAtTick: null, majorDamageRisk: null, adjacentLaneClear: null,
      latencyMs: 0, missedDeadlines: 0, deadlineTicks: [], error: null,
    };
  }

  private emptyAdvice(): Snapshot['advice'] {
    return { status: 'idle', observedAtTick: null, data: null, error: null, gate: null, application: null };
  }

  private advance(): void {
    this.world = advanceWorld(this.world, this.config);
    if (this.drive.kind === 'free') {
      this.driveTicks += 1;
      this.drive.elapsedS = this.driveTicks * this.config.tickMs / 1000;
      this.resolveEpisode();
      if (this.drive.elapsedS >= this.drive.durationS) this.finishDrive('duration');
      else if (this.drive.phase === 'episode') this.beginTick();
      else if (this.drive.phase === 'dwell' && this.world.tick >= this.phaseUntilTick) {
        this.world = { ...this.world, braking: false, outcome: 'running', hazardActive: false };
        this.scenario('clear', 'Stopped contact cleared by scenario, not model output; accelerating during the gap.');
        this.waitFor('gap', this.config.driveGapS);
      } else if (this.drive.phase === 'gap' && this.world.tick >= this.phaseUntilTick) {
        this.spawnEpisode();
        this.beginTick();
      }
    } else if (this.world.outcome === 'running') this.beginTick();
    else {
      for (const flight of this.fastFlights) {
        clearTimeout(flight.deadline);
        flight.controller.abort();
      }
      this.fastFlights.clear();
      this.log.unshift({
        tick: this.world.tick, detail: `${this.world.outcome}; physical world frozen`,
        majorDamageRisk: null, adjacentLaneClear: null, deadlineMissed: false,
      });
      this.log.length = Math.min(this.log.length, 40);
    }
    if (this.delayedStubAdvice && this.world.tick - this.delayedStubAdvice.observedAtTick >= this.config.stubSlowDelayTicks) {
      const pending = this.delayedStubAdvice;
      this.delayedStubAdvice = undefined;
      this.acceptAdvice(pending.result, pending.observedAtTick);
    }
    this.flushSlow();
    this.stopIfFinished();
    this.publish();
  }

  private scenario(event: NonNullable<TickEntry['scenario']>['event'], detail: string): void {
    this.log.unshift({
      tick: this.world.tick, detail: `Scenario / episode ${this.drive.episodeId ?? '-'}: ${detail}`,
      majorDamageRisk: null, adjacentLaneClear: null, deadlineMissed: false,
      scenario: { episodeId: this.drive.episodeId, event },
    });
    this.log.length = Math.min(this.log.length, 40);
  }

  private waitFor(phase: 'gap' | 'dwell', seconds: number): void {
    this.drive.phase = phase;
    this.phaseUntilTick = this.world.tick + Math.ceil(seconds * 1000 / this.config.tickMs);
  }

  private spawnEpisode(): void {
    this.cancelRequests();
    const next = nextHazard(this.sequenceSeed, this.world.carLane);
    this.sequenceSeed = next.seed;
    const previous = this.world;
    this.hazardVariant = next.variant;
    this.world = {
      ...createWorld(this.config, previous.selectedSpeedKmh, next.variant, previous.ambientTempC),
      tick: previous.tick, carLane: previous.carLane, speedKmh: previous.speedKmh,
      distanceTravelledM: previous.distanceTravelledM,
      hazard: { lane: previous.carLane, distanceM: this.config.initialHazardDistanceM, kind: next.kind },
      adjacentLanesBlocked: next.blocked,
    };
    this.drive.episodeId = (this.drive.episodeId ?? 0) + 1;
    this.drive.phase = 'episode';
    this.drive.score.hazardsFaced += 1;
    this.fast = { ...this.emptyFast(), missedDeadlines: this.fast.missedDeadlines, deadlineTicks: this.fast.deadlineTicks };
    this.advice = this.emptyAdvice();
    this.appliedAction = null;
    this.scenario('spawn', `New sensor contact in lane ${this.world.carLane}; seeded adjacent traffic.`);
  }

  private resolveEpisode(): void {
    if (this.drive.phase !== 'episode' || this.world.outcome === 'running') return;
    this.cancelRequests();
    if (this.advice.status === 'thinking') this.advice = { ...this.advice, status: 'idle', observedAtTick: null };
    if (this.fast.status === 'pending') this.fast.status = 'idle';
    const outcome = this.world.outcome;
    if (outcome === 'collision') {
      this.drive.score.collisions += 1;
      this.drive.phase = 'collision';
      this.scenario('collision', 'Collision counted. Run paused; Start resumes from rest.');
      this.stop();
    } else if (outcome === 'braked') {
      this.drive.score.avoidedByBraking += 1;
      this.waitFor('dwell', this.config.driveDwellS);
      this.scenario('stopped', 'Stopped before contact. Waiting for scenario clearance; episode work cancelled.');
    } else {
      if (outcome === 'swerved') this.drive.score.avoidedBySwerving += 1;
      this.scenario('passed', `Contact passed (${outcome}); episode work cancelled.`);
      this.world = { ...this.world, outcome: 'running', hazardActive: false, braking: false };
      this.waitFor('gap', this.config.driveGapS);
    }
  }

  private finishDrive(reason: 'duration' | 'stopped'): void {
    this.stop();
    this.cancelRequests();
    if (this.advice.status === 'thinking') this.advice = { ...this.advice, status: 'idle', observedAtTick: null };
    if (this.fast.status === 'pending') this.fast.status = 'idle';
    this.drive.phase = 'finished';
    this.drive.finishReason = reason;
    this.scenario('finished', `Drive ended (${reason}); scoreboard final. Reset to start another run.`);
  }

  private inPath(): boolean {
    return hazardInPath(senseContact(this.world), this.world);
  }

  private defaultFastAction(): ActionEnvelope['action'] {
    return fastAction({ majorDamageRisk: null, adjacentLaneClear: null, latencyMs: 0 }, this.threshold, this.inPath());
  }

  private beginTick(): void {
    const entry: TickEntry = {
      tick: this.world.tick, detail: `${Math.round(this.world.hazard.distanceM)} m; fast pending`,
      majorDamageRisk: null, adjacentLaneClear: null, deadlineMissed: false,
    };
    this.log.unshift(entry);
    this.log.length = Math.min(this.log.length, 40);
    const observation = buildObservation(this.world, this.hazardVariant);
    this.capturedObservation = { tick: this.world.tick, text: observation };
    if (
      this.mode !== 'fast_only' && !this.queuedSlow &&
      (this.drive.kind === 'staged' || this.slowEpisodeId !== this.drive.episodeId) &&
      (this.advice.status === 'idle' || this.advice.status === 'ready')
    ) this.beginSlow(observation);
    const controller = new AbortController();
    const flight: FastFlight = {
      generation: this.generation, episodeId: this.drive.kind === 'free' ? this.drive.episodeId : null,
      tick: this.world.tick, began: this.now(), entry, controller,
      expired: false,
      suppressed: this.mode === 'blocking' && this.advice.status === 'thinking',
      deadline: setTimeout(() => this.expireFast(flight), this.config.tickBudgetMs),
    };
    this.fastFlights.add(flight);
    this.fast.status = 'pending';
    this.fast.error = null;
    void Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return this.models.fast.decide(observation, controller.signal);
    }).then(
      (result) => {
        if (!this.owns(flight)) return;
        if (flight.expired || this.now() - flight.began >= this.config.tickBudgetMs || this.world.tick !== flight.tick) {
          this.expireFast(flight);
          entry.detail += '; late response discarded';
        } else {
          this.fast = {
            ...this.fast, majorDamageRisk: result.majorDamageRisk, adjacentLaneClear: result.adjacentLaneClear,
            latencyMs: result.latencyMs, status: 'ready', observedAtTick: flight.tick, error: null,
          };
          entry.majorDamageRisk = result.majorDamageRisk;
          entry.adjacentLaneClear = result.adjacentLaneClear;
          if (flight.suppressed) entry.detail += '; action suppressed while blocking';
          else this.applyEnvelope(
            this.envelope(fastAction(result, this.threshold, this.inPath()), 'fast', flight.tick), entry, undefined,
            result.majorDamageRisk === null || result.adjacentLaneClear === null,
          );
        }
        this.finishFast(flight);
      },
      (error: unknown) => {
        if (!this.owns(flight)) return;
        if (!flight.expired && (this.now() - flight.began >= this.config.tickBudgetMs || this.world.tick !== flight.tick)) {
          this.expireFast(flight);
        }
        if (flight.expired) entry.detail += '; late/aborted response discarded';
        else {
          const message = error instanceof Error ? error.message : 'Decision request failed.';
          this.fast.status = 'error';
          this.fast.error = message;
          entry.detail += `; fast error: ${message}`;
          if (!flight.suppressed) this.applyEnvelope(this.envelope(this.defaultFastAction(), 'fast', this.world.tick), entry, undefined, true);
        }
        this.finishFast(flight);
      },
    );
  }

  private owns(flight: FastFlight): boolean {
    return flight.generation === this.generation && this.fastFlights.has(flight) &&
      (this.drive.kind === 'staged' || (this.drive.phase === 'episode' && flight.episodeId === this.drive.episodeId));
  }

  private expireFast(flight: FastFlight): void {
    if (!this.owns(flight) || flight.expired) return;
    flight.expired = true;
    flight.controller.abort();
    if (flight.suppressed) flight.entry.detail += '; deadline passed, default suppressed while blocking';
    else {
      flight.entry.deadlineMissed = true;
      this.fast.missedDeadlines += 1;
      this.fast.deadlineTicks.unshift(flight.tick);
      this.fast.deadlineTicks.length = Math.min(this.fast.deadlineTicks.length, 20);
      this.fast.status = 'deadline';
      if (this.drive.kind === 'free') this.drive.score.deadlineMisses += 1;
      const action = this.defaultFastAction();
      flight.entry.detail += `; deadline missed -> default ${action} (${this.inPath() ? 'contact in path' : 'path clear'})`;
      this.applyEnvelope(this.envelope(action, 'fast', this.world.tick), flight.entry, undefined, true);
    }
    this.flushSlow();
    this.publish();
  }

  private finishFast(flight: FastFlight): void {
    clearTimeout(flight.deadline);
    this.fastFlights.delete(flight);
    this.flushSlow();
    this.stopIfFinished();
    this.publish();
  }

  private beginSlow(observation: string): void {
    const generation = this.generation;
    const episodeId = this.drive.kind === 'free' ? this.drive.episodeId : null;
    this.slowEpisodeId = episodeId;
    const observedAtTick = this.world.tick;
    const controller = new AbortController();
    this.advice = { ...this.advice, status: 'thinking', observedAtTick, error: null };
    const timeout = setTimeout(() => {
      if (!this.ownsSlow(generation, episodeId)) return;
      controller.abort();
      this.failSlow('Reasoning request exceeded 30 seconds.');
    }, 30_000);
    this.slowFlight = { controller, timeout };
    void Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return this.models.slow.advise(observation, controller.signal);
    }).then(
      (result) => {
        if (!this.ownsSlow(generation, episodeId)) return;
        clearTimeout(timeout);
        if (this.config.stub && this.world.tick - observedAtTick < this.config.stubSlowDelayTicks) {
          this.delayedStubAdvice = { result, observedAtTick };
        } else this.acceptAdvice(result, observedAtTick);
      },
      (error: unknown) => {
        if (!this.ownsSlow(generation, episodeId)) return;
        this.failSlow(error instanceof Error ? error.message : 'Reasoning request failed.');
      },
    );
  }

  private ownsSlow(generation: number, episodeId: number | null): boolean {
    return generation === this.generation && this.advice.status === 'thinking' &&
      (this.drive.kind === 'staged' || (this.drive.phase === 'episode' && episodeId === this.drive.episodeId));
  }

  private failSlow(message: string): void {
    if (this.slowFlight) clearTimeout(this.slowFlight.timeout);
    this.slowFlight = undefined;
    this.advice.status = 'error';
    this.advice.error = message;
    this.actionStatus = `Slow advice failed: ${message}`;
    this.stopIfFinished();
    this.publish();
  }

  private acceptAdvice(result: SlowResult, observedAtTick: number): void {
    if (this.slowFlight) clearTimeout(this.slowFlight.timeout);
    this.slowFlight = undefined;
    this.advice = {
      status: 'ready', observedAtTick,
      data: {
        ...result, observedAtTick, arrivedAtTick: this.world.tick,
        ...(this.drive.kind === 'free' && this.drive.episodeId !== null ? { episodeId: this.drive.episodeId } : {}),
      }, error: null,
      gate: null, application: null,
    };
    const envelope = this.envelope(result.action, 'slow', observedAtTick, result.targetLane);
    const proposed = this.check(envelope, 'proposal').decision;
    this.queuedSlow = { envelope, proposed };
    this.flushSlow();
    this.stopIfFinished();
    this.publish();
  }

  private flushSlow(): void {
    if (!this.queuedSlow) return;
    // Resolve fast work first so a new same-tick fast action wins a conflict.
    if ([...this.fastFlights].some((flight) => flight.tick === this.world.tick && !flight.expired && !flight.suppressed)) return;
    const { envelope, proposed } = this.queuedSlow;
    this.queuedSlow = undefined;
    this.applyEnvelope(envelope, this.log[0], proposed);
  }

  private envelope(
    action: ActionEnvelope['action'], source: ActionEnvelope['source'],
    observedAtTick: number, targetLane?: ActionEnvelope['toLane'],
  ): ActionEnvelope {
    return {
      action, source, fromLane: this.world.carLane, speedKmh: this.world.speedKmh,
      observedAtTick, proposedAtTick: this.world.tick,
      ...(targetLane !== undefined ? { toLane: targetLane } : {}),
      ...(this.drive.kind === 'free' && this.drive.episodeId !== null ? { episodeId: this.drive.episodeId } : {}),
    };
  }

  private check(envelope: ActionEnvelope, phase: GateRecord['phase']): GateRecord {
    const current = { ...envelope, speedKmh: this.world.speedKmh };
    const decision = evaluateGate(current, this.world.tick, this.world.speedKmh, {
      stalenessLimitTicks: this.stalenessLimitTicks,
      swerveSpeedLimit: swerveSpeedLimitFor(this.world.ambientTempC, this.config),
      swerveTier: swerveTierFor(this.world.ambientTempC, this.config),
      ambientTempC: this.world.ambientTempC,
    });
    const record = { phase, atTick: this.world.tick, envelope: current, decision };
    this.gate.unshift(record);
    this.gate.length = Math.min(this.gate.length, 20);
    return record;
  }

  private applyEnvelope(
    envelope: ActionEnvelope, entry?: TickEntry, prior?: GateDecision, safetyFallback = false,
  ): void {
    if (this.drive.kind === 'free' && (this.drive.phase !== 'episode' || envelope.episodeId !== this.drive.episodeId)) {
      this.actionStatus = `Discarded ${envelope.source} action from a finished episode.`;
      return;
    }
    const proposed = prior ?? this.check(envelope, 'proposal').decision;
    const application = this.check(envelope, 'application');
    const applied = application.decision;
    const previous = this.appliedAction;
    const sameAction = previous?.envelope.action === envelope.action && previous.envelope.toLane === envelope.toLane;
    if (!proposed.allowed || !applied.allowed) {
      const reasons = !applied.allowed ? applied.reasons : !proposed.allowed ? proposed.reasons : [];
      this.actionStatus = `${envelope.source} ${envelope.action} refused: ${reasons.map((reason) => reason.reason).join(' + ')}.`;
    } else if (this.world.outcome !== 'running' && this.world.outcome !== 'braked') {
      this.actionStatus = `${envelope.source} ${envelope.action} checked; terminal world unchanged.`;
    } else if (envelope.action === 'brake' && !this.inPath()) {
      this.actionStatus = `${envelope.source} brake not applied: sensed contact is outside the occupied path.`;
    } else if (
      envelope.source === 'slow' && previous?.envelope.source === 'fast' &&
      previous.atTick === this.world.tick && !sameAction
    ) {
      this.actionStatus = `slow ${envelope.action} allowed, not applied: fast ${previous.envelope.action} wins the same-tick conflict.`;
    } else if (envelope.action === 'swerve' && (envelope.toLane === undefined || Math.abs(envelope.toLane - this.world.carLane) !== 1)) {
      this.actionStatus = 'Slow swerve not applied: target lane is not adjacent.';
      this.advice.error = this.actionStatus;
    } else if (sameAction && !safetyFallback) {
      // Reaffirming an engaged action does not move its original application tick.
      this.actionStatus = `${envelope.source} ${envelope.action} unchanged; applied at tick ${previous.atTick}.`;
    } else {
      const fromLane = this.world.carLane;
      this.world = applyAction(this.world, envelope.action, envelope.toLane);
      this.appliedAction = { atTick: this.world.tick, envelope: { ...envelope, speedKmh: this.world.speedKmh } };
      this.actionStatus = `${envelope.source} ${envelope.action} applied.`;
      if (previous && previous.atTick < this.world.tick) {
        application.supersedes = previous;
        this.actionStatus = `${envelope.source} ${envelope.action} applied - superseded ${previous.envelope.source} ${previous.envelope.action} at tick ${previous.atTick}.`;
        const lane = envelope.action === 'swerve' ? ` lane ${fromLane} -> ${envelope.toLane}` : '';
        const replaced = `${previous.envelope.source} ${previous.envelope.action} ${previous.envelope.action === 'brake' && envelope.action !== 'brake' ? 'released' : 'replaced'}`;
        this.log.unshift({
          tick: this.world.tick,
          detail: `supersession: ${envelope.source} ${envelope.action}${lane} / allowed - ${replaced}`,
          majorDamageRisk: this.fast.majorDamageRisk, adjacentLaneClear: this.fast.adjacentLaneClear,
          deadlineMissed: false, supersession: { previous, envelope },
        });
        this.log.length = Math.min(this.log.length, 40);
      }
    }
    if (entry) entry.detail += `; ${this.actionStatus}`;
    if (envelope.source === 'slow') {
      this.advice.gate = !proposed.allowed ? proposed : applied;
      this.advice.application = this.actionStatus;
      if (this.drive.kind === 'free') {
        if (this.advice.gate.allowed) this.drive.score.slowAllowed += 1;
        else {
          this.drive.score.slowRefused += 1;
          for (const refusal of this.advice.gate.reasons) {
            if (refusal.reason === 'stale_advice') this.drive.score.staleAdvice += 1;
            else this.drive.score.prohibitedAction += 1;
          }
        }
      }
    }
  }

  private stopIfFinished(): void {
    if (this.drive.kind === 'free') {
      this.resolveEpisode();
      return;
    }
    if (this.world.outcome !== 'running' && this.advice.status !== 'thinking' && !this.queuedSlow) this.stop();
  }

  private cancelRequests(): void {
    this.generation += 1;
    for (const flight of this.fastFlights) {
      clearTimeout(flight.deadline);
      flight.controller.abort();
    }
    this.fastFlights.clear();
    if (this.slowFlight) {
      clearTimeout(this.slowFlight.timeout);
      this.slowFlight.controller.abort();
    }
    this.slowFlight = undefined;
    this.delayedStubAdvice = undefined;
    this.queuedSlow = undefined;
  }

  private stop(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }

  private publish(): void {
    for (const listener of this.listeners) listener(this.snapshot());
  }
}
