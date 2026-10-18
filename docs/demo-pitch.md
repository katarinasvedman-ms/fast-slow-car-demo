# Good advice is not permission to act

*A live demo. Ten minutes, one road, one elk, two AI models, and a few lines of code that decide who gets to touch the wheel.*

---

## The pitch

You are driving at 90 km/h. Something large is on the road 500 metres ahead. You can't tell what it is.

Two minds are helping you.

One is **fast**. It answers in about a seventh of a second. It doesn't explain itself. It just says how likely this is to wreck the car.

The other is **slow**. It takes three seconds. It reads the situation, thinks it through, and gives you a clever, well-argued recommendation: *"swerve to lane 3."*

But the car didn't stop for three seconds while the slow mind was thinking.

That is the whole demo. By the time brilliant advice arrives, the world it was about has gone. And somewhere in your system there has to be something that is **not an AI** and decides: *is this still true, and is this still allowed?*

> **Reasoning proposes. Runtime controls authorize. Execution changes the world.**

---

## What the audience experiences

### The first ten seconds: a road, and a question

A dark, clean screen. A three-lane road in the middle, large enough for the back row. A pink car in the middle lane. A grey question mark on the road ahead, getting closer. Nobody, including the models, knows what it is.

To the right sit two cards, one for each AI, and a third one the audience hasn't noticed yet: **the gate**.

*I say:* "I'm not going to tell you what's out there. Neither are the models. They only get what the sensors would give them, as text."

### Beat 1. "It was there when it mattered" (2 min)

I press Start.

The car moves. The question mark approaches. Every 400 milliseconds a number appears on the fast card: *damage risk 0.9x*. The car starts braking. The audience sees it slow down.

Once, the number fails to arrive in time. A small counter ticks: **deadline missed**. The car brakes anyway.

*The feeling:* the system doesn't wait for the clever part. When in doubt, it does the safe thing.

*I say:* "That miss wasn't staged. It's a real slow first call. The fast model isn't smart. It's *there*. And when it isn't, the answer is still: brake."

The car stops. The question mark turns into an **elk**. The audience gets a small reveal: it really was big.

### Beat 2. "Forty-one percent" (2 min)

I reset. New hazard: ambiguous. The sensor text on screen is honestly unclear: *"low compact body, but one upright return suggests possibly greater size."*

The fast model says **0.41**. Under 50%. A normal classifier would say "probably fine."

The car brakes.

*The feeling:* a small jolt. Why did it brake at 41%?

*I say:* "Because being wrong costs different things. Miss an elk and it's catastrophic. Brake for nothing and you lose two seconds. So the line isn't 50%. It's 35%. The threshold isn't a measure of how good the model is. It's a statement of what we can't afford."

I drag the threshold to 0.5. Reset. Run. The car carries on. This time the thing is a small animal and it was fine, but the audience has just watched *cost* become a number they can move.

### Beat 3. "The brilliant advice that arrives too late" (3 min), the heart of the demo

Reset. Both models on. Elk. 90 km/h.

The car is already braking, as in Beat 1. Then, a couple of seconds in, the slow card lights up:

> *"Large high-mass obstacle ahead in lane 2. Lane 3 is clear. Recommend swerving to lane 3."*

It's a good answer. The audience can read it and agree. Half the room is thinking *do that, do that*.

And then the **gate** card turns red, with two lines:

- **stale_advice**: this observation is five ticks old. The limit is three.
- **prohibited_action**: you're still doing more than 70 km/h. No swerving at this speed.

The car does nothing. It keeps braking in lane 2 and stops.

*The feeling:* discomfort, then the click. The AI was right *about the world it saw*. It was wrong about the world that existed when it spoke. And the room watched the system refuse something it agreed with.

*I say:* "The slow model didn't make a mistake. It wasn't hacked or tricked. It was **honest and late**. That's the failure that actually happens. Quality of reasoning and authority to act are two different questions. Agreement is not authority."

### Beat 4. "Now watch it say yes" (2 min)

Without this beat the demo tells a nasty story: the AI is dangerous and the gate says no. That isn't the point.

I reset. Same elk, same models, same kind of advice. Two changes: **60 km/h**, and the staleness limit loosened to **6**.

The slow card lights up with the same swerve recommendation. This time the gate goes **green**. The earlier brake is *released*, the car moves smoothly into lane 3 over three ticks, and the log highlights the line: *slow advice supersedes brake*.

The car passes the elk. The reveal: elk. Saved.

Then I change **one thing**, the speed back to 90, and reset. Same advice. Refused. The car brakes to a stop.

*The feeling:* the aha. The AI hasn't changed. The advice hasn't changed. **The world at the moment of action** is the only thing that changed.

*I say:* "Control isn't blocking AI. It's letting the right action through, for reasons you can read off a screen. This is what allowed looks like."

### The finish: the gate is 26 lines (1 min)

I open `gate.ts`. It fits on one slide.

```ts
const age = currentTick - envelope.observedAtTick;
if (age > policy.stalenessLimitTicks)         // stale_advice
if (envelope.action === 'swerve'
    && currentSpeedKmh > policy.swerveSpeedLimit)  // prohibited_action
```

Two rules. It reads the *current* tick and speed, not the ones the model saw. It reports every rule that fails, not just the first.

*I say:* "Now replace 'change lanes' with 'restart a production service,' or 'change someone's access.' Replace this gate with the point where your agent calls a tool. That's the whole idea. The car just lets you watch it."

Last slide, big: **Good advice is not permission to act.**

---

## What people take home

1. **The world doesn't wait for the model.** The clock keeps running while it thinks.
2. **Advice has a shelf life.** And the smarter the model, the slower it is, so the older its answer.
3. **Agreement is not authority.** The thing that recommends must not be the thing that decides.
4. **Put the check where the action takes effect**, against the state *right now*.
5. **A gate isn't a "no" machine.** It's how the right action gets through safely.

---

## Why it works as a demo

- **No jargon needed.** Anyone understands a car and an elk. Nobody needs to know what a "tool call" is until the last minute.
- **It's a story with a twist**: the right answer gets refused, then the same answer gets accepted.
- **Everything is visible.** Each refusal has a name and a reason on screen. Nothing is hidden in a log.
- **It's honest about being a toy.** That's a strength. It makes the point without anyone arguing about driving.
- **The audience does the interesting part**: they feel the urge to say "just let it swerve".

---

## Say this before anyone asks

- This is a toy world on a fixed clock, **not a driving system** and not a safety claim.
- It demonstrates the control boundary, **not** the full harness: no approvals, no leases, no verification here.
- Both gate checks run in one process, so it does **not** show independent enforcement or bypass resistance. That's what the reference implementation is for.
- The fast model only ever brakes or continues. A swerve can only come from the slow model.
- The replay for the staged beats uses recorded real responses (marked **STUB** on screen). Live runs vary: the slow model takes roughly 2–4 seconds.
- Fast model timing came from 20 real requests: median 142 ms, 95th percentile 200 ms, on my own connection.

---

## Practical

- **Stage it with the replay** (`STUB=1`): the ambiguous case really is 0.41 and the late advice really arrives at tick 5, every time. Then, if you want, run one live round and say that it varies.
- If a live call fails or times out, that *is* the demo: no answer means brake.
- Have `gate.ts` open in a second window for the finish.
- Zoom the browser for the back row. Keep "What the models see" collapsed unless asked. It shows the exact text the models received.

---

*Built with Microsoft Decision-1 (fast) and GPT-5.4 (slow) in Foundry. Governance pattern from `agentic-harness-validation`; no code copied.*
