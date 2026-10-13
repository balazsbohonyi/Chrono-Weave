import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONNECTION_REVEAL_MAX_MS, MAX_PATH_INTERMEDIATES } from '../src/constants';
import { isRevealedAt } from '../src/hooks/useConnectionReveal';
import { readFileSync } from 'node:fs';
import { planReveal, REVEAL_APPROACH_MS, REVEAL_HOLD_MS, REVEAL_INTRO_MS, REVEAL_OPENING_HOLD_MS, REVEAL_SETTLE_MS } from '../src/utils/revealTiming';

const fixed = REVEAL_INTRO_MS + REVEAL_HOLD_MS + REVEAL_APPROACH_MS + REVEAL_SETTLE_MS;
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

test('a longer hop gets a longer flight, and every person is held once reached', () => {
  const plan = planReveal([300, 1200, 3000]);
  assert.equal(plan.travelMs.length, 3);
  assert.ok(plan.travelMs[0] < plan.travelMs[1] && plan.travelMs[1] < plan.travelMs[2]);
  // One pause on the first person and one after every link: links + 1.
  assert.equal(plan.dwellMs.length, 4);
  assert.ok(plan.dwellMs.every(ms => ms >= 500));
  assert.equal(plan.totalMs, fixed + sum(plan.travelMs) + sum(plan.dwellMs));
});

test('the time per person does not shrink as the chain grows, until the overall cap bites', () => {
  const short = planReveal([800, 800]), longer = planReveal([800, 800, 800, 800, 800, 800]);
  assert.deepEqual(longer.travelMs.slice(0, 2), short.travelMs);
  assert.equal(longer.dwellMs[0], short.dwellMs[0]);
  assert.ok(longer.totalMs > short.totalMs);
});

test('hops are never rushed or dragged out: flights stay within bounds', () => {
  const plan = planReveal([0, 1, 50, 1e6, NaN, -20]);
  for (const ms of plan.travelMs) assert.ok(ms >= 800 && ms <= 2400 && Number.isFinite(ms), `${ms}`);
});

test('only a chain too long for the cap is speeded up, evenly and without losing proportions', () => {
  const links = MAX_PATH_INTERMEDIATES + 1;
  const hops = Array.from({ length: links }, (_, index) => 400 + (index % 5) * 600);
  const plan = planReveal(hops);
  assert.ok(plan.totalMs <= CONNECTION_REVEAL_MAX_MS + 1, `${plan.totalMs}ms`);
  assert.ok(plan.travelMs.every(ms => ms >= 250) && plan.dwellMs.every(ms => ms >= 150));
  // The shortest and longest hops keep their order after the squeeze.
  assert.ok(plan.travelMs[0] < plan.travelMs[4]);
  // An absurd chain stops getting faster at the floors instead of flickering by.
  const absurd = planReveal(Array.from({ length: 300 }, () => 1000));
  assert.ok(absurd.travelMs.every(ms => ms === 250) && absurd.dwellMs.every(ms => ms === 150));
  assert.ok(Number.isFinite(planReveal([]).totalMs));
  assert.equal(planReveal([]).dwellMs.length, 1);
});

test('people fade in as the thread reaches them: the first at once, the others just before their link ends', () => {
  assert.equal(isRevealedAt(0, 0), true);
  assert.equal(isRevealedAt(0, 1), false);
  assert.equal(isRevealedAt(0.6, 1), false);
  assert.equal(isRevealedAt(0.75, 1), true, 'a little before the thread arrives');
  assert.equal(isRevealedAt(1, 2), false);
  assert.equal(isRevealedAt(1.8, 2), true);
  // A finished reveal (progress = links) shows everyone.
  for (let index = 0; index <= 11; index++) assert.equal(isRevealedAt(11, index), true);
});

test('the first person is held well after the stage has faded in around them, and a long chain does not shorten that', () => {
  const fade = Number(readFileSync('src/styles/connectionStage.css', 'utf8').match(/animation:\s*stage-in\s+(\d+)ms/)?.[1]);
  assert.ok(fade > 0, 'the stage fades in');
  // Their pause plus the opening hold outlasts the fade by a good margin, even for a chain squeezed by the cap.
  const squeezed = planReveal(Array.from({ length: 21 }, () => 1500));
  assert.ok(squeezed.dwellMs[0] + REVEAL_OPENING_HOLD_MS > fade * 2, `${squeezed.dwellMs[0] + REVEAL_OPENING_HOLD_MS}ms against a ${fade}ms fade`);
  assert.ok(REVEAL_OPENING_HOLD_MS >= 1000);
});
