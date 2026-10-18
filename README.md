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
SSE is authoritative in both views. A backpressured connection retains only its
latest pending snapshot and resumes on drain, rather than disconnecting or
queuing an unbounded history.

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
height. A narrow **live tuning rail** is visible on the left by default, with
speed, damage-threshold and temperature sliders and a staleness stepper.
The named **Scenario** dropdown resets, applies settings, and waits for Start;
it never starts a run. Editing a setting returns it to **Custom**.
Details starts closed and contains the exact captured sensor
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
remain labelled as history; the freshness bar shows elapsed observation age
and a movable amber staleness-limit marker on the same tick scale (at least
0-10 ticks, expanded for larger ages or limits). The rail converts the limit
to seconds. Temperature shows the actual grip tier and swerve limit; selected
speed has its own marker beside the actual-speed display.
Allowed advice is not presented as an applied action until the snapshot says so.

| Control | Action |
|---|---|
| Space / Start | Start the world; enable modest synthesised audio after interaction |
| R / Reset | Cancel the run and return to idle |
| Details / Close / Escape | Show or hide sensor input and full decision details |
| T / Tuning tab | Collapse or reopen the live tuning rail |
| P / Present | Hide the rail and show a scenario-name caption; press again to restore the rail |
| M / Sound | Toggle mute |
| F / Fullscreen | Enter or leave fullscreen |
| Confident elk | Fast only, Elk, 90 km/h, threshold 0.35, 12 °C, staleness 3 |
| Ambiguous hazard | Fast only, Ambiguous, 90 km/h, threshold 0.35, 12 °C, staleness 3 |
| Late advice refused | Async + gated, Elk, 90 km/h, threshold 0.35, -4 °C, staleness 3 |
| Allowed swerve | Async + gated, Elk, 90 km/h, threshold 0.35, 12 °C, staleness 6 |
| Free drive (Details) / Stop | Select live-only continuous episodes / end with a scoreboard |

Presets reset first and apply the existing commands serially, then wait for
**Start**. Mode and hazard remain locked until Reset, with a **Reset to change**
hint. Slider values, instrument markers and scenario labels follow authoritative
SSE snapshots, not potentially older control-response bodies. A reset-required
mode/hazard response triggers Reset before one retry; other errors remain explicit.
Shortcuts do not steal
keystrokes from editable controls; focused buttons retain normal keyboard use.
The single scenario/settings/description table lives in `client\cockpit\controls.ts`.
Use the rail for Blocking mode, Small animal, or other tuning settings.
The old numbered buttons and 1-4 shortcuts are removed from the cockpit only;
the 2D page is unchanged.

Before an outcome the cockpit shows only the sensor contact, even with an
explicit Elk selection. Animal identity is revealed only from `world.identity`.
The labelled thermal/radar overlay can show contacts beyond the headlights and
fog; the contact is projected from its sensor lane and range into the windshield,
including during lane changes. Its range caption sits beside the contact rather
than on the lane markings. The terminal reveal does not move a distant animal closer.
Cockpit-only `*-cutout.png` assets remove the supplied images' white matte;
the original 2D assets are unchanged. Revealed world cutouts use headlight-reactive
materials at the reported range and fade in over 300 ms. There is no corner
animal card. A distant stopped hazard therefore remains small; its identity
caption is readable without pretending that headlights reach it.
Only a real collision triggers the brief full-view cutout, pale flash, camera
shake and collision overlay. That impact illustration is not a second world
object or an invented outcome.
Thin dashed markings fade out close to the camera instead of becoming heavy
foreground slashes. Asphalt sheen, a faint horizon glow, soft brake-light falloff,
hood edge and A-pillars frame the view. The mirror shows the existing observed
vehicle behind, not additional traffic.
The enlarged steering wheel sits in a reserved bottom-centre dashboard space;
REFLEX and Adviser are on its left and the gate is on its right. The risk
number is below, not on top of, its dial. A large envelope bounces back on a
real refusal or passes the gate on a real allowance; reconnection does not
replay old deliveries. Full action, rationale and application details remain
in Details.
Road displacement follows reported distance, lane motion follows reported turn
progress, and smoothing only trails known state. Traffic retains its world-backed
fixed relative gaps. Reduced-motion mode disables shaking, roll and animations.
Sound is synthesised locally and can be muted before Start.

Rehearse each named scenario at projector resolution in STUB mode. Include an
Ambiguous threshold edit to 0.50, both independent gate refusals, reset while
thinking, and the three-tick lane change and recovery to selected speed after
clearing the contact's lane. Two refusals at 90 km/h are not guaranteed after braking
reduces actual speed. A preset never forces a result. Check performance on the venue laptop;
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
Free drive has no explicit audience-selected hazard: both views conceal generated
identity until an outcome, and the public `hazardVariant` is null.

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
| Supersession | Async + gated, Elk, 90 km/h, 12 °C, threshold 0.35, staleness 6. The first recorded slow swerve is allowed (normal grip, limit 110 km/h), releases the fast brake and starts lane change 2 -> 3. After the turn, braking releases and actual speed recovers to 90 km/h. |

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
While a turn is in progress, fast damage-risk braking can re-engage because the
car still occupies its original lane. After all three ticks, a contact in the old
lane is outside its path: high, refused/unknown, failed and missed-deadline fast
answers no longer keep the brake engaged. The car recovers toward selected speed
at `ACCEL_MPS2` (default **2.0 m/s²**), never accelerating during the turn.

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
In staged moments both reasoning modes continuously reassess: after an assessment has been evaluated,
the next running tick sends a fresh observation. There is at most one slow request
in flight and no new request while earlier advice awaits application. Observation
age restarts at capture, never at arrival. During reassessment the card labels the
last completed result **Previous assessment** separately from the current input's
age. Live runs make additional paid reasoning calls, bounded by completion and
the tick cadence, not overlapping calls. Service errors remain visible and stop
automatic reassessment until Reset; they are not silently retried.
New assessments stop when the physical episode ends. Already-pending advice
retains the existing terminal-state behavior described below.
In staged moments collision/completed passage freeze motion/actions, but pending advice can still
age and be displayed/checked. A stopped `braked` state can still be revised by pending,
permitted advice; collision and completed passage cannot. Releasing a brake does
not instantly increase speed. Recovery is integrated only once fully outside the
sensed contact's path. Later fresh fast actions can brake again while in its path,
but do not cancel the physical lane change already in progress. During a turn,
the car still occupies the hazard lane until it finishes; it cannot teleport
past a contact. The Ambiguous contact's identity is revealed only after an outcome.

## Free drive (live only)

Use **Free drive** in either view, or choose **Run: Free drive** in Details.
Selection resets the world and chooses Async + gated; edit the mode before Start
if desired. Presets **1-4 always return to staged moments**, with their original
settings. Free drive is disabled in STUB, including on the server: the checked-in
slow recommendation fits only the staged scene. It has not been silently reused
for other lanes/traffic, and no paid recordings were added.

Set **Drive duration (s)** before or during a run (integer 1..3600). Start begins
a seeded sequence of contacts in the car's current lane, with elk, small-animal
or ambiguous sensor descriptions and seeded neighboring-lane traffic. Ambiguous
contacts also have a seeded hidden physical identity. `DRIVE_SEED` repeats the
sequence for the same lane history; model timing/actions can change that history.
The road and model inputs still share the same observation code and fixed-gap
traffic; the cumulative odometer prevents the road jumping backward at a spawn.

After a completed passage, a moving, contact-free gap precedes the next episode.
After stopping before a contact, a dwell of `DRIVE_DWELL_S` precedes an explicitly
logged **scenario clearance**, not a model decision. The gap then allows physical
acceleration back toward selected speed. Defaults are **3 s dwell / 15 s gap**;
the default gap exceeds the 12.5 s needed to recover from rest to 90 km/h at
2 m/s². Dwell/gap transitions occur on clock ticks (rounded up; even zero waits
until the next tick). There are no model calls during dwell, gap or pauses.

A collision counts once and **pauses**. **Start** explicitly clears that crashed
episode as a scenario event and resumes from rest into a gap; it does not reset
the score. Running-time duration includes dwell and gaps but excludes collision
pauses. Duration expires on the first clock boundary at or beyond its limit;
shortening it below elapsed time ends immediately. **Stop** ends even during a
collision pause. Both show the final scoreboard; **Reset** starts over, preserving
the selected run kind, live duration, speed, temperature and staleness limit.

In reasoning modes there is **at most one slow request per free-drive episode**,
with no automatic retry, even after refusal or failure. Both fast and slow work
carry episode ownership; resolving, stopping or resetting cancels pending work.
Late advice from a completed episode cannot apply to another. Gate proposal and
application checks and same-tick fast priority are unchanged.

The scoreboard counts contacts faced, actual stops before contact, completed
swerved passages, gate-allowed/refused slow advice, each refusal reason,
collisions and unsuppressed fast deadline misses. Allowed does **not** mean applied:
same-tick priority or an invalid target can still prevent application. A single
refusal may count in both reason totals. Safe small-animal passage without a stop
or swerve counts as faced but neither avoidance category. Interrupted episodes
are not recorded as successes.

**Expected billable requests:** at the default 400 ms clock, uninterrupted active
hazard ticks send **150 Decision-1 requests per minute** (151 if counting both
endpoints of a 60-second interval). Episode-start requests occupy those ticks;
only the initial Start additionally captures tick zero. Each request contains
**both** predicates, not two billable calls.
Reasoning modes add **one GPT-5.4 request per episode started**; Fast only adds
none. For a full running minute, count the actual active request ticks, at most
about 150 fast calls (boundary/start effects aside), and the episodes begun in it.
Dwell, gaps and collision pauses reduce this; there is no fixed slow calls/minute
independent of outcomes. The existing shared **50 ms** live request spacing is
unchanged. This is a call budget, not a price estimate.
For example, 20-second active episodes followed by the default roughly 15-second
gap average about **86 fast + 1.7 slow requests/minute** in a reasoning mode,
not a measured prediction of live model behavior.

Offline verification of free-drive lifecycle uses injected mock services through
the real simulation/server and is labelled **MOCK MODEL TEST / NO PAID CALLS**.
Those screenshots are not Foundry responses or additional recorded fixtures.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `FOUNDRY_ENDPOINT` | required live | HTTPS resource endpoint, e.g. `https://YOUR-RESOURCE.services.ai.azure.com` |
| `FOUNDRY_DEPLOYMENT` | `fast-decider` | Existing Microsoft Decision-1 deployment |
| `SLOW_MODEL` | `slow-reasoner` | Existing GPT-5.4 deployment for Responses |
| `STUB` | `0` | `1` disables all app network/model authentication calls |
| `TICK_MS` / `TICK_BUDGET_MS` | `400` / `350` | Fixed clock (minimum 50 ms) and fast deadline; budget must be smaller |
| `BRAKE_DECEL_MPS2` | `1.5` | Positive gradual braking deceleration |
| `ACCEL_MPS2` | `2.0` | Clear-path recovery acceleration in m/s² (0.01..100); no acceleration during turns |
| `DRIVE_SEED` | `42` | Unsigned 32-bit seeded hazard/adjacent-traffic sequence |
| `DRIVE_DURATION_S` | `120` | Initial live-editable running-time duration, integer 1..3600 seconds |
| `DRIVE_GAP_S` | `15` | Contact-free moving gap between episodes, 0..300 seconds |
| `DRIVE_DWELL_S` | `3` | Stopped-contact dwell before scenario clearance, 0..300 seconds |
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
actual offline replay, sensor-lane path checks, acceleration, seeded free-drive
episodes, cancelled/late episode advice, dwell/clearance, collision pause/resume,
running-time duration and scoreboard counts.

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
