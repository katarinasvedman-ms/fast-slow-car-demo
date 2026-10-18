export type Lane = 1 | 2 | 3;
export type HazardVariant = 'elk' | 'small_animal' | 'ambiguous';
export type Outcome = 'running' | 'braked' | 'swerved' | 'continued' | 'collision';
export type Action = 'swerve' | 'brake' | 'continue';
export type Mode = 'fast_only' | 'blocking' | 'async_gated';

export interface FastResult {
  majorDamageRisk: number | null;
  adjacentLaneClear: number | null;
  latencyMs: number;
}

export interface SlowResult {
  action: Action;
  targetLane?: Lane;
  rationale: string;
  latencyMs: number;
}

export interface Advice extends SlowResult {
  observedAtTick: number;
  arrivedAtTick: number;
}

export interface ActionEnvelope {
  action: Action;
  fromLane: Lane;
  toLane?: Lane;
  speedKmh: number;
  source: 'fast' | 'slow';
  observedAtTick: number;
  proposedAtTick: number;
}

export interface GateRefusal {
  reason: 'stale_advice' | 'prohibited_action';
  detail: string;
}

export type GateDecision =
  | { allowed: true }
  | { allowed: false; reasons: [GateRefusal, ...GateRefusal[]] };

export interface GateRecord {
  phase: 'proposal' | 'application';
  atTick: number;
  envelope: ActionEnvelope;
  decision: GateDecision;
  supersedes?: AppliedAction;
}

export interface AppliedAction {
  atTick: number;
  envelope: ActionEnvelope;
}

export interface LaneChange {
  fromLane: Lane;
  toLane: Lane;
  startedAtTick: number;
  elapsedTicks: number;
  durationTicks: number;
}

export interface WorldState {
  tick: number;
  speedKmh: number;
  selectedSpeedKmh: number;
  carLane: Lane;
  laneChange: LaneChange | null;
  hazard: { lane: Lane; distanceM: number; kind: 'elk' | 'small_animal' };
  adjacentLanesBlocked: Lane[];
  adjacentVehicleDistanceBehindM: number;
  clearLaneDistanceM: number;
  roadSurface: 'dry';
  braking: boolean;
  outcome: Outcome;
}

export interface WorldView {
  tick: number;
  speedKmh: number;
  selectedSpeedKmh: number;
  carLane: Lane;
  laneChange: LaneChange | null;
  hazardLane: Lane;
  distanceM: number;
  identity: WorldState['hazard']['kind'] | null;
  braking: boolean;
  outcome: Outcome;
}

export interface TickEntry {
  tick: number;
  detail: string;
  majorDamageRisk: number | null;
  adjacentLaneClear: number | null;
  deadlineMissed: boolean;
  supersession?: { previous: AppliedAction; envelope: ActionEnvelope };
}

export interface SceneView {
  contactDescription: string;
  roadSurface: WorldState['roadSurface'];
  lanes: {
    lane: Lane;
    vehicleBehindM: number | null;
    clearAheadM: number | null;
  }[];
}

export interface Snapshot {
  backend: 'live' | 'stub';
  modelName: string;
  slowModelName: string;
  mode: Mode;
  threshold: number;
  started: boolean;
  world: WorldView;
  hazardVariant: HazardVariant;
  observation: string;
  observationTick: number | null;
  scene: SceneView;
  settings: {
    tickMs: number;
    tickBudgetMs: number;
    initialHazardDistanceM: number;
    brakeDecelMps2: number;
    stalenessLimitTicks: number;
    swerveSpeedLimit: number;
  };
  log: TickEntry[];
  gate: GateRecord[];
  actionStatus: string;
  fast: FastResult & {
    status: 'idle' | 'pending' | 'ready' | 'deadline' | 'error';
    observedAtTick: number | null;
    missedDeadlines: number;
    deadlineTicks: number[];
    error: string | null;
  };
  advice: {
    status: 'idle' | 'thinking' | 'ready' | 'error';
    observedAtTick: number | null;
    data: Advice | null;
    error: string | null;
    gate: GateDecision | null;
    application: string | null;
  };
}
