# Build brief — fast/slow decision demo (car + elk)

Audience for this brief: a coding agent. Build exactly what is here. Do not add
features, abstractions, or scenarios that are not listed. Ask before adding a
dependency that is not named below.

## Confirmed implementation amendments

These decisions override conflicting examples below:

- Use one fast model (Foundry `fast-decider`, Microsoft Decision-1) and one slow
  model (Foundry `slow-reasoner`, GPT-5.4). Remove the second fast provider and
  model-switching comparison. Local measurement calibrates the one fast model;
  it is not a competitive benchmark. No direct OpenAI account is required.
- Authenticate with the existing Azure CLI sign-in using Entra ID. Do not
  enable resource API keys or change the Entra-only security policy.
- Decision-1 has a 60 requests/second limit. Default traffic is 2.5/s; keep
  live requests conservatively paced and calibration sequential. No stress tests.
- The demo runs locally. Its local two-predicate benchmark is authoritative
  for `TICK_MS` and `TICK_BUDGET_MS`; no regional validation is pending. Prefer
  the presentation network, or the worst accessible connection if it is unknown.
- Azure deployment is out of scope. Docker is optional after the local demo.
- Use Express and npm with TypeScript and Node/Express type declarations.
  Use Node's built-in test runner for a few focused policy, physical-world,
  timing, lifecycle, and observation tests; no additional test/lint framework.
- The damage threshold stays `0.35`; stage ambiguous probabilities around `0.40`.
- Gate refusals are an ordered list of independent reasons, not one reason.
  Show stale-only, prohibited-only, or both without treating one as a broken run.
- Draw all observation-backed traffic and lane clearance on the road, using
  the same world-backed sensor projection as the observation string. Include a
  collapsed "What the models see" panel beside the road with exact captured input
  and its tick. Traffic remains scenery: no new behavior, collision rules,
  decision logic, or hidden hazard identity disclosure to models.
- Selecting Elk or Small animal shows the supplied moose/squirrel image on the
  road immediately as an audience-only preview, retained after Reset. Ambiguous
  keeps the unidentified marker until an outcome. Model input remains text only.
- Expose the staleness limit as a live UI control, initialized from the
  environment and retained across Reset. Explain ticks versus seconds, the
  inclusive age boundary, why 3 demonstrates refusal and 6 lets the default
  five-tick replay through, and how to show slow advice actually changing lane
  without overriding speed limits or bypassing either gate checkpoint.
- Braking is revisable: a later allowed action supersedes an earlier applied
  action, releases its brake, and executes. Newly applied fast actions win
  simultaneous conflicts; reaffirming an engaged action does not renew its
  application tick. Refused actions supersede nothing. Show typed supersession
  provenance in the tick/gate logs, applied slow card, and a brief road marker;
  lane changes take three ticks rather than teleporting. Preserve the initial
  60/90 km/h advice contrast using identical reasoning and otherwise identical
  settings; later fresh advice may pass after braking reduces actual speed.
- Reassess slow advice continuously, one request at a time, while the episode
  runs. After each evaluated result, capture fresh input on the next running tick.
  Never refresh an old action's timestamp or overlap requests. Stop new requests
  after an outcome or service error. Retain the last completed result as labelled
  history while the next assessment is thinking. Fast-only remains unchanged.
- Braking is gradual, with environment-configurable `BRAKE_DECEL_MPS2` and
  `INITIAL_HAZARD_DISTANCE_M`. The speed slider remains live and does not reset
  the world or cancel braking. Gate checks use current actual speed.
- Rehearse the late-advice moment by tuning distance/deceleration. If the car
  has already slowed to 70 km/h or below, staleness alone is a valid refusal:
  the prohibition no longer applies, demonstrating genuinely independent rules.
- In blocking mode, suppress fast actions and deadline braking while slow
  advice is pending; the physical world continues. New fast actions win over
  slow advice in the same tick. Reset invalidates pending calls. Collision and
  completed passage freeze physical motion/actions; a stopped brake remains
  revisable by pending allowed advice, without inventing acceleration.

## 1. What this is

A live demo for a 10-minute talk. A toy world runs on a fixed clock. A fast
decision model answers typed questions every tick. A slower reasoning model
thinks across several ticks and returns advice. A deterministic gate decides
what is actually allowed to happen.

The point of the demo is **not** that the models are clever. It is that:

1. The world does not pause while a model thinks.
2. Advice from the slow model has a shelf life.
3. Agreement is not authority: a well-reasoned plan can still be refused.

Keep this framing visible in the UI. It is the reason the demo exists.

Provenance note for the README: the governance pattern (typed action envelope
evaluated by deterministic policy, checked at two points) comes from
`katarinasvedman-ms/agentic-harness-validation`. No code is copied from it.

## 2. Scope

### In scope
- One scenario: a car on a 3-lane road, a hazard ahead.
- Fixed-tick simulation loop, server-side.
- Fast layer: Microsoft Decision-1 through Foundry SystemOne.
- Slow layer: Foundry GPT-5.4 via the Responses API, called asynchronously.
- A deterministic gate with two independent refusal reasons.
- One web page showing the world, the probabilities, the advice, and the gate.
- Stub mode that replays recorded responses with no network.
- An optional Dockerfile after the local demo is complete.

### Explicitly out of scope — do not build
- Authentication, user accounts, multi-session support.
- Any database or persistence. All state is in memory in one process.
- Formal verification, Dafny, proof tooling.
- Human approval flows, capability leases, audit stores.
- A second scenario, a scenario editor, or configurable hazard types beyond
  the one toggle described below.
- Image input to the fast model (text only — see §6).
- Tests beyond focused policy, physics, timing, lifecycle, and input-boundary cases.
- CI/CD pipelines.

## 3. Stack

- TypeScript throughout, Node 22.16+, ESM.
- `express` for the HTTP server, npm, TypeScript and Node/Express declarations.
- `openai` SDK as a client for Foundry's Responses API; native `fetch` for Decision-1.
- Server-sent events for pushing tick state to the page. No websockets, no
  socket.io.
- Front end: a single static HTML file with inline CSS and a small TS file
  compiled to JS. **No React, no build framework, no Tailwind.** The visual is
  an inline SVG manipulated directly.
- One local process serves both the API and the static page.

## 4. The world model

A 3-lane road. The car occupies one lane and moves up the screen at `speed`
(km/h, display only — it scales hazard closing distance). A hazard sits in a
lane ahead at a distance that decreases each tick.

```ts
type Lane = 1 | 2 | 3;

interface WorldState {
  tick: number;
  speedKmh: number;        // actual current speed, including gradual braking
  selectedSpeedKmh: number; // live UI setting; raising it does not cancel braking
  carLane: Lane;
  hazard: {
    lane: Lane;
    distanceM: number;     // decreases each tick based on speed
    kind: 'elk' | 'small_animal';   // ground truth, NOT sent to the models
  };
  adjacentLanesBlocked: Lane[];     // ground truth, NOT sent to the models
  braking: boolean;
  outcome: 'running' | 'braked' | 'swerved' | 'continued' | 'collision';
}
```

**Critical:** the models never receive `kind` or `adjacentLanesBlocked`. They
receive an observation string (§6) derived from the world. The ground truth is
used only to render the scene and to decide collision outcomes.

Tick interval: 400ms, fixed. The loop runs on `setInterval` and advances the
world whether or not any model call has returned. This is the single most
important behaviour in the demo — never await a model call inside the tick
advance.

## 5. The three modes

A mode selector in the UI. All three run the same world and the same gate.

1. **`fast_only`** — fast layer each tick, no slow layer at all.
2. **`blocking`** — when the slow layer is called, the car keeps moving but the
   system takes no new action until the advice returns. This is the point:
   blocking does not stop the world, it only stops *us*.
3. **`async_gated`** — the fast layer keeps acting every tick while the slow
   layer thinks. When advice arrives it goes through the gate.

## 6. Fast layer — decision model

One call per tick. Text input only.

**Decider: Microsoft Decision-1 via Microsoft Foundry**, deployed as
`fast-decider`. There is no second fast model or provider-switching comparison.

Build the observation string from world state, for example:

```
Thermal and radar contact ahead in lane 2, range 60 m, closing.
Large quadruped silhouette, estimated mass high, upright stance.
Lane 1: vehicle detected 20 m behind. Lane 3: clear to 100 m.
Vehicle speed 90 km/h. Road surface dry.
```

Vary the wording with the hazard toggle so the signal is genuinely ambiguous in
the ambiguous case — do not make it trivially decidable.

Send **two independent predicates in one request**. They must not depend on
each other; the service evaluates questions independently, and anything that
depends on an earlier answer requires a separate request.

Foundry uses named `noul` questions and `state` sensor text. Keep question
instructions shared between the calibration probe and the live path:

```ts
const requestBody = {
  model: 'fast-decider',
  state: observation,
  questions: {
    major_damage_risk: {
      type: 'noul',
      instructions:
        'Would a collision with this obstacle cause major vehicle damage or ' +
        'injury to occupants? Consider mass and size only. Ignore road surface.',
    },
    adjacent_lane_clear: {
      type: 'noul',
      instructions:
        'Is at least one adjacent lane free of other vehicles for the next ' +
        '100 metres?',
    },
  },
};
// POST /providers/microsoft/v1/systemone with an Entra Bearer token.
```

**Handle every answer variant.** The answer union includes `refusal`. Branch on
`answer.type` before reading `noul`. A refusal must be treated as
"unknown" and must trigger the safe default — never as "false".

Render both probabilities as live bars: label, bar, numeric value to two
decimals.

### 6.3 Model interface and authentication
Use a small fast service interface:

```ts
interface FastDecider {
  name: string;
  decide(observation: string): Promise<{
    majorDamageRisk: number | null;   // null means refusal/unknown
    adjacentLaneClear: number | null;
    latencyMs: number;
  }>;
}
```

Live mode uses the configured resource/deployment and existing Azure CLI sign-in.
Cache Entra tokens in process memory. Do not change the resource's Entra-only
policy or request a separate OpenAI account. Stub mode authenticates nowhere.

Show the active decider's name and its latest latency in the fast-layer panel.

### 6.4 Latency check — do this first
Before building anything else in step 3, measure the actual local round-trip:

- Send the actual two-predicate request 20 times to Decision-1, with retries off.
- Record p50 and p95 wall-clock latency.
- Print a table and record it in the README and a sanitized sample artifact.
- Prefer the presentation network, or the worst accessible connection if unknown.

The tick budget is 350ms (§9). Decide from the measurement, not from vendor
figures:

- If the primary decider's **p95 fits in 350ms**, keep `TICK_MS=400`.
- If p95 is between 350ms and 550ms, raise `TICK_MS` to 600 and the budget to
  550ms. The demo still reads as real-time.
- If p95 exceeds 550ms, keep 400/350ms and the visible safe defaults/deadline
  counter. Do not fabricate a latency guarantee or introduce a second provider.

Report the measured numbers back before continuing.

## 7. Slow layer — System 2

Called asynchronously, initially when the hazard is first detected. After the
previous advice has been evaluated, capture a fresh observation on the next
running tick and reassess. Never overlap slow requests or start a new one while
earlier advice awaits application. Errors are explicit and are not automatically
retried; no new assessments begin after an outcome.

- Use the Responses API with a reasoning model. Do **not** await it in the tick
  loop — fire it, store the promise, handle resolution in a callback.
- It takes several ticks to return (typically 3–5). Do not artificially delay
  it; if it returns too fast to demo, note that in the README and add an
  optional configurable delay used only in stub mode.
- It returns a recommended action plus a short rationale (1–2 sentences, shown
  on screen).
- **Stamp the advice with the tick at which its input observation was captured.**
  This is essential:

```ts
interface Advice {
  observedAtTick: number;      // the tick whose observation it saw
  arrivedAtTick: number;       // when it came back
  action: 'swerve' | 'brake' | 'continue';
  targetLane?: Lane;
  rationale: string;
}
```

## 8. The gate — deterministic, no model involved

This is the centrepiece. Keep it small, readable, and in one file so it can be
shown on screen during the talk.

Every proposed action becomes a typed envelope first:

```ts
interface ActionEnvelope {
  action: 'swerve' | 'brake' | 'continue';
  fromLane: Lane;
  toLane?: Lane;
  speedKmh: number;
  source: 'fast' | 'slow';
  observedAtTick: number;
  proposedAtTick: number;
}

type GateDecision =
  | { allowed: true }
  | { allowed: false; reasons: [
      { reason: 'stale_advice' | 'prohibited_action'; detail: string },
      ...{ reason: 'stale_advice' | 'prohibited_action'; detail: string }[]
    ] };
```

Two independent rules, evaluated in this order, both reported separately:

1. **Staleness.** `currentTick - envelope.observedAtTick > STALENESS_LIMIT_TICKS`
   → refuse with `stale_advice`. Default limit: 3 ticks. Configurable.
2. **Prohibition.** A `swerve` is refused when `speedKmh > SWERVE_SPEED_LIMIT`
   (default 70). No model output, confidence, or rationale can override this.
   Refuse with `prohibited_action`.

Evaluate the gate at **two points**, mirroring the harness pattern: once where
the action is proposed, once immediately before the world applies it. Log both.
They will normally agree; the second one exists to show the pattern.

### Thresholds for the fast layer
The fast layer's output becomes an action via explicit thresholds, held in one
config object and exposed as a slider:

```ts
const DAMAGE_THRESHOLD = 0.35;   // deliberately well below 0.5
```

If `majorDamageRisk >= DAMAGE_THRESHOLD` → treat as elk → brake policy.
If either answer is `null` (refusal) → safe default → brake.
Otherwise → continue in lane.

The asymmetry is the teaching point: the cost of a false negative is
catastrophic, so the threshold is nowhere near 0.5. Put a one-line note about
this in the UI next to the slider.

## 9. Tick-deadline behaviour

If the fast layer has not returned within the tick budget (350ms, leaving
margin), the world applies a **safe default action** (brake) and the UI shows a
visible "deadline missed → default applied" marker for that tick. Do not hide
this. Keep a running count of missed deadlines on screen.

The late response must not be applied when it eventually arrives. Discard it
and log that it was discarded. Blocking mode suppresses deadline braking and
miss counting while slow advice is pending; physical advancement continues.

## 10. UI

One page, dark background, large type — it will be projected.

Layout, top to bottom:

1. **Controls row**: mode selector (3 buttons), speed slider (50–130 km/h),
   hazard toggle (elk / small animal / ambiguous), stub-mode indicator, start/reset.
2. **The road**: inline SVG, 3 lanes, car, hazard. Animate on tick. Show the
   selected moose/squirrel image immediately for the audience. Only the Ambiguous
   hazard stays unidentified until the outcome. Models receive sensor text only.
3. **Fast layer panel**: the active decider's name; the two probability bars,
   updating each tick; the active threshold marked on the damage bar; latency
   in ms; missed-deadline count.
4. **Advice card**: appears when the slow layer is called. Shows "thinking…"
   with a tick counter, then the returned action and rationale. **The card
   displays its own age in ticks**, going green → amber → red as it approaches
   the staleness limit.
5. **Gate panel**: the last few envelopes with allowed/refused and the reason.
   Refusals in red with the rule that fired named explicitly.
6. **Tick log**: a scrolling line per tick — tick number, fast probabilities,
   action proposed, gate decision, applied action.

Styling: reuse the visual language of
`katarinasvedman-ms.github.io/agentic-harness-validation/pitch.html` — same
accent colour, same typeface stack, same card treatment — so the demo looks
like part of the same family. Copy the CSS variables; do not import anything.

## 11. Stub mode

`STUB=1` runs the whole demo with no network calls, replaying a recorded
sequence of probabilities and a canned slow-layer response with a configurable
delay. Everything else behaves identically, including missed deadlines.

This mode must be as presentable as the live one. It is the fallback if the
venue network fails, and it is what gets rehearsed against.

Record the stub fixtures from real API responses once the live path works.

## 12. The three moments to stage

The demo must be able to produce each of these on demand via the controls.
Verify each one works before calling the build complete.

1. **Confident elk.** `major_damage_risk` high, threshold crossed, brake policy
   fires. Straightforward, establishes the loop.
2. **Ambiguous hazard.** `major_damage_risk` around 0.4. A naive 0.5 threshold
   would continue. The 0.35 threshold fires anyway. Explains the
   asymmetry.
3. **Late advice, prohibited action.** At speed 90, the slow layer returns a
   well-reasoned "swerve to lane 3" after 5 ticks. The gate refuses it for
   **two independent reasons** — stale and prohibited — and shows both. This is
   the closing beat of the talk. If braking has already reduced actual speed
   to 70 or below, staleness alone is valid and demonstrates rule independence.

## 13. Build order

Each step must leave a runnable demo. Do not start a step before the previous
one runs.

1. Tick loop, world state, SVG road, car moving, SSE to the page. No models.
2. The gate with a hardcoded hazard class and a hardcoded action. Prove refusal
   rendering works.
3. **Latency check first (§6.4) — report the numbers and set `TICK_MS` before
   writing anything else in this step.** Then: fast layer wired to Foundry
   Decision-1 through its small service interface.
   Probability bars live. Threshold slider. Deadline handling.
4. Slow layer, async, stamped advice, the ageing advice card.
5. Stub mode and recorded fixtures.
6. Optional Dockerfile after the complete local demo. No Azure deployment.

If time runs out, steps 1–3 alone are a coherent talk.

## 14. Configuration

Environment variables only, optionally loaded from an ignored local `.env`:

- `FOUNDRY_ENDPOINT` — HTTPS resource endpoint; authenticate with Azure CLI/Entra
- `FOUNDRY_DEPLOYMENT` (default `fast-decider`)
- `SLOW_MODEL` (default `slow-reasoner`, GPT-5.4 via Foundry Responses)
- `STUB` (`0`/`1`)
- `STUB_SLOW_DELAY_TICKS` (default 5, offline only)
- `TICK_MS` (default 400; set from the §6.4 measurement)
- `TICK_BUDGET_MS` (default 350; keep ~50ms below `TICK_MS`)
- `STALENESS_LIMIT_TICKS` (default 3), `SWERVE_SPEED_LIMIT` (default 70)
- `BRAKE_DECEL_MPS2` (default 1.5), `INITIAL_HAZARD_DISTANCE_M` (default 500)
- `BENCHMARK_NETWORK` — connection label for the local timing probe
- `PORT`

Never log tokens/keys or put them in fixtures.

## 15. README

Short. What the demo shows, how to run it locally, how to run it in stub mode,
the three staged moments and how to trigger each, the measured latency table
from §6.4, the provenance note from §1, and one honest-limitations paragraph:

> This is a toy world on a fixed clock, not a driving system. Tick intervals
> are hundreds of milliseconds and the hazard model is synthetic. The demo
> illustrates coordination and control patterns; it makes no claim about
> real-time guarantees, vehicle safety, or verified behaviour.
