import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTACT_VERSION, figurePerson, GAP_HINT_MIN_YEARS, identifyPerson, selectFrontier, temporalGap, type ConnectionSession, type ContactAssessment, type ContactPerson,
} from '../src/services/connectionGraph';
import { findConnection } from '../src/services/connectionPath';
import { buildContactDiscoveryPrompt } from '../src/services/prompts';
import type { ContactDiscoveryRequest } from '../src/services/connectionAI';
import { A, fakeContacts, person } from './connectionFixtures';

// A search whose two sides have grown toward each other in time but have not met: the earlier side reaches 1760, the later side starts at 1810.
const people: ContactPerson[] = [];
const mk = (name: string, birth: number, death: number) => identifyPerson(people, figurePerson(person(name, birth, death)));
const old = mk('Old Endpoint', 1452, 1519), recent = mk('Recent Endpoint', 1889, 1945);
const [n1, n2, e1, e2, e3, e4, e5] = [mk('Near 1', 1520, 1580), mk('Near 2', 1530, 1590), mk('Early 1', 1500, 1560), mk('Early 2', 1540, 1610), mk('Early 3', 1590, 1660), mk('Early 4', 1640, 1710), mk('Early 5', 1690, 1760)];
const [l1, l2, l3] = [mk('Late 1', 1860, 1930), mk('Late 2', 1830, 1900), mk('Late 3', 1810, 1880)];
const reaching = mk('Reaching Back', 1740, 1830);
const accept = (a: ContactPerson, b: ContactPerson): ContactAssessment => ({ pair: [a.id, b.id], verdict: 'accepted', interactionType: 'meeting', evidence: 'They met.',
  provenance: { provider: 'test', model: 'test', version: CONTACT_VERSION, assessedAt: 1 } });
const contacts = [accept(old, n1), accept(old, n2), accept(old, e1), accept(e1, e2), accept(e2, e3), accept(e3, e4), accept(e4, e5), accept(recent, l1), accept(l1, l2), accept(l2, l3)];
const session = (rounds: ConnectionSession['rounds'] = []): ConnectionSession => ({ version: 2, key: 'k', canvasId: 'c', endpoints: [old.id, recent.id], people, candidates: [], rounds,
  attempts: {}, segment: 1, status: 'paused', phase: 'Paused', elapsedMs: 0, updatedAt: 0, diagnostics: { tasks: 0, people: 0, pairs: 0 } });
const round = (who: ContactPerson, count: number, emptyRounds = 0) => ({ personId: who.id, round: count, proposed: [], emptyRounds, lastExpanded: 1 });
const names = (list: ContactPerson[]) => list.map(item => item.name);
const earlierSide = [old, n1, n2, e1, e2, e3, e4, e5], laterSide = [recent, l1, l2, l3];

test('the gap is the smallest distance between the people each side has reached, and the two people standing at its ends', () => {
  const gap = temporalGap(earlierSide, laterSide)!;
  assert.equal(gap.years, 50);
  assert.deepEqual([gap.fromYear, gap.toYear], [1760, 1810]);
  assert.deepEqual(gap.edges.map(edge => edge.name), ['Early 5', 'Late 3']);
  // The edges follow the order of the two sides they were given.
  assert.deepEqual(temporalGap(laterSide, earlierSide)!.edges.map(edge => edge.name), ['Late 3', 'Early 5']);
  // Any pair that overlaps in time means there is no stretch of time between the sides, only a missing contact.
  assert.equal(temporalGap(earlierSide, [...laterSide, mk('Overlapping', 1700, 1800)]), null);
  assert.equal(temporalGap([old], [old]), null);
  assert.equal(temporalGap([], laterSide), null);
});

test('with a gap, the people nearest it are expanded first, on both sides, ahead of those the rotation alone would pick', () => {
  const people_ = people;
  // Without the gap, each side expands from its own endpoint outward.
  assert.deepEqual(names(selectFrontier(session(), contacts, 0, 2, people_, null)).slice(0, 1), ['Old Endpoint']);
  assert.deepEqual(names(selectFrontier(session(), contacts, 1, 2, people_, null)).slice(0, 1), ['Recent Endpoint']);
  // With it, the person whose life reaches furthest into the gap goes first; the rest keep their order.
  assert.deepEqual(names(selectFrontier(session(), contacts, 0, 2, people_)), ['Early 5', 'Old Endpoint']);
  // On the later side both Late 3 (50 years from the gap's far end) and Late 2 (70) are within a generation of the best: nearest first.
  assert.deepEqual(names(selectFrontier(session(), contacts, 1, 2, people_)), ['Late 3', 'Late 2']);
  // The same result when the caller has worked the gap out already.
  assert.deepEqual(names(selectFrontier(session(), contacts, 0, 2, people_, temporalGap(earlierSide, laterSide))), ['Early 5', 'Old Endpoint']);
});

test('the people nearest the gap rotate: expanded too often or exhausted, they give way to the next nearest', () => {
  // Expanded three times already: out of the band, so the next nearest takes over.
  assert.equal(selectFrontier(session([round(e5, 3)]), contacts, 0, 1, people)[0].name, 'Early 4');
  // Expanded once is still in the band, and still ahead of unexpanded people elsewhere.
  assert.equal(selectFrontier(session([round(e5, 1)]), contacts, 0, 1, people)[0].name, 'Early 5');
  // Two empty rounds exhaust a person for good, as they always did.
  assert.equal(selectFrontier(session([round(e5, 2, 2)]), contacts, 0, 1, people)[0].name, 'Early 4');
});

test('without a gap (some pair overlaps in time) the frontier is ordered exactly as before', () => {
  // The later side reaches someone who was alive while Early 5 was: no stretch of time is left between the sides, only a missing contact.
  const bridged = [...contacts, accept(l3, reaching)];
  assert.equal(temporalGap([...earlierSide], [...laterSide, reaching]), null);
  for (const side of [0, 1] as const) {
    assert.deepEqual(names(selectFrontier(session(), bridged, side, 4, people)), names(selectFrontier(session(), bridged, side, 4, people, null)));
  }
});

test('the engine tells the model about a gap of 40 years or more, and says nothing for a shorter one', async () => {
  const requestsOf = async (to: ReturnType<typeof person>) => {
    const requests: ContactDiscoveryRequest[] = [];
    const fake = fakeContacts([], async request => { requests.push(request); return []; });
    await findConnection({ service: fake.service, from: A, to, figures: [A, to], signal: new AbortController().signal, limits: { tasks: 3 } });
    return requests;
  };
  // Alpha lives 1500-1560: Beta (1700-1760) starts 140 years after, Gamma (1580-1650) only 20 years after.
  const far = await requestsOf(person('Beta', 1700, 1760));
  assert.ok(far.length > 0);
  assert.deepEqual(far[0].gap, { fromYear: 1560, toYear: 1700 });
  const near = await requestsOf(person('Gamma', 1580, 1650));
  assert.ok(near.length > 0);
  assert.equal(near[0].gap, undefined);
  assert.equal(GAP_HINT_MIN_YEARS, 40);
});

test('the discovery prompt names the stretch of time only when there is one, and keeps the rule that every contact must be documented', () => {
  const request = (gap?: { fromYear: number; toYear: number }): ContactDiscoveryRequest => ({ sources: [{ person: old, round: 1, previous: [], goal: recent }], target: recent, references: [], limit: 6, ...(gap ? { gap } : {}) });
  const plain = buildContactDiscoveryPrompt(request());
  assert.doesNotMatch(plain, /Nobody found so far lived/);
  const hinted = buildContactDiscoveryPrompt(request({ fromYear: 1760, toYear: 1810 }));
  assert.match(hinted, /Nobody found so far lived between 1760 and 1810, and the chain has to cross that stretch of time/);
  assert.match(hinted, /alive as late as possible when the source is before it, or as early as possible when the source is after it/);
  assert.match(hinted, /Every contact must still overlap the source's own lifespan and be a documented interaction/);
  // Everything else in the prompt is the same with or without the hint.
  assert.equal(hinted.replace(/\nNobody found so far lived[^\n]*/, ''), plain);
});
