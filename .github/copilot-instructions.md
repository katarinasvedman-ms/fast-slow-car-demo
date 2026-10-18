# Repository instructions

## Scope and commands

`build-brief.md` and its confirmed amendments define this local demo. Use one
fast Foundry Decision-1 model and one slow Foundry GPT-5.4 model. Do not restore
the removed Luna comparison, provider switching, or direct OpenAI-account
requirement. Docker is optional; do not provision or deploy Azure resources.
Ask before adding dependencies outside the brief's approved minimal stack.

Use Node 22.16+, npm, TypeScript, ESM, and Express:

- `npm ci`, `npm run build`, `npm start`.
- `npm run typecheck` checks server and browser compiler targets.
- `npm test` builds and runs Node's built-in tests.
- Single file after building: `node --test dist\tests\simulation.test.js`.
- Single matching test: `node --test --test-name-pattern="deadline applies" dist\tests\simulation.test.js`.
- Offline: set `$env:STUB = '1'` in PowerShell, then `npm start`. No auth/network.
- Calibration preflight: `node --env-file-if-exists=.env dist\scripts\benchmark.js --check`.
- Paid calibration/capture require explicit `--allow-paid-requests` on
  `dist\scripts\benchmark.js` / `dist\scripts\record-fixtures.js`.

## Architecture

One process owns one in-memory world and serves the API/static page on loopback.
`src\main.ts` selects live or recorded services before starting Express;
`src\server.ts` exposes controls, snapshots, and SSE. No persistence, sessions,
websockets, frontend framework, or bundler.

`src\simulation.ts` owns the fixed interval, asynchronous request generations,
deadlines, mode behavior, arbitration, and reset. `src\world.ts` owns physical
advancement/outcomes. `src\drive.ts` owns the seeded scenario sequence and initial
score state. `src\observation.ts` is the model-input boundary, including the
structured lane/range sensor contact used by path-aware policy.
`src\policy.ts` maps fast probabilities to actions and resolves temperature
tiers/limits; `src\gate.ts` contains only
the two deterministic rules so it remains readable during a talk.

`src\models\live.ts` calls Foundry SystemOne for the two predicates and Foundry
Responses for reasoning. The `openai` SDK is a client for Azure, not a separate
provider. `src\models\auth.ts` caches/deduplicates Azure CLI token acquisition
in memory; keep the existing Entra-only resource policy unchanged.
`src\models\stub.ts` replays checked-in, real-response fixtures through the same
simulation/policy/gate paths without constructing live clients.

`public\index.html` holds inline CSS and SVG. `client\main.ts` performs direct
DOM updates from SSE. Server and browser have separate compiler targets. Share
public types via type-only imports, not runtime server imports. SSE snapshots
are authoritative; do not apply potentially older HTTP-control responses.

## Behavioral invariants

- Never await model work in the tick callback. The world advances independently.
- Decision-1's limit is 60 requests/s. Default traffic is 2.5/s; preserve the
  live adapter's shared 50 ms request spacing and sequential paced calibration.
  Do not run stress tests or concurrent live probes. Use mocks for rate tests.
- Model input is derived sensor text only. Never serialize ground-truth `kind`
  or `adjacentLanesBlocked` to either model. Outside `ambientTempC` is a trusted
  vehicle sensor for the deterministic gate only: never add temperature, grip
  tier or its speed limit to observations or `observeScene`. Fixtures stay unchanged.
  Public world projection conceals
  hazard identity until a terminal outcome. The UI may preview moose/squirrel
  images from the explicit dropdown selection for the audience; Ambiguous stays
  unidentified until an outcome. Those previews apply only to explicit staged
  selections; free drive never exposes generated kinds before reveal and sends
  null for the public hazardVariant. Never send those images to either model.
- Observation text and road scenery share `observeScene` and world-backed
  traffic distances/clearance. Render all described traffic, lane status,
  contact range/description, and road condition without adding traffic behavior.
  The collapsed World-card input panel shows the captured request text/tick,
  not a reconstruction after within-tick controls or actions.
- Branch on the Foundry answer `type` before reading `noul`; refusal/null is
  unknown, not false. Invalid variants/values are explicit errors. Unknown or
  service failure brakes while the sensed contact is in the occupied path;
  damage risk >= the current threshold also brakes only in that path. Occupied
  path includes current lane and the turn target until the turn completes.
  Read the lane from the sensor contact, never hidden kind. Outside the path,
  high/unknown/error/deadline fast decisions continue; fast never swerves.
- Default threshold is 0.35. The recorded ambiguous example is about 0.4073,
  below 0.5 but above the threshold. Preserve the asymmetric-cost UI explanation.
- Each fast response belongs to one run generation and observation tick. At
  350 ms on a 400 ms tick, default to brake in-path or continue when clear,
  count/mark the miss, and discard
  late completions. Check elapsed time as well as timer callbacks. Reset aborts
  old work and prevents its eventual callbacks from changing the new run.
- `fast_only` never invokes reasoning. `blocking` suppresses fast actions and
  deadline braking while advice is pending, not physical movement.
  `async_gated` continues fast actions. Reset before changing mode/hazard.
- In staged moments reassess continuously in both reasoning modes, at most one slow request at a
  time. After evaluated advice, capture a fresh observation on the next running
  tick, never while old advice awaits application. Do not start new assessments
  after an outcome or automatically retry service errors. Stamp observation and
  arrival separately; show the previous completed result as history while thinking.
  Live calls are never artificially delayed. Only stub advice is held until
  `STUB_SLOW_DELAY_TICKS`; age is measured from observation, not arrival.
- Every envelope is checked at proposal and application. Refusal is an ordered
  nonempty list: age > staleness limit, then swerve at actual speed > speed
  limit resolved from CURRENT outside temperature. Default tiers: >4 °C normal
  grip / 110 km/h; >0 through 4 °C frost risk / 70 km/h; <=0 °C ice risk / 40 km/h.
  Configure via `SWERVE_SPEED_LIMIT_NORMAL`, `SWERVE_SPEED_LIMIT_FROST`,
  `SWERVE_SPEED_LIMIT_ICE`, `FROST_RISK_TEMP_C` and `ICE_RISK_TEMP_C`.
  Recheck current tick/speed/temperature at application; evaluate both rules even
  when one already refuses. Confidence/rationale cannot override the gate.
- Outside temperature defaults to 12 °C. The `temperature` command accepts a
  finite number -20..30 °C, is live-editable beside speed and survives Reset and
  hazard changes. Edits affect future checks only, never retry refused advice,
  change physical motion or override same-tick fast priority. Show current
  temperature, tier and active limit in both gate views.
- Staleness is live-editable through the gate card and `staleness` control
  command (integer 0..1000 ticks), initialized from `STALENESS_LIMIT_TICKS`.
  Preserve the chosen limit across Reset; changes affect future checks and do
  not retry already refused advice. Explain ticks/time and the 3-versus-6
  replay contrast without weakening speed rules or same-tick fast priority.
- Braking is revisable. Resolve current-tick fast work first; a newly applied
  fast action wins a same-tick conflict. Reaffirming an already engaged action
  does not update its application epoch. A later allowed action supersedes an
  earlier one and can release its brake; refused/invalid advice changes nothing.
  Unknown/error/deadline defaults are fresh fast actions, not cached reaffirmations.
  Higher selected speed alone never cancels braking; a lower setting can reduce
  actual speed live. Recovery increases speed at configurable ACCEL_MPS2 (default
  2.0 m/s²), capped at selected speed, only without braking/turning and outside
  the sensed contact's path. Releasing the brake never jumps actual speed.
  Slow brake advice outside the path is explicitly not applied, not a third
  gate rule. Never make the fast policy propose swerves.
- Lane changes take three physical ticks, with occupied-lane collision checks,
  a matching SVG transition, and a brief road marker. Preserve typed supersession
  provenance in the distinct tick-log event and allowed application record, and
  the slow card's applied message. A later brake does not teleport/cancel a turn.
- Braking is gradual. Tune `BRAKE_DECEL_MPS2` and `INITIAL_HAZARD_DISTANCE_M`
  through environment variables, not code changes. Stale-only refusal after
  slowing below the current temperature-resolved limit is a valid run, not a
  failure to display both reasons.
  Continuous reassessment may permit a later turn after an initial high-speed
  refusal; a 90 km/h starting setting does not guarantee an in-lane stop.
- Rehearse late advice at 90 km/h, -4 °C, staleness 3 (both refusals), and
  supersession at 90 km/h, 12 °C, staleness 6 (allowed, brake released, turn 2 -> 3).
  To isolate temperature, hold staleness 6 in both runs: ice refuses speed,
  normal grip permits. Never claim the 3-versus-6 presets differ only in temperature.
- In staged moments collision/completed passage freeze motion/actions; pending advice can still
  age and be checked. A stopped `braked` state may be revised by pending allowed
  advice, with recovery only after clearing the path. `continued` means completed passage,
  not the first continue proposal.
- Free drive is live-only: reject it in STUB in both UI and server; the unchanged
  recordings do not cover arbitrary lanes/traffic. Presets 1-4 explicitly reset
  to staged. Never run paid recordings or live rehearsals without approval.
- Free drive spawns contacts in the current lane from DRIVE_SEED, uses shared
  observation/scenery and a cumulative odometer, and counts real episode
  outcomes. After stopping, DRIVE_DWELL_S precedes a logged scenario clearance
  (never model output), then DRIVE_GAP_S allows recovery before the next contact.
  No model calls in dwell/gap/collision pause/finished phases.
- Free drive reasons once per episode, at most one request in flight. Stamp fast
  and slow work/envelopes with episode ids and recheck ownership at application.
  Resolving an episode, Stop or Reset cancels old work; eventual callbacks cannot
  affect another episode. Do not retry a refusal or service error within it.
- Free-drive collision counts once and pauses until Start explicitly resumes
  from rest into a gap. DRIVE_DURATION_S/live duration counts running ticks,
  including dwell/gaps but excluding collision pause. Duration or Stop freezes
  the scoreboard and cancels work; Reset preserves run kind and chosen duration.
  Score slow decisions at application, not twice for two checkpoints; allowed
  is permission, not necessarily applied. Both refusal-reason counters can rise.
- Keep logs bounded and clean up SSE clients/timers. Preserve the slow gate
  decision on its advice card independently of the scrolling fast gate log.

## Recordings, configuration, and presentation

Native Node `.env` loading is optional; shell variables win. `.env` is excluded
by `.gitignore`. The live resource endpoint and deployment names are configured
locally. Never log tokens/keys or include them in recordings.

`fixtures\latency.json` is the authoritative local 20-request calibration:
p50 141.8 ms / p95 200.2 ms, selecting 400/350 ms. Do not replace measurements
with vendor claims or fabricate new samples. Rehearse on the presentation
network or worst accessible connection; record the actual network used.

`fixtures\recorded.json` contains real synthetic-input responses. Ambiguous
samples are explicitly curated for the [0.35, 0.5) teaching moment, not presented
as an unbiased benchmark. Preserve the real cold-call latency in offline replay
so missed-deadline handling remains demonstrable. Replay indices reset per run.

Use focused Node tests with controlled promises/clock seams; no extra framework.
Rehearse the four moments in README, all modes, and one/two independent gate
refusals through Playwright. Keep inline SVG, large projected type, and the
reference pitch's `--cp-*` variables/typeface/card treatment. Preserve provenance
and toy-world limitations in README.
