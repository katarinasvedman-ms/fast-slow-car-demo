import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { renderDash } from '../dist/client/cockpit/dash.js';
import { mapSnapshot } from '../dist/client/cockpit/model.js';
import { loadConfig } from '../dist/src/config.js';
import { Simulation } from '../dist/src/simulation.js';
import { fakeModels } from '../dist/tests/helpers.js';
import { fitBottomDeck } from '../dist/client/cockpit/presenter.js';

test('bottom deck fits cards and controls together within half the viewport and restores size when space returns', (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'getComputedStyle');
  let limit = 380;
  Object.defineProperty(globalThis, 'getComputedStyle', {
    configurable: true, value: () => ({ maxHeight: `${limit}px` }),
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'getComputedStyle', original);
    else delete globalThis.getComputedStyle;
  });
  const deck = { style: {} };
  const deckWidth = 1800;
  let naturalHeight = 500;
  const content = {
    style: {},
    getBoundingClientRect: () => {
      const scale = content.style.transform === 'none' ? 1 : Number(content.style.transform.slice(6, -1));
      return {
        height: naturalHeight * scale,
        width: deckWidth * Number.parseFloat(content.style.width) / 100 * scale,
      };
    },
  };
  fitBottomDeck(deck, content);
  assert.equal(content.style.transform, 'scale(0.76)');
  assert.ok(Number.parseFloat(deck.style.height) <= limit);
  assert.ok(Math.abs(content.getBoundingClientRect().width - deckWidth) < 1e-10);
  limit = 540;
  fitBottomDeck(deck, content);
  assert.equal(content.style.transform, 'scale(1)');
  assert.equal(content.style.width, '100%');
  assert.equal(deck.style.height, '500px');
  naturalHeight = 250;
  fitBottomDeck(deck, content);
  assert.equal(deck.style.height, '250px');
});

test('cockpit renders full advice, independent refusal details and both tuning inputs from snapshots', async (t) => {
  class Node {
    textContent = '';
    value = '';
    hidden = false;
    disabled = false;
    dataset = {};
    style = {};
    children = [];
    attributes = new Map();
    classList = { toggle() {}, remove() {} };
    setAttribute(name, value) { this.attributes.set(name, value); }
    removeAttribute(name) { this.attributes.delete(name); }
    toggleAttribute(name, value) { if (name === 'disabled') this.disabled = value; }
    replaceChildren(...children) { this.children = children; }
    closest() { return null; }
    querySelector() { return new Node(); }
  }
  class Input extends Node {}
  class Select extends Node {}
  class Image extends Node {}
  const html = await readFile(new URL('../public/cockpit.html', import.meta.url), 'utf8');
  const nodes = new Map([...html.matchAll(/<(\w+)\b[^>]*\bid="([^"]+)"/g)].map(([, tag, id]) => [
    id, tag === 'input' ? new Input() : tag === 'select' ? new Select() : tag === 'img' ? new Image() : new Node(),
  ]));
  for (const [name, value] of Object.entries({
    document: { getElementById: (id) => nodes.get(id), createElement: () => new Node() },
    HTMLInputElement: Input, HTMLSelectElement: Select, HTMLImageElement: Image,
  })) {
    const original = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => {
      if (original) Object.defineProperty(globalThis, name, original);
      else delete globalThis[name];
    });
  }
  const sim = new Simulation(loadConfig({ STUB: '1' }), fakeModels());
  t.after(() => sim.dispose());
  const state = sim.snapshot();
  state.world.tick = 9;
  state.advice.observedAtTick = 0;
  state.advice.status = 'ready';
  state.advice.data = {
    action: 'swerve', targetLane: 3, observedAtTick: 0, arrivedAtTick: 5, latencyMs: 3841,
    rationale: 'A large obstacle is ahead in lane 2. Lane 3 is clear. Lane 1 has a vehicle behind.',
  };
  state.advice.gate = { allowed: false, reasons: [
    { reason: 'stale_advice', detail: 'Observation age 9 ticks exceeds 3.' },
    { reason: 'prohibited_action', detail: 'Swerve at 90.0 km/h exceeds 40 km/h limit for ice risk (-4 \u00b0C).' },
  ] };
  const before = structuredClone(state);
  renderDash(mapSnapshot(state), [], false);
  assert.equal(nodes.get('advice-action').textContent, 'SWERVE / LANE 3');
  assert.equal(nodes.get('advice-rationale').textContent, state.advice.data.rationale);
  assert.equal(nodes.get('advice-stamp-visible').textContent, 'Observed #0 / arrived #5 / 3841 ms model latency');
  assert.equal(nodes.get('freshness-label-visible').textContent, 'CURRENT OBSERVATION AGE 9 / 3 TICKS');
  assert.equal(nodes.get('gate-verdict').textContent, 'REFUSED');
  assert.equal(nodes.get('fresh-value').textContent, 'NO');
  assert.equal(nodes.get('permitted-value').textContent, 'NO');
  assert.deepEqual(nodes.get('gate-reasons-visible').children.map((node) => node.textContent),
    state.advice.gate.reasons.map((reason) => reason.detail));
  assert.deepEqual(state, before);

  state.world.selectedSpeedKmh = 120;
  state.world.ambientTempC = -4;
  state.threshold = 0.5;
  state.settings.stalenessLimitTicks = 6;
  const pairs = [
    ['speed', 'speed-number', 120], ['temperature', 'temperature-number', -4],
    ['threshold', 'threshold-number', 0.5], ['staleness', 'staleness-range', 6],
  ];
  renderDash(mapSnapshot(state), [], false, true);
  for (const [slider, number, value] of pairs) {
    for (const id of [slider, number]) {
      assert.equal(nodes.get(id).value, String(value));
      assert.equal(nodes.get(id).disabled, true);
    }
  }
  assert.equal(nodes.get('staleness-help').textContent, '6 ticks = 2.4 s');
  assert.equal(nodes.get('staleness-range').hidden, false);
  assert.equal(nodes.get('threshold-notch').style.transform, 'rotate(0deg)');
  assert.equal(nodes.get('selected-speed-marker').style.left, '87.5%');
  state.advice.gate = { allowed: true };
  renderDash(mapSnapshot(state), [], false);
  assert.equal(nodes.get('gate-verdict').textContent, 'ALLOWED');
  assert.equal(nodes.get('fresh-value').textContent, 'YES');
  assert.equal(nodes.get('permitted-value').textContent, 'YES');
  assert.deepEqual(nodes.get('gate-reasons-visible').children, []);
  for (const [slider, number] of pairs) {
    assert.equal(nodes.get(slider).disabled, false);
    assert.equal(nodes.get(number).disabled, false);
  }
  state.settings.stalenessLimitTicks = 20;
  renderDash(mapSnapshot(state), [], false);
  assert.equal(nodes.get('staleness').value, '20');
  assert.equal(nodes.get('staleness-range').hidden, true);
  assert.equal(nodes.get('staleness-help').textContent, '20 ticks = 8.0 s / above cockpit range 0-10');
  state.settings.stalenessLimitTicks = 3;
  renderDash(mapSnapshot(state), [], false);
  assert.equal(nodes.get('staleness-range').hidden, false);
  assert.equal(nodes.get('staleness-range').value, '3');
  state.world.identity = 'elk';
  state.world.outcome = 'running';
  renderDash(mapSnapshot(state), [], false);
  assert.equal(nodes.get('contact-name').textContent, 'ELK');
  assert.equal(nodes.get('thermal-contact').hidden, true);
  assert.equal(nodes.get('identity-note').textContent, 'Audience view / not model input');
  assert.equal(nodes.get('impact-image').hidden, true);
});
