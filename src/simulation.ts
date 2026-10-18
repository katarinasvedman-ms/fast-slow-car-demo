import type { Config } from './config.js';
import { buildObservation, observeScene } from './observation.js';
import { evaluateGate } from './gate.js';
import { fastAction } from './policy.js';
import type { ModelServices } from './models/live.js';
import type {
  ActionEnvelope, AppliedAction, GateDecision, GateRecord, HazardVariant, Mode,
  SlowResult, Snapshot, TickEntry,
} from './types.js';
import { advanceWorld, applyAction, createWorld, publicWorld, setWorldSpeed } from './world.js';

interface FastFlight {
  generation: number;
  tick: number;
  began: number;
  entry: TickEntry;
  controller: AbortController;
  deadline: ReturnType<typeof setTimeout>;
  expired: boolean;
  suppressed: boolean;
}

export class Simulation {
  private world;
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

  constructor(
    private readonly config: Config,
    private readonly models: ModelServices,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.world = createWorld(config);
    this.stalenessLimitTicks = config.stalenessLimitTicks;
  }

  snapshot(): Snapshot {
    return {
      backend: this.config.stub ? 'stub' : 'live',
      modelName: this.models.fast.name,
      slowModelName: this.models.slow.name,
      mode: this.mode,
      threshold: this.threshold,
      started: this.timer !== undefined,
      world: publicWorld(this.world),
      hazardVariant: this.hazardVariant,
      observation: this.capturedObservation?.text ?? buildObservation(this.world, this.hazardVariant),
      observationTick: this.capturedObservation?.tick ?? null,
      scene: observeScene(this.world, this.hazardVariant),
      settings: {
        tickMs: this.config.tickMs,
        tickBudgetMs: this.config.tickBudgetMs,
        initialHazardDistanceM: this.config.initialHazardDistanceM,
        brakeDecelMps2: this.config.brakeDecelMps2,
        stalenessLimitTicks: this.stalenessLimitTicks,
        swerveSpeedLimit: this.config.swerveSpeedLimit,
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
    if (this.timer !== undefined || this.world.outcome !== 'running') return;
    this.timer = setInterval(() => this.advance(), this.config.tickMs);
    this.beginTick();
    this.publish();
  }

  reset(): void {
    this.stop();
    this.cancelRequests();
    this.models.reset?.();
    this.world = createWorld(this.config, this.world.selectedSpeedKmh, this.hazardVariant);
    this.log = [];
    this.gate = [];
    this.fast = this.emptyFast();
    this.advice = this.emptyAdvice();
    this.actionStatus = 'No action proposed.';
    this.appliedAction = null;
    this.capturedObservation = null;
    this.publish();
  }

  setSpeed(speedKmh: number): void {
    if (!Number.isFinite(speedKmh) || speedKmh < 50 || speedKmh > 130) {
      throw new Error('Speed must be between 50 and 130 km/h.');
    }
    this.world = setWorldSpeed(this.world, speedKmh);
    this.publish();
  }

  setThreshold(threshold: number): void {
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new Error('Threshold must be between 0 and 1.');
    this.threshold = threshold;
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
    if (this.timer !== undefined || this.world.tick !== 0) throw new Error('Reset before changing mode.');
    this.mode = mode;
    this.publish();
  }

  setHazard(variant: HazardVariant): void {
    if (this.timer !== undefined || this.world.tick !== 0) throw new Error('Reset before changing the hazard.');
    this.hazardVariant = variant;
    this.world = createWorld(this.config, this.world.selectedSpeedKmh, variant);
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
    if (this.world.outcome === 'running') this.beginTick();
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
      (this.advice.status === 'idle' || this.advice.status === 'ready')
    ) this.beginSlow(observation);
    const controller = new AbortController();
    const flight: FastFlight = {
      generation: this.generation, tick: this.world.tick, began: this.now(), entry, controller,
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
            this.envelope(fastAction(result, this.threshold), 'fast', flight.tick), entry, undefined,
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
          if (!flight.suppressed) this.applyEnvelope(this.envelope('brake', 'fast', this.world.tick), entry, undefined, true);
        }
        this.finishFast(flight);
      },
    );
  }

  private owns(flight: FastFlight): boolean {
    return flight.generation === this.generation && this.fastFlights.has(flight);
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
      flight.entry.detail += '; deadline missed -> default brake';
      this.applyEnvelope(this.envelope('brake', 'fast', this.world.tick), flight.entry, undefined, true);
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
    const observedAtTick = this.world.tick;
    const controller = new AbortController();
    this.advice = { ...this.advice, status: 'thinking', observedAtTick, error: null };
    const timeout = setTimeout(() => {
      if (generation !== this.generation || this.advice.status !== 'thinking') return;
      controller.abort();
      this.failSlow('Reasoning request exceeded 30 seconds.');
    }, 30_000);
    this.slowFlight = { controller, timeout };
    void Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return this.models.slow.advise(observation, controller.signal);
    }).then(
      (result) => {
        if (generation !== this.generation || this.advice.status !== 'thinking') return;
        clearTimeout(timeout);
        if (this.config.stub && this.world.tick - observedAtTick < this.config.stubSlowDelayTicks) {
          this.delayedStubAdvice = { result, observedAtTick };
        } else this.acceptAdvice(result, observedAtTick);
      },
      (error: unknown) => {
        if (generation !== this.generation || this.advice.status !== 'thinking') return;
        this.failSlow(error instanceof Error ? error.message : 'Reasoning request failed.');
      },
    );
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
      data: { ...result, observedAtTick, arrivedAtTick: this.world.tick }, error: null,
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
    };
  }

  private check(envelope: ActionEnvelope, phase: GateRecord['phase']): GateRecord {
    const current = { ...envelope, speedKmh: this.world.speedKmh };
    const decision = evaluateGate(current, this.world.tick, this.world.speedKmh, {
      stalenessLimitTicks: this.stalenessLimitTicks,
      swerveSpeedLimit: this.config.swerveSpeedLimit,
    });
    const record = { phase, atTick: this.world.tick, envelope: current, decision };
    this.gate.unshift(record);
    this.gate.length = Math.min(this.gate.length, 20);
    return record;
  }

  private applyEnvelope(
    envelope: ActionEnvelope, entry?: TickEntry, prior?: GateDecision, safetyFallback = false,
  ): void {
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
    }
  }

  private stopIfFinished(): void {
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
