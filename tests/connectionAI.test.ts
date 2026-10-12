import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseContactAssessments, requestContactDiscovery } from '../src/services/connectionAI';
import { figurePerson, identifyPerson, type ContactPerson } from '../src/services/connectionGraph';
import { buildContactAssessmentPrompt, buildContactDiscoveryPrompt, buildRelationshipExplanationPrompt } from '../src/services/prompts';
import { person } from './connectionFixtures';
const people: ContactPerson[] = [];
const first = identifyPerson(people, figurePerson(person('Napoleon', 1769, 1821))), second = identifyPerson(people, figurePerson(person('Wellington', 1769, 1852)));
const pairs = [{ first, second }];
test('named exact wartime opposition qualifies; absent episode, malformed references and chronology are rejected', () => {
  const accepted = { ref: 'p1', verdict: 'accepted', interactionType: 'wartime-opposition', evidence: 'Napoleon and Wellington commanded directly opposing armies at Waterloo.', episode: 'Battle of Waterloo', year: 1815 };
  assert.equal(parseContactAssessments([accepted], pairs)[0].verdict, 'accepted');
  assert.throws(() => parseContactAssessments([{ ...accepted, episode: '' }], pairs));
  assert.throws(() => parseContactAssessments([{ ...accepted, year: 1900 }], pairs));
  assert.throws(() => parseContactAssessments([{ ...accepted, ref: 'p2' }], pairs));
  assert.throws(() => parseContactAssessments([{ ...accepted, evidence: '' }], pairs));
  assert.throws(() => parseContactAssessments([accepted], [{ first, second: { ...second, birthYear: 1900, deathYear: 1980 } }]));
});
test('uncertainty is explicit and broad war, kinship, overlap and influence cannot establish contact in task instructions', () => {
  const unresolved = parseContactAssessments([{ ref: 'p1', verdict: 'unresolved', evidence: '', uncertainty: 'Only common war membership is known.' }], pairs)[0];
  assert.equal(unresolved.verdict, 'unresolved'); assert.equal(unresolved.evidence, '');
  const prompt = buildContactAssessmentPrompt(pairs); assert.match(prompt, /larger war do not qualify/); assert.match(prompt, /Kinship alone is not evidence/);
  assert.match(prompt, /never evidence of contact/); assert.doesNotMatch(prompt, /unverified supplied biography/);
  assert.doesNotMatch(buildRelationshipExplanationPrompt(person('A'), person('B')), /Napoleon and Wellington/);
});
test('discovery maps short references, bounds source batches and never treats claims as assessment evidence', async () => {
  const request = { sources: [{ person: first, round: 2, previous: [] }], target: second, references: [second], limit: 6 };
  const result = await requestContactDiscovery(async (_prompt, validate) => validate([{ source: 's1', reference: 'r1', claim: 'Proposed exact opposition.' }]), request);
  assert.equal(result[0].person.name, second.name);
  await assert.rejects(() => requestContactDiscovery(async (_prompt, validate) => validate([{ source: 's9', reference: 'r1', claim: 'Claim' }]), request));
  assert.match(buildContactDiscoveryPrompt(request), /PAIRS, never all known people/);
});
