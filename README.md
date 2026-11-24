# Fast / Slow

A local, fixed-clock toy world: Microsoft Decision makes fast probability
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
your resource endpoint, not the project URL. Configure your existing deployment
names there too. `.env` is local and excluded by `.gitignore`; a checkout does
not include the presentation machine's Azure configuration or tuning.

```powershell
npm ci
npm run build
npm start
```

Open **`http://127.0.0.1:3000/cockpit.html`** for the main Night Drive view.
Live startup is **Continuous / until Stop**, with a seeded mix of contacts and
a persistent following car. There is no Scenario or Hazard selector.
Set the individual controls, then press **Start**. Successful encounters lead
to more encounters; an impact pauses for inspection and Start resumes from rest.
**Stop** ends the run with a scoreboard. **Reset** cancels old work and keeps
your selected run type and tuning. Startup speed is **110 km/h**; selecting
90 km/h is a manual edit, not a preset.

One process serves both views, controls, and SSE on loopback.
`http://127.0.0.1:3000/` is the secondary 2D explainer, which still has the
four original single-contact teaching buttons. Models are invoked only after
**Start**, never just by opening the page or changing idle controls.
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
**Night Drive cockpit** from the 2D page. This first-person view
uses the same world, SSE stream, controls, physics, and gate. Opening both pages
does not create separate runs; Reset in either page resets the shared world.
Open `/` directly when you need the separate 2D explainer.

The windshield sits above three dashboard cards, ordered
**REFLEX | THE GATE | ADVISER**, with the **Controls** band below the cards at
the bottom. The group is centered at 90% width (up to 1800 px), leaving space
on both sides. Cards and controls together occupy **at most 46% of viewport height**,
below the 50% ceiling.
The Adviser is widest. Compact spacing and proportional fitting keep the entire
lower panel inside that budget as advice, window size or control visibility changes,
without cropping the rationale or introducing main-view scrollbars.
The band is open by default: **Run**, **Mode**, then paired number inputs
and sliders for **Speed**, **Damage threshold**, **Staleness** (0-10 ticks)
and **Outside temperature**. Short explanations describe what each control does.
The layout reserves separate rows for the windshield, controls and instruments,
including on short wide windows; the connection, backend and tick badges stay
together at the top right.
There are no named presets, Custom label or hazard dropdown in the cockpit.
Continuous contacts are generated from the seeded sequence; a control edit
does not secretly select another scenario or change the other tuning values.
Details starts closed. Its opaque drawer has a fixed close header, compact
14 px captured-input text near the top, and grouped sensor, gate, application
and full-advice cards. The optional time limit, tick history and teaching notes are
collapsed by default; the content scrolls independently of the header.
Controls use compact labels. The Adviser shows its full rationale
at a 20 px base size without an ellipsis, observed/arrived ticks, model latency
and the freshness bar. The verdict and speed remain large. Both gate lamps
answer **FRESH ENOUGH? / WITHIN LIMITS?** with YES/NO; each real refusal detail
is shown in words on the card, independently of the current temperature setting.

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
0-10 ticks, expanded for larger ages or limits). The band converts the limit
to seconds. Temperature shows the actual grip tier and swerve limit; selected
speed has its own marker beside the actual-speed display.
Allowed advice is not presented as an applied action until the snapshot says so.

| Control | Action |
|---|---|
| Space / Start | Start the world; enable modest synthesised audio after interaction |
| R / Reset | Cancel the run and return to idle |
| Details / Close / Escape | Show or hide sensor input and full decision details |
| T / Controls tab | Collapse the band to its slim control bar, or reopen it |
| P / Present | Hide the controls; press again to restore them |
| M / Sound | Toggle sound on/off, including with controls hidden or in presenter mode |
| F / Fullscreen | Enter or leave fullscreen |
| Run | Continuous / until Stop, or explicitly select Single contact / staged |
| Mode | Fast only: no reasoning; Blocking: fast waits while the world moves; Async + gated: both operate asynchronously |
| Speed | Selected target; does not jump actual speed or cancel braking |
| Damage threshold | Hard-brake risk cutoff when no fast turn is eligible |
| Staleness | Maximum advice age in ticks; the help text converts to seconds, not a model timeout |
| Outside temperature | Trusted gate sensor determining the current steering limit; never model input |
| Stop | End continuous driving with a scoreboard |

There is no cockpit Scenario or Hazard selector, or hidden preset bundle. Live startup
defaults to **Continuous**, with no time limit; each successful encounter leads
to another, rather than freezing after a single passage. Impacts still pause for
inspection; Start resumes from rest. STUB remains explicitly single-contact replay.
Run selection resets the world and sets up continuous following traffic or a
single staged contact, without changing mode, speed, temperature, threshold or
staleness. It never starts inference. Mode and run type remain locked until Reset,
with a **Reset to change** hint. Slider values and instrument markers follow authoritative
SSE snapshots, not potentially older control-response bodies. A reset-required
mode/hazard response triggers Reset before one retry; other errors remain explicit.
Shortcuts do not steal
keystrokes from editable controls; focused buttons retain normal keyboard use.
Use the individually labelled controls and their inline explanations.
The old numbered buttons and 1-4 shortcuts are removed from the cockpit only;
the 2D page retains them.

### Showing the asynchronous handoff

Stay in **Continuous**, choose **Async + gated**, and tune the controls directly.
A useful starting point for the current close-contact rehearsal is **90 km/h**,
**12 °C**, **damage threshold 0.35** and **staleness 10** (4 seconds at the
default clock). This does not select an animal or guarantee a successful turn.

The fast actor may slow or brake immediately, and can itself propose a turn only
at **40 km/h or below**, with sufficient lane-clear confidence and a sensor-eligible
route. Slow advice can propose a turn **above 40**: it has no actor-specific cap,
but the shared gate still checks freshness and the current temperature limit.
Follow the execution strip to distinguish **FAST** from **SLOW**, gate permission
from actual application, and application from physical turn completion.

| Outside temperature | Gate tier | Gate steering limit |
|---|---|---|
| Above 4 °C | Normal grip | 110 km/h |
| Above 0 through 4 °C, including 2 °C | Frost risk | 70 km/h |
| 0 °C or below | Ice risk | 40 km/h |

These are the default configurable limits. Fast turns also retain their 40 km/h
actor cap. Temperature is a trusted sensor for the deterministic gate, never
model input; it does not change braking physics or cancel a turn already started.
Permission is checked again using actual speed and temperature at application.

Staleness is **not a model timeout**. Raising it accepts older observations;
it does not make reasoning faster or create more physical room. If the car
reaches 40 first, fast may turn before advice arrives. If advice remains pending
at impact, it cannot rescue that contact. More starting distance, lower selected
speed or faster advice can change the opportunity; neither a turn nor an outcome
is scripted.

### Local rehearsal tuning versus code defaults

The current presentation setup uses these non-secret `.env` overrides:

```dotenv
BRAKE_DECEL_MPS2=9
GENTLE_DECEL_MPS2=4
GENTLE_SPEED_KMH=40
INITIAL_HAZARD_DISTANCE_M=80
FOLLOWING_VEHICLE_DISTANCE_M=80
DRIVE_DURATION_S=0
```

These are not all repository defaults. In particular, emergency deceleration
defaults to 1.5 m/s², configured gentle deceleration to 3 m/s² (capped at emergency
deceleration), and initial contact distance to 500 m. Restart the server after
editing these environment settings; Reset alone does not reload them.
Starting distance and braking deceleration are not cockpit controls.

Beyond 150 m the cockpit shows only the sensor contact, even if a staged
selection was made in the 2D view. At **150 m or closer**, the animal appears for the audience
while driving, so it can be seen before a safe pass. Identity comes only from
the audience-facing `world.identity`, never the dropdown. A terminal outcome
also reveals identity, including a stop farther away.
**Neither model receives the identity, image or reveal state**: both still get
the unchanged derived sensor text. This applies to Ambiguous and continuous driving too.
The labelled thermal/radar overlay can show contacts beyond the headlights and
fog; the contact is projected from its sensor lane and range into the windshield,
including during lane changes. Its range caption sits beside the contact rather
than on the lane markings. Revealing an animal never moves it closer.
Cockpit-only `*-cutout.png` assets remove the supplied images' white matte;
the original 2D assets are unchanged. Revealed world cutouts use headlight-reactive
materials at the reported range and fade in over 300 ms. There is no corner
animal card. A distant stopped hazard therefore remains small; its identity
caption is readable without pretending that headlights reach it.
Only a real collision triggers the brief full-view cutout, pale flash, camera
shake and collision overlay. That impact illustration is not a second world
object or an invented outcome.
Thin dashed markings fade out close to the camera instead of becoming heavy
foreground slashes. Brighter headlight pools, emissive road edges and reflectors,
asphalt sheen, a lit horizon glow, soft brake-light falloff,
hood edge and A-pillars frame the view. The mirror shows the existing observed
vehicle behind, not additional traffic. Its rear-camera image is reflected
horizontally, so lane 1 stays left, and follows the car's reported lane throughout
a turn without moving the fixed-gap lane-1 traffic. Continuous rear threats
additionally show the physically simulated following vehicle in lane 2.
The smaller steering wheel sits at the bottom centre of the windshield,
partly behind the hood, never in a dashboard card. The risk
number is below, not on top of, its dial. A large envelope bounces back on a
real refusal or passes the gate on a real allowance; reconnection does not
replay old deliveries. The full rationale and provenance are on the main Adviser
card; application details, sensor input and history remain in Details.
Road displacement follows reported distance, lane motion follows reported turn
progress, and smoothing only trails known state. Traffic retains its world-backed
fixed relative gaps. Reduced-motion mode disables shaking, roll and animations.
Sound is synthesised locally and can be muted before Start.

For recorded rehearsal, use the four teaching moments on the 2D page at
projector resolution in STUB mode. Include an
Ambiguous threshold edit to 0.50, both independent gate refusals, reset while
thinking, and the three-tick lane change and recovery to selected speed after
clearing the contact's lane. Two refusals at 90 km/h are not guaranteed after braking
reduces actual speed. A preset never forces a result. Check performance on the venue laptop;
the implementation caps rendering pixel ratio and avoids shadows, but does not
promise a frame rate on untested hardware.

## 2D explainer and model input

In the original single-contact setup, the blue vehicle in lane 1 is the observed
vehicle **20 m behind** the pink ego car. Lane headers distinguish traffic from
clear lanes; green zones show the stated
**100 m clearance**. Hazard range, road condition, and sensor description are
visible alongside the road. Distances use one shared road scale; car icons are
not to scale. The other vehicle is co-moving scenery with a fixed relative gap,
not an independently simulated traffic participant. Live continuous driving
adds a separate moving follower, with its measured gap and relative speed
shared between both views and model observations.

Observation text and scene data share `observeScene` and world-backed distances,
so the renderer does not invent objects or duplicate the observation constants.
**What the models see**, beside the road in the World card, is collapsed by
default. It displays the exact captured input with its tick, not text rebuilt
after an action or speed edit. Before Start it is labelled as an unsent preview;
after movement stops the last sent tick remains explicit. Current-world controls
may change after capture; the next model tick captures those changes.
Gate, threshold, collision, and model-decision rules are unchanged by this scenery.
In the 2D staged view, selecting Elk immediately shows the supplied moose image on the road; Small
animal shows the squirrel image from `public\images`, including after Reset.
These are audience-only previews selected from the dropdown; models still receive
sensor text only. Ambiguous keeps the unidentified contact marker until the
150 m audience reveal or a terminal outcome.
Continuous driving has no explicit audience-selected hazard: both views conceal generated
identity until the 150 m audience reveal or a terminal outcome, and the public
`hazardVariant` is null.

## Recorded single-contact rehearsal (2D page)

This is the optional offline teaching workflow, not the default continuous
cockpit run. The 2D buttons **1-4** explicitly select staged runs. To reproduce
the recorded examples below, stop the server and start it in a separate
PowerShell session with the original physics, rather than the close-contact
presentation overrides:

```powershell
$env:STUB = '1'
$env:BRAKE_DECEL_MPS2 = '1.5'
$env:INITIAL_HAZARD_DISTANCE_M = '500'
$env:STUB_SLOW_DELAY_TICKS = '5'
npm start
```

Open `http://127.0.0.1:3000/`. Close this PowerShell session after rehearsal
to discard its shell overrides; restart normally for live continuous driving.
STUB does not authenticate or make model requests, and cannot run continuous
contacts or following-traffic encounters. Different physics or delays can
change the outcomes described below.

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
| Ambiguous hazard | Fast only, Ambiguous, threshold 0.35. Recorded risk is 0.4073 (displayed 0.41): brake, even though it is below 0.5. Reset and use threshold 0.5 to contrast gentle slowing instead of emergency braking. |
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
Fast now also has a bounded steering policy: at **<=40 km/h**, a known timely
answer with target-side lane-clear probability **>=0.9** may propose a specific sensor-clear
adjacent lane. It requires clear forward range covering the three-tick turn
plus 5 m. A tracked vehicle behind may share that lane only if its measured gap,
minus positive closing speed over the turn plus a two-second buffer, still leaves
at least 20 m. This assumes no helpful braking by that vehicle. Traffic ahead,
untracked rear traffic and unknown forward clearance remain ineligible. Right wins
ties, and an ongoing turn is never redirected. The route is checked again before
applying a fast turn. `FAST_SWERVE_SPEED_LIMIT_KMH` may lower, but not raise, the
40 km/h cap. `FAST_LANE_CLEAR_THRESHOLD` configures conservative screening;
neither this probability nor the simple route check proves a safe trajectory.

The live request contains **three `noul` questions in one HTTP call**: major
damage risk, **left-lane clearance**, and **right-lane clearance**. Left/right
are relative to the ego lane at observation, not the current lane after a turn.
Each question considers only its own adjacent target (ego lane minus/plus one),
requires 100 m of observed forward traffic clearance, and accounts for reported
rear gaps/closing speeds in that target. A nonexistent lane is not an escape.
Traffic in the ego lane or opposite candidate does not make the target occupied.

The controller requires the score for the **actual target side** to meet 0.9
and independently checks that route's sensors; a high left score can never
authorize a low/unknown-confidence right turn. An unknown side is ineligible;
one known eligible side can still be used. Both unknown means the in-path brake
fallback. Both views show the left/right scores and observation tick. The larger
numeric readout, **Best side clearance**, is simply the maximum known score for
display, not a measured union probability or a substitute for target validation.
These probabilities do not prove maneuver safety or better calibration.

Checked-in recordings retain their original two-question aggregate response and
timing. Replay displays **Recorded aggregate only**, without inventing directional
scores, and preserves its existing sensor-checked steering behavior. Only live
responses require both directional answer fields; a missing field is an explicit
service error, not a silent fallback to the old schema. The live model label
shows the configured deployment name rather than a hardcoded model version.

The shared gate remains authoritative over **both actors**. Its speed rule uses
the lower of the actor cap and current temperature limit for fast swerves;
slow proposals have no actor cap but must obey the same temperature limit.
Freshness is still the first rule, and both are rechecked at application.
The **Governed execution** strip shows separate limits and recent proposals,
gate refusals, allowed-but-not-applied decisions, applied actions, completed turns
and cancelled reasoning. A bounded 24-event history is independent of the fast
gate log; both views show its latest six events. Reset clears it.

For an isolated fast escape, use the 2D page's staged controls:
**Fast only**, **Small animal**, 50 km/h, 12 °C and staleness 10.
For slow steering above 40, use **Async + gated**, normal-grip temperature and
enough age allowance, but the live answer must still arrive before the physical
opportunity ends. These settings never force an answer or success. Stay in
**Continuous** when you want new contacts until Stop; it uses seeded contact types.
The four original teaching buttons remain on the 2D page, but fast-only is no longer
brake-only: once speed falls to 40, fast may escape before slow advice arrives.
Consequently, a late-advice run may no longer show both refusal lamps; inspect
actual speed/age and provenance rather than assuming old outcomes.

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
past a contact. The Ambiguous contact's identity is revealed to the audience
within 150 m or after an outcome, never added to either model's input.

## Rear threat (live-only staged scenario)

The isolated rear-threat setup remains available through the control API:
Reset, `run=staged`, `encounter=rear_threat`. Set Async + gated, Elk,
110 km/h, 12 °C and a 10-tick (4 s) advice limit, then Start.
The contact starts at `INITIAL_HAZARD_DISTANCE_M` (500 m if unset); a following vehicle starts
`FOLLOWING_VEHICLE_DISTANCE_M` behind in lane 2 (80 m by default)
at the same speed. Lane 1 has the existing traffic; lane 3 is observed clear.
This staged setup does not start automatically or change continuous driving.
To move the animal farther away, edit `.env` and restart the server; Reset alone
does not reload environment settings. Try `INITIAL_HAZARD_DISTANCE_M=80` for a
short warning, 45 for an especially tight encounter, or 300 for a distant contact.
This setting affects all staged scenes and continuous Rear threats.
The follower gap can be tuned separately with `FOLLOWING_VEHICLE_DISTANCE_M`;
the earlier 35 m setup is a tight rear-impact comparison, while the 80 m default
gives reasoning and a three-tick turn more room. Restart after editing either distance.

Use `BRAKE_DECEL_MPS2=9` in `.env` and restart for the emergency-braking rehearsal
(this workspace is configured that way). This is an environment setting, not a
scenario physics override; the original default remains 1.5 m/s².
The following driver reacts 1.6 s after the first braking or actual gentle-slowing action, then decelerates
at 4.5 m/s². Those are toy-world parameters, not claims about typical drivers.
The world keeps advancing after the ego car stops if the follower is approaching.
With a close follower (e.g. 35 m) at 90 km/h and 45 m forward range, hard braking
alone can stop before the animal yet still end in a rear collision.
At the 110 km/h highway default, braking distance is already about 52 m before
response delay, exceeding a 45 m forward range; a front impact can occur first.
Reducing the speed manually is an explicit comparison, not a hidden preset change.
The short ranges do not guarantee time for reasoning or a completed lane change;
the world and live model latency are not slowed to manufacture an avoidance.

Watch the mirror label (lane, range, actual follower speed and positive closing
speed), REFLEX, ADVISER and
THE GATE. Radar range, speed and closing speed reach both models as sensor text;
hidden reaction timing, animal identity and temperature do not.
Input explicitly names the ego lane, turn progress and all three observed lanes,
including the lane already occupied, so moving into lane 3 does not erase its
clearance reading. Traffic clearance is separate from the forward animal contact.
Compare Fast only with Async + gated by resetting before changing mode.
A timely, permitted lane change can avoid the rear path, but it takes three
physical ticks and remains vulnerable until it clears the lane. Rear impacts
say **STRUCK FROM BEHIND**, without displaying the animal-impact cutout.

Reasoning is not guaranteed to improve the result: it may retain braking, fail,
arrive late, lose a same-tick conflict or be refused. All existing age/speed gate
checks remain intact; no successful swerve is scripted. A longer initial gap can
also make braking alone sufficient. This remains a fixed-clock toy, not a
validated driving/safety model. STUB rejects this scenario because the existing
recordings do not cover the new traffic; no paid calls or recordings were made
to implement it.

## Continuous rear threats (live only)

Live startup defaults to **Run: Continuous / until Stop**. Set mode, speed,
temperature, threshold and staleness individually, then **Start**. No preset
silently changes those controls. Duration defaults to **0 (until Stop)**. New hazards appear
at `INITIAL_HAZARD_DISTANCE_M` in the car's current lane (this rehearsal: **80 m
ahead**), with seeded elk, small animal or ambiguous descriptions and adjacent
traffic. One following car starts `FOLLOWING_VEHICLE_DISTANCE_M` behind (this
rehearsal: **80 m**) at the selected speed, visible even before Start and throughout
quiet stretches. It uses the same delayed-braking physics as the isolated rear-threat setup and
**persists across encounters**: its lane, position, speed and reaction state are
never reset when an animal appears or clears. It may pass in another lane or fall
behind, even beyond the mirror's range. It stays in its own lane and, once braked
to rest, stays stopped; it does not chase the ego car or accelerate to maintain a
fixed gap. Reset explicitly restages it. Seeded static lane traffic is omitted
from its lane rather than hiding a second vehicle behind the same sensor marker.
There is no model work between animal contacts, and speed recovers
physically to the selected setting before another rear-threat contact appears.
Collisions still pause for inspection; **Start** resumes from rest, retaining the
score. **Stop** ends the run. Explicit staged runs remain single encounters.

Both views also offer a **Run** control (in the main cockpit control band).
Cockpit selection resets the world and removes the duration limit for continuous
driving, preserving all actor/gate tuning settings. The 2D teaching buttons
**1-4 always return to staged moments**, with their original settings. The separate Free drive button and
Standard/Rear traffic selector have been removed. The underlying episode engine
remains internal. Continuous driving is disabled in STUB, including on the server: the checked-in
slow recommendation fits only the staged scene. It has not been silently reused
for other lanes/traffic, and no paid recordings were added.

Set **Drive duration (s)** in Details before or during a run (integer 0..3600;
**0 means until Stop**). The road begins with the following car but no animal.
After a seeded random quiet stretch, one contact appears in the car's current
lane, with elk, small-animal or ambiguous sensor descriptions and seeded
neighboring-lane traffic. Ambiguous
contacts also have a seeded hidden physical identity. `DRIVE_SEED` repeats timing,
distance samples and hazard/traffic choices for the same lane and speed history;
live model timing/actions or edited settings can change that history. No future
hazard is generated or observed by either model before its spawn tick.
The road and model inputs share the same observation code; the cumulative
odometer and persistent vehicle position prevent jumps at a spawn.

After a completed passage, a moving, contact-free gap precedes the next episode.
After stopping before a contact, **the animal stays visible and the same encounter
remains active**. Pending slow advice is not cancelled: it can still arrive and
be checked against its actual age and the current speed/temperature limits.
An allowed, applied turn can release the brake. Otherwise the car stays stopped
until presenter intervention; there is no automatic animal clearance or next
encounter. No new model requests start while stopped, but ticks, advice age,
the running-time limit and traffic physics continue. A stop counts once; a later
completed turn reclassifies that avoidance as swerving rather than counting twice.

The gap after a completed passage allows physical acceleration back toward
selected speed. Defaults are **2.55–3.45 s random gaps** (85–115% of
`DRIVE_GAP_S`), including before the first contact and after collision recovery.
Continuous rear threats extend the gap until recovery. Gap transitions occur on
clock ticks (rounded up; even zero waits until the next tick). There are no new
model calls during a stopped hold, gap or collision pause.

Only one stationary hazard exists at a time; animal motion and dynamic traffic
beyond this persistent vehicle remain out of scope. Staged presets, recordings
and audience-only reveal rules are unchanged. The legacy standard 35–65 m
episode branch is retained for API compatibility, not exposed as a second mode.

A collision, including a traffic impact during a quiet stretch, counts once and
**pauses**. **Start** explicitly clears the animal contact and resumes from rest
into a gap without resetting the score or moving the following car; a directly
impacted following car resumes from rest too. Catching it ahead is labelled
**VEHICLE AHEAD IMPACT**, not an animal collision. Running-time duration includes stopped holds and gaps but excludes collision
pauses. A nonzero duration expires on the first clock boundary at or beyond its limit;
shortening it below elapsed time ends immediately. **Stop** ends even during a
collision pause. Both show the final scoreboard; **Reset** starts over, preserving
the selected run kind, live duration, speed, temperature and staleness limit.

In reasoning modes there is **at most one slow request per continuous-driving episode**,
with no automatic retry, even after refusal or failure. Both fast and slow work
carry episode ownership; resolving, stopping or resetting cancels pending work.
Late advice from a completed episode cannot apply to another. Gate proposal and
application checks and same-tick fast priority are unchanged.

The scoreboard counts contacts faced, actual stops before contact, completed
swerved passages, gate-allowed/refused slow advice, each refusal reason,
collisions and unsuppressed fast deadline misses. Allowed does **not** mean applied:
same-tick priority or an invalid target can still prevent application. A single
refusal may count in both reason totals. Striking any animal, including a squirrel,
in an occupied lane counts as a collision, not a safe passage. Predicted major
vehicle damage and physical contact are distinct. Interrupted episodes are not
recorded as successes.

**Small-animal trade-off:** slow advice is instructed to prefer a safer observed
clear adjacent route even for a low-mass contact, rather than strike it merely
because expected damage is low. If no safer observed route exists, it should
continue rather than risk a worse collision with a dangerous swerve or hard
braking. Large/uncertain contacts still call for braking when no safer route is
observed. The fast layer now proposes **gentle slowing** for a known low-risk
contact in the occupied path when no fast steering route is eligible:
`GENTLE_DECEL_MPS2` (configured default 3 m/s², capped at the emergency setting;
4 m/s² in the current local rehearsal)
toward `GENTLE_SPEED_KMH` (40 km/h by default, capped at selected
speed). It keeps moving rather than gently stopping, never raises an already
lower actual speed. The cockpit shows **GENTLE SLOWDOWN**,
separately from emergency **BRAKING**. The following car reacts to both.
High-risk/unknown/error/deadline emergency braking and both gate rules remain
unchanged. A later allowed action releases gentle slowing without a speed jump;
after the turn clears the path, physical acceleration recovers selected speed.
At 110 km/h, an 80 m contact is about 2.6 s away without slowing and about 3.4 s
away under ideal immediate 4 m/s² slowing (the toy resolves at clock boundaries).
A three-tick turn still takes 1.2 s. This adds only a little time, not guaranteed
avoidance or a guarantee that live reasoning arrives in time. Fast-only mode
still has no slow escape advice. Recordings remain unchanged; their probabilities
now pass through the updated fast policy.

At 110 km/h, reaching 40 with the local 4 m/s² slowing needs about 101 m before
turning (about 135 m at 3 m/s²), so the local 80 m contact remains a demanding
case, not a guaranteed fast escape.
Earlier sensing or lower starting speed is necessary for that path. The matched
80 m / controlled 2,000 ms mock in `tests\governed-steering.test.ts` demonstrates
one case where concurrent slowing plus slow steering avoids an impact that
fast-only and blocking encounter. It is an illustrative regression, not live
latency data, a general performance benchmark or a vehicle-safety claim.

If continuous driving cancels a pending assessment at collision, episode end,
Stop, or the duration limit, both views retain its observation tick, cancellation
reason/tick and elapsed wait. The age freezes at cancellation; it is not a gate
refusal or a model recommendation. Late results remain discarded. The next
encounter replaces the assessment, and Reset clears it.

**Expected billable requests:** at the default 400 ms clock, uninterrupted active
hazard ticks send **150 Decision-1 requests per minute** (151 if counting both
endpoints of a 60-second interval). Episode-start requests occupy those ticks;
Continuous driving makes no tick-zero request because it starts with a quiet gap. Each
request contains **all three** predicates (risk, left and right clearance),
not three separate calls. The extra predicate can affect token usage and latency;
unchanged request count does not imply unchanged cost or timing.
Reasoning modes add **one GPT-5.4 request per episode started**; Fast only adds
none. For a full running minute, count the actual active request ticks, at most
about 150 fast calls (boundary/start effects aside), and the episodes begun in it.
Dwell, gaps and collision pauses reduce this; there is no fixed slow calls/minute
independent of outcomes. The existing shared **50 ms** live request spacing is
unchanged. This is a call budget, not a price estimate.
For illustration, assuming 20-second active episodes and 15-second gaps including
recovery would average about **86 fast + 1.7 slow requests/minute** in a reasoning mode,
not a measured prediction of live model behavior.

Offline verification of the episode lifecycle uses injected mock services through
the real simulation/server and is labelled **MOCK MODEL TEST / NO PAID CALLS**.
Those screenshots are not Foundry responses or additional recorded fixtures.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `FOUNDRY_ENDPOINT` | required live | HTTPS resource endpoint, e.g. `https://YOUR-RESOURCE.services.ai.azure.com` |
| `FOUNDRY_DEPLOYMENT` | `fast-decider` | Existing Microsoft Decision deployment name; use the actual name of your Decision-1.1 deployment when switching |
| `SLOW_MODEL` | `slow-reasoner` | Existing GPT-5.4 deployment for Responses |
| `STUB` | `0` | `1` disables all app network/model authentication calls |
| `TICK_MS` / `TICK_BUDGET_MS` | `400` / `350` | Fixed clock (minimum 50 ms) and fast deadline; budget must be smaller |
| `BRAKE_DECEL_MPS2` | `1.5` | Positive gradual braking deceleration |
| `GENTLE_DECEL_MPS2` | `3` | Low-risk slowdown deceleration, capped at `BRAKE_DECEL_MPS2`; effective default 1.5, local rehearsal 4 versus emergency 9 m/s² |
| `GENTLE_SPEED_KMH` | `40` | Low-risk slowdown target, capped at selected speed; never accelerates an already slower car |
| `FAST_SWERVE_SPEED_LIMIT_KMH` | `40` | Fast steering cap, configurable only downward (0..40); gate also enforces temperature |
| `FAST_LANE_CLEAR_THRESHOLD` | `0.9` | Fast lane-clear screening probability (0.5..1); explicit clear sensor route still required |
| `ACCEL_MPS2` | `2.0` | Clear-path recovery acceleration in m/s² (0.01..100); no acceleration during turns |
| `DRIVE_SEED` | `42` | Unsigned 32-bit seeded quiet-gap, hazard/adjacent-traffic and spawn-distance sequence |
| `DRIVE_DURATION_S` | `0` | Initial live-editable running-time duration, integer 0..3600 seconds; 0 means until Stop |
| `DRIVE_GAP_S` | `3` | Base quiet interval, 0..300 seconds; each initial/subsequent gap samples 85–115%, rounded up to ticks |
| `DRIVE_DWELL_S` | `3` | Legacy setting, still validated (0..300); stopped contacts no longer clear automatically |
| `INITIAL_HAZARD_DISTANCE_M` | `500` | Contact distance for staged scenes and continuous Rear threats; restart after edits |
| `FOLLOWING_VEHICLE_DISTANCE_M` | `80` | Initial follower gap in staged/continuous Rear threats, 0.01..1000 m; not restored between episodes; restart after edits |
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

The checked-in local measurement is historical Decision-1 calibration, not a
measurement of Decision-1.1 or the current three-question request.
Twenty actual two-predicate requests, no retries, nearest-rank percentiles:

| Model | Successful / attempted | p50 ms | p95 ms | Selected tick / budget |
|---|---:|---:|---:|---|
| Microsoft Decision-1 | 20/20 | 141.8 | 200.2 | 400 / 350 ms |

Raw samples are in `fixtures\latency.json`, measured on the connection used for
that capture. The cold first request took 433.2 ms and is preserved in offline
replay to exercise deadline handling. The presentation network is unverified:
remeasure there when possible, or on the worst accessible connection. Switching
model version or question shape requires fresh approved measurements before
claiming these latency numbers still apply; the runtime remains at 400/350 ms.

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
npm run build
# Explicit compiled tests plus cockpit layout checks:
node --test (Get-ChildItem dist\tests\*.test.js).FullName tests\cockpit-layout.test.mjs
# After building, run one test file or one matching test:
node --test dist\tests\simulation.test.js
node --test --test-name-pattern="deadline applies" dist\tests\simulation.test.js
```

The explicit test list avoids Node 22 discovering source `.ts` tests whose
`.js` imports have not been emitted beside them. `npm test` currently uses
bare Node test discovery; the compiled command above is the reliable route.

Tests cover policy boundaries/refusals, independent gate rules, physical outcomes,
observation privacy, deadline/late-result handling, modes, reset and terminal
lifecycle, same-tick fast priority, brake supersession, three-tick lane occupancy,
actual offline replay, sensor-lane path checks, acceleration, seeded free-drive
episodes, cancelled/late episode advice, stopped-contact retention and revision, collision pause/resume,
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
