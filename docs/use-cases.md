# Fast/slow decision patterns — real-world use cases

Working notes. Two distinct patterns get conflated in most discussions of
"decision models". They solve different problems, sell to different buyers, and
only one of them needs a governance harness.

---

## The test

> Does the world change while the slow component thinks, **and** is there a
> deadline on the fast decision?

- **No** → Pattern A. Cheap filter in front of an expensive model. Real value,
  easy sale, but no clock, no stale advice, no gate needed.
- **Yes** → Pattern B. True fast/slow coordination. Staleness, interruption and
  execution authority all become load-bearing.

Applying Pattern B's machinery to a Pattern A problem is over-engineering.
Applying Pattern A's thinking to a Pattern B problem is how systems act on
advice that stopped being true.

---

## Pattern A — cheap filter, expensive model

No clock. The value is economics: spend the expensive model only where it
changes the outcome. Immediately measurable in cost and latency, which makes
this the door-opener in customer conversations.

### Migration code assessment
Scan a repository, decide which files actually need a reasoning model.

The decision model's job is **not** "does this file mention AWS" — that's
ripgrep, and someone will say so. Its job is the judgment grep can't make:
*is this file genuinely coupled to AWS, or does it just mention it in a comment,
a string literal, or dead configuration?* A predicate per file, a threshold,
and only the survivors go to Copilot.

Easy to quantify: files scanned, files escalated, cost avoided.

### Alert and log triage
Thousands of alerts, a handful worth deep investigation. Score severity against
a rubric, route by threshold. The ordered-levels score type fits this directly.

### Pull request triage
Which diffs need deep review, which test suites to run, which changes touch
sensitive surfaces. High volume, repetitive, currently done by heuristics that
nobody trusts.

### Document pipelines
Which pages need full extraction, OCR, or a reasoning pass, and which can take
the cheap path. Decision models accept images as well as text.

### RAG groundedness checking
Does this retrieved chunk actually support the claim being made? Microsoft
lists groundedness and safety checks among Decision-1's supported uses, so this
is a sanctioned pattern rather than an improvisation.

### Agent tool gate
Every proposed tool call passes typed predicates — in policy, matches intent,
safe to execute — before the execution controls run it. Low confidence or a
failed gate escalates or blocks.

This is the bridge between the fast/slow material and the governance material:
same typed judgment, applied to an agent's own proposed actions.

---

## Pattern B — true fast/slow with a moving world

Ranked by how well each survives scrutiny from a sceptical audience.

### 1. Live customer conversation (voice or chat)
The customer keeps talking while a slower reasoner works through account
history, entitlements and policy. By the time it returns "offer the retention
discount", the customer has changed subject, escalated, or hung up.

- **Why it works:** the staleness story needs no explanation at all.
- **Deadline:** conversational turn-taking, a few hundred milliseconds.
- **Authority:** the reasoner proposes a discount; policy decides whether that
  discount may be offered to this customer.
- **No edge constraint.** Everything can run in the cloud.

### 2. Payment fraud authorisation
Authorise or decline within tens of milliseconds while investigation takes
seconds. The card is being used elsewhere *right now*, so the world genuinely
moves during deliberation.

- **Authority is unambiguous:** a model recommending "block" does not block.
  Policy blocks. That separation already exists in these systems, which makes
  the argument easy.
- Regulated, auditable, and a buyer that already thinks in terms of thresholds,
  false positives and false negatives.
- Nordic banks are a reachable audience.

### 3. Agentic coding
The audience's own daily experience. The coding agent keeps editing while a
reviewer model reasons about the diff; by the time the review returns, the
files have moved on and the advice refers to code that no longer exists.

- This is AgileThinker's stale-plan failure, transplanted into developer tools.
- Everyone in the room has felt it, which makes it the cheapest to explain.
- Also a natural follow-on demo if the car lands well.

### 4. Network and security operations
Rate-limit, isolate or null-route now; deep analysis later. Mitigation advice
goes stale in seconds because the attack shape changes while you analyse it.

- Containment authority sits outside the model — the same pattern as the
  governed tool gateway.
- Strong fit for an infrastructure audience.

### 5. Connected factory
Fast machine-side decisions on a tick, slower cluster-side reasoning over
history and context. Hard interlocks no model may override.

- The most physically honest of these: the deadline is real, the consequences
  are real, and the safety limits already exist in the plant.
- Edge-constrained today (see below).

### 6. Energy and grid dispatch
Tick-based dispatch decisions, a slower optimiser working over forecasts and
constraints, and physical limits that cannot be overridden by any
recommendation.

---

## On the offline constraint

Only the factory and vehicle cases are genuinely edge-constrained. Four of the
six Pattern B cases run happily in the cloud, because what matters is the
**decision deadline**, not where the model sits.

The architecture answers the objection rather than being limited by it:

> The fast layer must be local and bounded. The slow layer can live anywhere,
> because the system is designed to keep working when its advice is late,
> stale, or absent. Fast local, slow remote, degrade safely.

"Guidance never arrived" and "guidance arrived too late" are the same code
path. A network partition is not a special case — it is the ordinary case the
gate already handles.

---

## Framing notes

- Pattern A sells on cost and latency. Pattern B sells on correctness under
  time pressure. Lead with A to get in the room; B is what makes the
  architecture interesting.
- Name the pain, not the architecture. "I spent two hours fixing my agent's
  completed task" lands; "governed deliberation under fixed execution controls"
  does not. Same problem, different door.
- The three claims that hold in every Pattern B case, and are worth stating
  plainly: the world does not pause while a model thinks; advice has a shelf
  life; agreement is not authority.
