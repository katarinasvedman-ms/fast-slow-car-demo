# Fast / Slow

A local, fixed-clock toy world: Microsoft Decision-1 makes fast probability
decisions, GPT-5.4 returns asynchronous advice, and a deterministic gate decides
what may happen. **The world does not wait. Advice expires. Agreement is not
authority.** Both models run in Foundry; no direct OpenAI account is required.

## Run locally

Requires Node 22.16+ and npm. Live mode also needs Azure CLI, an existing
`az login` with model-inference access, and deployed Decision-1 / GPT-5.4 models.
Tokens are cached in process memory; the resource's Entra-only policy is unchanged.

Decision-1 is limited to 60 requests/second. The default loop makes 2.5/s;
the live adapter additionally spaces requests by at least 50 ms (a conservative
20/s ceiling), including across resets. Calibration is sequential and paced too.
Do not run multiple live apps/probes against the same deployment concurrently.

For a new checkout, copy `.env.example` to `.env` and set `FOUNDRY_ENDPOINT` to
your resource endpoint, not the project URL. This workspace already has a local
`.env` configured for the supplied resource; `.gitignore` excludes it.

```powershell
npm ci
npm run build
npm start
```

Open `http://127.0.0.1:3000`. One process serves the page, controls, and SSE on
loopback. Models are invoked only after **Start**. **Reset** cancels old work.

For completely offline rehearsal, no credentials or Azure CLI are needed:

```powershell
$env:STUB = '1'
npm start
```

Restore live mode with `$env:STUB = '0'` and restart. Native Node environment-file
loading is used; shell variables override `.env`. The STUB badge identifies
recorded output. Slow replay is held for five simulation ticks by default;
the displayed model latency is the original recorded call, not an added live delay.

## Night Drive cockpit

Open `http://127.0.0.1:3000/cockpit.html?clawpilotTheme=dark`, or follow
**Night Drive cockpit** from the original page. This separate first-person view
uses the same world, SSE stream, controls, physics, and gate. Opening both pages
does not create separate runs; Reset in either page resets the shared world.
The **2D explainer** link returns to the original view.

The road fills the viewport behind a translucent dashboard capped at 28% of its
height. Presenter mode starts with **Details** closed; the visible 1-4 buttons
still select moments. Details contains the control strip, exact captured sensor
input, full rationale, application/supersession messages and tick history.
Main-view text is at least 28 px, with larger speed and gate verdicts, and does
not scroll. The Adviser shows one clipped rationale sentence, not a text feed.

The windshield uses locally served Three.js **0.186.1**, MIT licensed; the
licence is in `public\vendor\THREE-LICENSE.txt`. `npm run build` copies the pinned
browser modules into `public\vendor` and compiled cockpit code into the ignored
`public\cockpit-app` directory. No bundler, CDN, framework, extra model calls,
or downloaded 3D models are used. Once installed and built, STUB mode needs no
network access. A WebGL failure is reported explicitly; the dashboard remains
usable and the 2D view remains available.

**REFLEX** shows damage probability, the actual threshold notch, accepted-result
latency and deadline misses. **THE GATE** shows the latest slow freshness and
permission checks independently, including both reasons when refused.
**ADVISER** shows elapsed ticks, not an invented completion percentage.
During reassessment the previous recommendation and its gate/application result
remain labelled as history; the freshness bar tracks the current observation.
Allowed advice is not presented as an applied action until the snapshot says so.

| Control | Action |
|---|---|
| Space / Start | Start the world; enable modest synthesised audio after interaction |
| R / Reset | Cancel the run and return to idle |
| Details / Close / Escape | Show or hide controls, sensor input and full decision details |
| P / Present | Switch between the clean presenter view and open details |
| M / Sound | Toggle mute |
| F / Fullscreen | Enter or leave fullscreen |
| 1 | Fast only, Elk, 90 km/h, threshold 0.35 |
| 2 | Fast only, Ambiguous, 90 km/h; repeat to alternate threshold 0.35 / 0.50 |
| 3 | Async + gated, Elk, 90 km/h, -4 °C, staleness 3 |
| 4 | Async + gated, Elk, 90 km/h, 12 °C, staleness 6 |

Presets reset first and apply the existing commands serially, then wait for
**Start**. Mode and hazard remain locked during a run. Shortcuts do not steal
keystrokes from editable controls; focused buttons retain normal keyboard use.
Captions live in `client\cockpit\controls.ts`. Use the control strip in Details for Blocking
mode, Small animal, or other speed/temperature/threshold/staleness settings.

Before an outcome the cockpit shows only the sensor contact, even with an
explicit Elk selection. Animal identity is revealed only from `world.identity`.
The labelled thermal/radar overlay can show contacts beyond the headlights and
fog; the terminal identity overlay does not move a distant animal closer.
Cockpit-only `*-cutout.png` assets remove the supplied images' white matte;
the original 2D assets are unchanged. Revealed world cutouts use headlight-reactive
materials at the reported range and fade in over 300 ms. The separate labelled
outcome callout scales with range, but is not a claim of headlight visibility.
Road displacement follows reported distance, lane motion follows reported turn
progress, and smoothing only trails known state. Traffic retains its world-backed
fixed relative gaps. Reduced-motion mode disables shaking, roll and animations.
Sound is synthesised locally and can be muted before Start.

Rehearse presets 1-4 at projector resolution in STUB mode, including the second
press of 2, both independent gate refusals, reset while thinking, and the
three-tick lane change. Two refusals at 90 km/h are not guaranteed after braking
reduces actual speed; likewise, later fast braking may resume after an allowed
turn. A preset never forces a result. Check performance on the venue laptop;
the implementation caps rendering pixel ratio and avoids shadows, but does not
promise a frame rate on untested hardware.

## Road and model input

The blue vehicle in lane 1 is the observed vehicle **20 m behind** the pink ego
car. Lane headers mark blocked/clear traffic; green zones show the stated
**100 m clearance**. Hazard range, road condition, and sensor description are
visible alongside the road. Distances use one shared road scale; car icons are
not to scale. The other vehicle is co-moving scenery with a fixed relative gap,
not an independently simulated traffic participant.

Observation text and scene data share `observeScene` and world-backed distances,
so the renderer does not invent objects or duplicate the observation constants.
**What the models see**, beside the road in the World card, is collapsed by
default. It displays the exact captured input with its tick, not text rebuilt
after an action or speed edit. Before Start it is labelled as an unsent preview;
after movement stops the last sent tick remains explicit. Current-world controls
may change after capture; the next model tick captures those changes.
Gate, threshold, collision, and model-decision rules are unchanged by this scenery.
Selecting Elk immediately shows the supplied moose image on the road; Small
animal shows the squirrel image from `public\images`, including after Reset.
These are audience-only previews selected from the dropdown; models still receive
sensor text only. Ambiguous keeps the unidentified contact marker until an outcome
reveals its identity.

## Rehearse the four moments

Use **Reset** before changing mode or hazard. Speed, outside temperature,
threshold, and staleness limit stay live. Temperature starts at **12 °C** and
is editable beside speed (-20..30 °C); temperature and staleness survive Reset.
The **Deterministic gate** card shows current temperature, grip tier and active
swerve limit. This trusted vehicle-sensor value is used only by the gate:
neither model receives it, and recorded fixtures are unchanged.
The staleness input is in the **Deterministic gate** card;
its explanation converts ticks to simulation time using the current clock.
Braking is revisable: a later gate-allowed action can release an earlier brake.
A newly applied fast action wins a same-tick conflict. Reaffirming an already
engaged action does not change its original application tick.

| Moment | Controls and expected result |
|---|---|
| Confident elk | Fast only, Elk, 90 km/h, threshold 0.35. Risk is high and braking fires. The recorded cold call also visibly demonstrates one deadline default. |
| Ambiguous hazard | Fast only, Ambiguous, threshold 0.35. Recorded risk is 0.4073 (displayed 0.41): brake, even though it is below 0.5. Reset and use threshold 0.5 to contrast continuing. |
| Late advice | Async + gated, Elk, 90 km/h, -4 °C, threshold 0.35, staleness 3. At five ticks in STUB mode, the recorded swerve is refused for both `stale_advice` and `prohibited_action` (ice risk, limit 40 km/h). |
| Supersession | Async + gated, Elk, 90 km/h, 12 °C, threshold 0.35, staleness 6. The first recorded slow swerve is allowed (normal grip, limit 110 km/h), releases the fast brake and starts lane change 2 -> 3. |

For a **temperature-only contrast**, use staleness **6** in both runs and change
only temperature: **-4 °C** refuses for speed alone, **12 °C** allows the same
advice. The two table presets deliberately also contrast staleness 3 versus 6;
they are not a one-variable experiment.
For the independent stale-only variant, keep **12 °C** and staleness **3**.
That is a valid result, not a broken run.
Tune `BRAKE_DECEL_MPS2` and `INITIAL_HAZARD_DISTANCE_M` against real latency during
rehearsal; do not fake the speed or refusal reasons to force both to fire.

To demonstrate **slow advice superseding a fast brake** in recorded replay,
reset and choose **Async + gated**, **Elk**, **90 km/h**, **12 °C**, threshold
**0.35**, and staleness **6** for the default five-tick replay. In normal grip
the active limit is **110 km/h**, so the
captured slow swerve releases the earlier brake and starts a **three-tick**
lane change from 2 to 3. The highlighted supersession line, allowed application
record with `supersedes #M`, brief road marker, lane readout, and persistent slow
card make the change visible. Reset and change **only temperature to -4 °C**,
leaving staleness **6**: the first advice is prohibited (ice risk, **40 km/h**)
and the car keeps braking. Continuous reassessment
can then permit a later turn once actual speed has fallen below the current limit; a
90 km/h starting setting no longer guarantees an in-lane stop. With limit **3**,
every default five-tick replay assessment remains stale.
The replay reuses the documented captured elk recommendation on each assessment,
not a new model-generated plan. It does not adapt its target: after reaching lane
3, the repeated lane-3 swerve is reported as invalid. Live model actions/timing
vary, and no advice is fabricated or forced to apply.

**What does 6 mean?** It permits an observation age of six simulation ticks;
age seven is stale. With the default 400 ms clock, six ticks represent 2.4
seconds of tick time, not six seconds or an added model delay. Use **3** for
the strict stale-advice demonstration, or **6** to give the default five-tick
replay one tick of headroom. Larger values accept older observations. For live
reasoning, compare with the displayed observation age; six may not be enough.
The independent speed rule and same-tick fast priority still apply. Changes affect
future gate checks, not advice already refused; a new assessment uses a genuinely
fresh observation rather than retrying the old action. The chosen
limit survives Reset; server restart restores `STALENESS_LIMIT_TICKS`.
Temperature changes affect future proposal/application checks only; they do not
retry refused advice, cancel an applied turn, alter braking physics or change
same-tick priority. Both checkpoints resolve the current sensor value, not the
temperature at model observation. The three default tiers are **normal grip**
(above 4 °C, 110 km/h), **frost risk** (above 0 through 4 °C, 70 km/h), and
**ice risk** (0 °C or below, 40 km/h). Fractional temperatures are accepted;
0.5 °C is frost risk. Equality with the speed limit is permitted.

**Blocking** keeps the world moving but suppresses fast actions and deadline
braking while advice is pending. **Async + gated** keeps fast actions active.
**Fast only** never calls the slow model. Both gate checks are logged; the
advice card retains the slow action's decision even as the fast gate log scrolls.
Both reasoning modes continuously reassess: after an assessment has been evaluated,
the next running tick sends a fresh observation. There is at most one slow request
in flight and no new request while earlier advice awaits application. Observation
age restarts at capture, never at arrival. During reassessment the card labels the
last completed result **Previous assessment** separately from the current input's
age. Live runs make additional paid reasoning calls, bounded by completion and
the tick cadence, not overlapping calls. Service errors remain visible and stop
automatic reassessment until Reset; they are not silently retried.
New assessments stop when the physical episode ends. Already-pending advice
retains the existing terminal-state behavior described below.
Collision/completed passage freeze motion/actions, but pending advice can still
age and be displayed/checked. A stopped `braked` state can still be revised by pending,
permitted advice; collision and completed passage cannot. No acceleration is
invented when releasing a brake. Later fresh fast actions can brake again,
but do not cancel the physical lane change already in progress. During a turn,
the car still occupies the hazard lane until it finishes; it cannot teleport
past a contact. The Ambiguous contact's identity is revealed only after an outcome.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `FOUNDRY_ENDPOINT` | required live | HTTPS resource endpoint, e.g. `https://YOUR-RESOURCE.services.ai.azure.com` |
| `FOUNDRY_DEPLOYMENT` | `fast-decider` | Existing Microsoft Decision-1 deployment |
| `SLOW_MODEL` | `slow-reasoner` | Existing GPT-5.4 deployment for Responses |
| `STUB` | `0` | `1` disables all app network/model authentication calls |
| `TICK_MS` / `TICK_BUDGET_MS` | `400` / `350` | Fixed clock (minimum 50 ms) and fast deadline; budget must be smaller |
| `BRAKE_DECEL_MPS2` | `1.5` | Positive gradual braking deceleration |
| `INITIAL_HAZARD_DISTANCE_M` | `500` | Initial contact distance |
| `STALENESS_LIMIT_TICKS` | `3` | Initial live-editable UI limit; refuse observation age strictly greater than this |
| `SWERVE_SPEED_LIMIT_NORMAL` | `110` | Normal-grip swerve limit in km/h (0..130) |
| `SWERVE_SPEED_LIMIT_FROST` | `70` | Frost-risk swerve limit in km/h (0..130) |
| `SWERVE_SPEED_LIMIT_ICE` | `40` | Ice-risk swerve limit in km/h (0..130) |
| `FROST_RISK_TEMP_C` | `4` | At or below this temperature, use frost risk unless already ice risk (-20..30 °C) |
| `ICE_RISK_TEMP_C` | `0` | At or below this temperature, use ice risk; must be below `FROST_RISK_TEMP_C` (-20..30 °C) |
| `STUB_SLOW_DELAY_TICKS` | `5` | Advice age at arrival in recorded replay only |
| `PORT` | `3000` | Loopback HTTP port |
| `BENCHMARK_NETWORK` | required for probe | Label the connection used for timing calibration |

## Local latency calibration and recordings

The local measurement is authoritative, not a comparison with another model.
Twenty actual two-predicate requests, no retries, nearest-rank percentiles:

| Model | Successful / attempted | p50 ms | p95 ms | Selected tick / budget |
|---|---:|---:|---:|---|
| Microsoft Decision-1 | 20/20 | 141.8 | 200.2 | 400 / 350 ms |

Raw samples are in `fixtures\latency.json`, measured on the current local
connection. The cold first request took 433.2 ms and is preserved in offline
replay to exercise deadline handling. The presentation network is unverified:
remeasure there when possible, or on the worst accessible connection.

After building, these direct Node commands work in PowerShell:

```powershell
# Authentication/configuration preflight; no inference:
node --env-file-if-exists=.env dist\scripts\benchmark.js --check
# Authorize 20 billable Decision-1 requests and replace the timing artifact:
node --env-file-if-exists=.env dist\scripts\benchmark.js --allow-paid-requests
# Authorize up to 16 decisions and one reasoning call to refresh replay:
node --env-file-if-exists=.env dist\scripts\record-fixtures.js --allow-paid-requests
```

The timing probe writes measured recommendations, not runtime overrides.
Use 400/350 ms for p95 <=350 ms; 600/550 ms for p95 >350 through 550 ms;
above 550 ms keep 400/350 ms and show safe-default misses. Update `.env` and
this table after remeasuring. Failures are reported, not silently dropped.

`fixtures\recorded.json` contains real responses to synthetic observations.
Ambiguous samples are explicitly curated into [0.35, 0.5) for repeatable rehearsal;
live probabilities vary and may fall below the threshold. The slow fixture is
one canned elk-observation recommendation reused in stub mode. No credentials,
endpoint, or hidden reasoning are stored in fixtures. The SDK named `openai`
is used only as a client for Foundry's Responses API.

## Checks

```powershell
npm run typecheck
npm test
# After building, run one test file or one matching test:
node --test dist\tests\simulation.test.js
node --test --test-name-pattern="deadline applies" dist\tests\simulation.test.js
```

Tests cover policy boundaries/refusals, independent gate rules, physical outcomes,
observation privacy, deadline/late-result handling, modes, reset and terminal
lifecycle, same-tick fast priority, brake supersession, three-tick lane occupancy,
and actual offline replay.

## Provenance and limitations

The typed-envelope / two-check governance pattern comes from
`katarinasvedman-ms/agentic-harness-validation`; no governance code is copied.
Inline styling reuses the referenced pitch page's dark CSS variables, typeface
stack, and card treatment. Docker remains an optional follow-up; Azure
application deployment is not part of this local demo.

This is a toy world on a fixed clock, not a driving system. Tick intervals are
hundreds of milliseconds and the hazard model is synthetic. The demo illustrates
coordination and control patterns; it makes no claim about real-time guarantees,
vehicle safety, or verified behaviour.
