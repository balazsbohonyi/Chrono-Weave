import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyWikidata, canvasPerson, chooseSurvivor, figurePerson, identifyPerson, needsWikidata, proposalKey, reconcileIdentities, samePerson, validAccepted, WIKIDATA_MISS_RETRY_MS,
  type ConnectionSession, type ContactAssessment, type ContactKnowledge, type ContactPerson,
} from '../src/services/connectionGraph';
import type { WikidataOutcome } from '../src/services/wikidataService';
import { recoverKnowledge } from '../src/utils/connectionKnowledge';
import { person } from './connectionFixtures';

const NOW = 1_800_000_000_000;
const J = { qid: 'Q132537', birthYear: 1904, deathYear: 1967 };
const input = (name: string, birthYear: number, deathYear: number) => figurePerson(person(name, birthYear, deathYear));
const accepted = (a: ContactPerson, b: ContactPerson, year?: number, assessedAt = 1): ContactAssessment => ({ pair: [a.id, b.id], verdict: 'accepted', interactionType: 'correspondence',
  evidence: `${a.name} and ${b.name} corresponded.`, ...(year ? { year } : {}), provenance: { provider: 'fake', model: 'fake', version: 2, assessedAt } });
const sessionOf = (people: ContactPerson[], endpoints: [string, string]): ConnectionSession => ({ version: 2, key: 'k', canvasId: 'c', endpoints, people: structuredClone(people), candidates: [], rounds: [],
  attempts: {}, segment: 1, status: 'paused', phase: '', elapsedMs: 0, updatedAt: 0, diagnostics: { tasks: 0, people: 0, pairs: 0 } });
const outcomes = (...entries: Array<[ContactPerson, WikidataOutcome]>) => new Map(entries.map(([p, outcome]) => [proposalKey(p), outcome]));

// The reported case: one physicist recorded twice, under two forms of the name and two birth years.
function oppenheimers() {
  const people: ContactPerson[] = [];
  const wrong = identifyPerson(people, input('Robert Oppenheimer', 1906, 1967)), right = identifyPerson(people, input('J. Robert Oppenheimer', 1904, 1967));
  const bohr = identifyPerson(people, input('Niels Bohr', 1885, 1962)), fermi = identifyPerson(people, input('Enrico Fermi', 1901, 1954));
  const knowledge: ContactKnowledge = { people, contacts: [accepted(wrong, bohr), accepted(right, fermi), accepted(wrong, fermi, undefined, 5), accepted(wrong, right)] };
  return { people, wrong, right, bohr, fermi, knowledge };
}

test('two people are the same when they share a Wikidata item, or when one carries the other\'s old name and years as a variant', () => {
  const a = { name: 'A', birthYear: 1900, deathYear: 1960, qid: 'Q1' }, b = { name: 'B', birthYear: 1901, deathYear: 1961, qid: 'Q1' };
  assert.equal(samePerson(a, b), true);
  assert.equal(samePerson(a, { ...b, qid: 'Q2' }), false);
  assert.equal(samePerson({ name: 'Corrected', birthYear: 1904, deathYear: 1967, variants: [{ name: 'Robert Oppenheimer', birthYear: 1906, deathYear: 1967 }] },
    { name: 'robert  oppenheimer', birthYear: 1906, deathYear: 1967 }), true);
  assert.equal(samePerson({ name: 'Corrected', birthYear: 1904, deathYear: 1967 }, { name: 'Robert Oppenheimer', birthYear: 1906, deathYear: 1967 }), false, 'without the variant, conflicting years stay separate');
  assert.equal(samePerson({ name: 'Robert Oppenheimer', birthYear: 1906, deathYear: 1967 }, { name: 'Corrected', birthYear: 1904, deathYear: 1967, variants: [{ name: 'Robert Oppenheimer', birthYear: 1906, deathYear: 1967 }] }), true, 'either way round');
});

test('a proposal that Wikidata resolved is found by its item, whatever years and form of the name it carries', () => {
  const people: ContactPerson[] = [];
  const first = identifyPerson(people, input('J. Robert Oppenheimer', 1904, 1967), J);
  assert.deepEqual([first.qid, first.birthYear, first.deathYear, people.length], ['Q132537', 1904, 1967, 1]);
  const again = identifyPerson(people, input('Robert Oppenheimer', 1906, 1967), J);
  assert.equal(again, first);
  assert.equal(people.length, 1, 'no second Oppenheimer');
  assert.deepEqual(first.variants, [{ name: 'Robert Oppenheimer', birthYear: 1906, deathYear: 1967 }]);
  // The same wrong proposal, with no lookup this time, still lands on him through the variant.
  assert.equal(identifyPerson(people, input('Robert Oppenheimer', 1906, 1967)), first);
});

test('a new person from a resolved proposal is recorded with Wikidata\'s years, remembering the proposed ones', () => {
  const people: ContactPerson[] = [];
  const made = identifyPerson(people, input('Robert Oppenheimer', 1906, 1967), J);
  assert.deepEqual([made.id, made.name, made.birthYear, made.qid], ['sd2-robert%20oppenheimer-1904-1967', 'Robert Oppenheimer', 1904, 'Q132537']);
  assert.deepEqual(made.variants, [{ name: 'Robert Oppenheimer', birthYear: 1906, deathYear: 1967 }]);
});

test('a resolved proposal for a person already recorded under the same name and years attaches the item and corrects their years, keeping their id', () => {
  const people: ContactPerson[] = [], known = identifyPerson(people, input('Robert Oppenheimer', 1906, 1967));
  const id = known.id, found = identifyPerson(people, input('Robert Oppenheimer', 1906, 1967), J);
  assert.equal(found, known);
  assert.deepEqual([found.id, found.birthYear, found.qid], [id, 1904, 'Q132537']);
  assert.deepEqual(found.variants, [{ name: 'Robert Oppenheimer', birthYear: 1906, deathYear: 1967 }]);
  assert.equal(identifyPerson(people, input('Robert Oppenheimer', 1906, 1967), J), known, 'and stays that one');
  assert.equal(people.length, 1);
});

test('a proposal is identified exactly as before when there is no resolution', () => {
  const people: ContactPerson[] = [], a = identifyPerson(people, input('Robert Oppenheimer', 1906, 1967)), b = identifyPerson(people, input('Robert Oppenheimer', 1904, 1967));
  assert.notEqual(a, b, 'conflicting years stay separate identities');
  assert.equal(people.length, 2);
  assert.equal(a.qid, undefined);
});

test('the reported duplicate: one QID merges both records into the one whose years were right, with every reference following', () => {
  const { wrong, right, bohr, fermi, knowledge } = oppenheimers();
  const wrongId = wrong.id; // merging points the retired object at the survivor, so keep the id it had
  const session = sessionOf([wrong, right, bohr, fermi], [bohr.id, fermi.id]);
  const stats = reconcileIdentities(knowledge, session, outcomes([wrong, J], [right, J]), session.endpoints, NOW);
  assert.deepEqual(stats, { resolved: 2, corrected: 0, merged: 1 }, 'the right record needed no correction');
  const live = knowledge.people.filter(p => !p.canonicalId);
  assert.deepEqual(live.map(p => p.name).sort(), ['Enrico Fermi', 'J. Robert Oppenheimer', 'Niels Bohr']);
  const survivor = live.find(p => p.qid === 'Q132537')!;
  assert.equal(survivor.id, right.id);
  assert.equal(knowledge.people.find(p => p.id === wrongId)!.canonicalId, survivor.id, 'the other is retired, not deleted');
  assert.deepEqual(survivor.variants, [{ name: 'Robert Oppenheimer', birthYear: 1906, deathYear: 1967 }]);
  assert.ok(survivor.aliases.includes('Robert Oppenheimer'));
  // Contacts: the one between the two records is gone; Fermi's two became one (the newer); Bohr's follows.
  const pairs = knowledge.contacts.map(c => [...c.pair].sort().join('+')).sort();
  assert.deepEqual(pairs, [[bohr.id, survivor.id], [fermi.id, survivor.id]].map(pair => pair.sort().join('+')).sort());
  assert.equal(knowledge.contacts.find(c => c.pair.includes(fermi.id))!.provenance.assessedAt, 5);
  assert.deepEqual(session.people.map(p => p.id).sort(), [bohr.id, fermi.id, survivor.id].sort());
  assert.equal(knowledge.people.length, 4, 'the retired record stays in the store');
});

test('a person alone with the wrong years gets Wikidata\'s, the old ones kept as a variant, and their id and contacts are untouched', () => {
  const { wrong, bohr, knowledge } = oppenheimers(), id = wrong.id;
  knowledge.contacts = [accepted(wrong, bohr)];
  const stats = reconcileIdentities(knowledge, undefined, outcomes([wrong, J]), [], NOW);
  assert.deepEqual(stats, { resolved: 1, corrected: 1, merged: 0 });
  assert.deepEqual([wrong.id, wrong.birthYear, wrong.qid, wrong.variants], [id, 1904, 'Q132537', [{ name: 'Robert Oppenheimer', birthYear: 1906, deathYear: 1967 }]]);
  assert.equal(knowledge.contacts.length, 1);
  assert.equal(samePerson(wrong, input('Robert Oppenheimer', 1906, 1967)), true, 'a figure that still has the old years finds him');
});

test('a person Wikidata had no answer for is marked as asked, and asked again only after a month', () => {
  const { wrong, knowledge } = oppenheimers();
  assert.equal(needsWikidata(wrong, NOW), true);
  reconcileIdentities(knowledge, undefined, outcomes([wrong, 'miss']), [], NOW);
  assert.equal(wrong.qidCheckedAt, NOW);
  assert.equal(wrong.qid, undefined);
  assert.equal(needsWikidata(wrong, NOW + WIKIDATA_MISS_RETRY_MS - 1), false);
  assert.equal(needsWikidata(wrong, NOW + WIKIDATA_MISS_RETRY_MS + 1), true);
  assert.equal(needsWikidata({ ...wrong, qid: 'Q1' }, NOW), false, 'nobody who has an item');
  assert.equal(needsWikidata({ ...wrong, canonicalId: 'x' }, NOW), false, 'nobody retired');
});

test('the survivor is an endpoint, else the record whose years were right, else the one with more accepted contacts, else the first recorded', () => {
  const { wrong, right, bohr, fermi, knowledge } = oppenheimers();
  const pending = new Map([[wrong.id, J], [right.id, J]]);
  assert.equal(chooseSurvivor([wrong, right], [], knowledge, pending), right, 'years that already were right');
  assert.equal(chooseSurvivor([wrong, right], [wrong.id], knowledge, pending), wrong, 'an endpoint beats everything');
  // Neither is exact: the one with more accepted contacts (wrong has three, right has one).
  const both = new Map([[wrong.id, { ...J, birthYear: 1903 }], [right.id, { ...J, birthYear: 1903 }]]);
  assert.equal(chooseSurvivor([right, wrong], [], knowledge, both), wrong);
  knowledge.contacts = [];
  assert.equal(chooseSurvivor([right, wrong], [], knowledge, both), wrong, 'a tie goes to the one recorded first');
  assert.ok(bohr && fermi);
});

test('an endpoint that is a duplicate of another record survives, and the session keeps its endpoints', () => {
  const { wrong, right, bohr, fermi, knowledge } = oppenheimers();
  const rightId = right.id;
  const session = sessionOf([wrong, bohr, fermi], [wrong.id, bohr.id]);
  reconcileIdentities(knowledge, session, outcomes([wrong, J], [right, J]), session.endpoints, NOW);
  assert.deepEqual(session.endpoints, [wrong.id, bohr.id]);
  assert.equal(knowledge.people.find(p => p.id === rightId)!.canonicalId, wrong.id);
  assert.deepEqual([wrong.birthYear, wrong.qid, session.people.find(p => p.id === wrong.id)!.birthYear], [1904, 'Q132537', 1904], 'the session copy follows the corrected record');
});

test('two endpoints of one item are not merged into each other', () => {
  const { wrong, right, knowledge } = oppenheimers();
  const stats = reconcileIdentities(knowledge, undefined, outcomes([wrong, J], [right, J]), [wrong.id, right.id], NOW);
  assert.equal(stats.merged, 0);
  assert.deepEqual(knowledge.people.filter(p => p.canonicalId).length, 0);
});

test('a contact that stops fitting once the years are corrected stays stored and simply no longer counts', () => {
  const people: ContactPerson[] = [], p = identifyPerson(people, input('Long Lived', 1950, 2000)), other = identifyPerson(people, input('Contemporary', 1940, 2010));
  const knowledge: ContactKnowledge = { people, contacts: [accepted(p, other, 1995)] };
  assert.equal(validAccepted(knowledge.contacts[0], new Map(people.map(q => [q.id, q]))), true);
  reconcileIdentities(knowledge, undefined, outcomes([p, { qid: 'Q7', birthYear: 1940, deathYear: 1990 }]), [], NOW);
  assert.equal(knowledge.contacts.length, 1, 'nothing is deleted');
  assert.equal(validAccepted(knowledge.contacts[0], new Map(people.map(q => [q.id, q]))), false, 'the year 1995 is after the corrected death');
});

test('merging records of one item never leaves a person in a contact with themselves, in the store or in the session', () => {
  const { wrong, right, bohr, fermi, knowledge } = oppenheimers();
  const session = sessionOf([wrong, right, bohr, fermi], [bohr.id, fermi.id]);
  session.candidates = [{ from: wrong.id, to: right.id, claim: 'same', status: 'proposed' }, { from: wrong.id, to: bohr.id, claim: 'c', status: 'accepted', assessment: knowledge.contacts[0] }];
  reconcileIdentities(knowledge, session, outcomes([wrong, J], [right, J]), session.endpoints, NOW);
  assert.ok(session.candidates.every(c => c.from !== c.to));
  assert.equal(session.candidates.length, 1);
  assert.ok(knowledge.contacts.every(c => c.pair[0] !== c.pair[1]));
});

test('what recovery keeps of the new fields: a well-formed item, a time, a few well-formed variants; anything else is dropped', () => {
  const base = { id: 'a', name: 'A', birthYear: 1900, deathYear: 1960, occupation: 'x', category: 'SCIENTISTS', description: '', aliases: [] };
  const good = recoverKnowledge({ people: [{ ...base, qid: 'Q42', qidCheckedAt: 123, variants: [{ name: 'Al', birthYear: 1901, deathYear: 1960, extra: 'x' }] }], contacts: [] }).people[0];
  assert.deepEqual([good.qid, good.qidCheckedAt, good.variants], ['Q42', 123, [{ name: 'Al', birthYear: 1901, deathYear: 1960 }]]);
  const bad = recoverKnowledge({ people: [{ ...base, qid: 'not-an-item', qidCheckedAt: 'soon', variants: [{ name: '', birthYear: 1, deathYear: 2 }, { name: 'B', birthYear: 0, deathYear: 5 }, 'x', null] }], contacts: [] }).people[0];
  assert.deepEqual([bad.qid, bad.qidCheckedAt, bad.variants], [undefined, undefined, undefined]);
  const many = recoverKnowledge({ people: [{ ...base, variants: Array.from({ length: 9 }, (_, i) => ({ name: `N${i}`, birthYear: 1900 + i, deathYear: 1960 })) }], contacts: [] }).people[0];
  assert.deepEqual(many.variants!.map(v => v.name), ['N3', 'N4', 'N5', 'N6', 'N7', 'N8'], 'the newest six');
});

test('weaving through a corrected person reuses the canvas figure that still has the model\'s years, and adds none', () => {
  const people: ContactPerson[] = [], corrected = identifyPerson(people, input('J. Robert Oppenheimer', 1904, 1967), J);
  identifyPerson(people, input('Robert Oppenheimer', 1906, 1967), J);
  const onCanvas = person('Robert Oppenheimer', 1906, 1967), other = person('Isaac Newton', 1643, 1727);
  assert.equal(canvasPerson(corrected, [other, onCanvas]), onCanvas);
  // With no such figure on the canvas, the new one carries the corrected years.
  const fresh = canvasPerson(corrected, [other]);
  assert.deepEqual([fresh.name, fresh.birthYear, fresh.deathYear], ['J. Robert Oppenheimer', 1904, 1967]);
});

test('applying an identity that changes nothing adds no variant', () => {
  const people: ContactPerson[] = [], p = identifyPerson(people, input('J. Robert Oppenheimer', 1904, 1967));
  assert.equal(applyWikidata(p, J), false);
  assert.equal(p.variants, undefined);
  assert.equal(p.qid, 'Q132537');
});
